import { angleDiff, clamp } from "../core/utils";

export const TIER3_MS               = 30;
export const TIER2_MS               = 60;
export const TIER1_MS               = 120;
export const CUT_METRIC_WINDOW_MS   = 240;
export const MAX_POINTS             = 100;
export const TIER3_POINTS           = 100;
export const TIER2_POINTS           = 90;
export const TIER1_POINTS           = 50;

export const CUT_DIRECTION_TIER3 = 25 * Math.PI / 180;
export const CUT_DIRECTION_TIER2 = 45 * Math.PI / 180;
export const CUT_DIRECTION_TIER1 = 70 * Math.PI / 180;
export const CUT_CONTACT_TIER3   = 45;
export const CUT_CONTACT_TIER2   = 75;
export const CUT_CONTACT_TIER1   = 110;
export const CUT_TRAVEL_TIER3    = 40;
export const CUT_TRAVEL_TIER2    = 24;
export const CUT_TRAVEL_TIER1    = 8;
export const FLOW_LINK_MAX_MS    = 700;
export const FLOW_CONT_TIER3     = 30 * Math.PI / 180;
export const FLOW_CONT_TIER2     = 55 * Math.PI / 180;
export const FLOW_CONT_TIER1     = 85 * Math.PI / 180;

export type NoteKind   = "cut" | "flow" | "lyric";
export type HitResult  = "tier3" | "tier2" | "tier1" | "miss";
export type HitTiming  = "early" | "late" | "on";
export type MissReason = "timing" | "contact" | "direction" | "travel" | "continuity";

export interface JudgementNote {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  flowPrevIndex?: number;
}

export interface PreviousFlowNote {
  x: number;
  y: number;
  state: "pending" | "hit" | "missed";
  hitResult?: HitResult;
}

export interface PointerSample {
  x: number;
  y: number;
  songMs: number;
  wallMs?: number;
}

export interface GesturePhrase {
  travel: number;
  direction: number;
  impactSongMs: number;
  contactDistance: number;
}

export interface Judgement {
  result: HitResult;
  points: number;
  offsetMs: number;
  timing: HitTiming;
  missReason?: MissReason;
  gesture: GesturePhrase;
}

export type JudgementAttempt =
  | { status: "noGesture" }
  | { status: "pending"; best?: Judgement }
  | { status: "judged"; judgement: Judgement };

export function timingFor(deltaMs: number): HitTiming {
  if (deltaMs < 0) return "early";
  if (deltaMs > 0) return "late";
  return "on";
}

export function scoreFor(deltaMs: number): { result: HitResult; points: number } {
  const d = Math.abs(deltaMs);
  if (d <= TIER3_MS) return { result: "tier3", points: TIER3_POINTS };
  if (d <= TIER2_MS) return { result: "tier2", points: TIER2_POINTS };
  if (d <= TIER1_MS) return { result: "tier1", points: TIER1_POINTS };
  return { result: "miss", points: 0 };
}

export function tierRank(result: HitResult): number {
  if (result === "tier3") return 3;
  if (result === "tier2") return 2;
  if (result === "tier1") return 1;
  return 0;
}

export function minTier(a: HitResult, b: HitResult): HitResult {
  return tierRank(a) <= tierRank(b) ? a : b;
}

export function capUpper(value: number, tier3: number, tier2: number, tier1: number): HitResult {
  if (value <= tier3) return "tier3";
  if (value <= tier2) return "tier2";
  if (value <= tier1) return "tier1";
  return "miss";
}

export function capLower(value: number, tier3: number, tier2: number, tier1: number): HitResult {
  if (value >= tier3) return "tier3";
  if (value >= tier2) return "tier2";
  if (value >= tier1) return "tier1";
  return "miss";
}

interface Candidate extends Judgement {
  contactCap: HitResult;
  directionError: number;
  directionCap: HitResult;
  durationMs: number;
  timingCap: HitResult;
  travelCap: HitResult;
}

function interpolateSample(prev: PointerSample, curr: PointerSample, songMs: number): PointerSample {
  const duration = curr.songMs - prev.songMs;
  const t = duration <= 0 ? 0 : clamp((songMs - prev.songMs) / duration, 0, 1);
  return {
    x: prev.x + (curr.x - prev.x) * t,
    y: prev.y + (curr.y - prev.y) * t,
    songMs,
  };
}

function pushDistinct(samples: PointerSample[], sample: PointerSample): void {
  const prev = samples[samples.length - 1];
  if (prev && prev.songMs === sample.songMs && prev.x === sample.x && prev.y === sample.y) return;
  samples.push(sample);
}

function clipSamples(pointerSamples: PointerSample[], windowStart: number, windowEnd: number): PointerSample[] {
  const clipped: PointerSample[] = [];
  for (let i = 0; i < pointerSamples.length - 1; i++) {
    const prev = pointerSamples[i];
    const curr = pointerSamples[i + 1];
    if (curr.songMs < windowStart || prev.songMs > windowEnd) continue;

    const start = Math.max(prev.songMs, windowStart);
    const end = Math.min(curr.songMs, windowEnd);
    if (end < start) continue;

    if (clipped.length === 0 || clipped[clipped.length - 1].songMs < start) {
      pushDistinct(clipped, start === prev.songMs ? prev : interpolateSample(prev, curr, start));
    }
    pushDistinct(clipped, end === curr.songMs ? curr : interpolateSample(prev, curr, end));
  }
  return clipped;
}

function contactForRange(note: JudgementNote, samples: PointerSample[], startIndex: number, endIndex: number): {
  contactDistance: number;
  impactSongMs: number;
} {
  let contactDistance = Infinity;
  let impactSongMs = note.time;

  for (let i = startIndex; i < endIndex; i++) {
    const start = samples[i];
    const end = samples[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : clamp(
      ((note.x - start.x) * dx + (note.y - start.y) * dy) / lenSq,
      0, 1,
    );
    const closestX = start.x + t * dx;
    const closestY = start.y + t * dy;
    const distance = Math.hypot(closestX - note.x, closestY - note.y);
    if (distance < contactDistance) {
      contactDistance = distance;
      impactSongMs = start.songMs + (end.songMs - start.songMs) * t;
    }
  }

  return { contactDistance, impactSongMs };
}

function missReasonFor(
  timingCap: HitResult,
  contactCap: HitResult,
  travelCap: HitResult,
  directionCap: HitResult,
  continuityCap: HitResult,
): MissReason | undefined {
  if (timingCap === "miss") return "timing";
  if (contactCap === "miss") return "contact";
  if (travelCap === "miss") return "travel";
  if (directionCap === "miss") return "direction";
  if (continuityCap === "miss") return "continuity";
  return undefined;
}

function flowContinuityCap(note: JudgementNote, moveAngle: number, previousFlowNote?: PreviousFlowNote): HitResult {
  if (note.flowPrevIndex === undefined) return "tier3";
  if (!previousFlowNote || previousFlowNote.state !== "hit" || previousFlowNote.hitResult === "miss") return "tier1";
  const pathAngle = Math.atan2(note.y - previousFlowNote.y, note.x - previousFlowNote.x);
  return capUpper(Math.abs(angleDiff(moveAngle, pathAngle)), FLOW_CONT_TIER3, FLOW_CONT_TIER2, FLOW_CONT_TIER1);
}

function buildCandidate(
  note: JudgementNote,
  samples: PointerSample[],
  startIndex: number,
  endIndex: number,
  previousFlowNote?: PreviousFlowNote,
): Candidate {
  const start = samples[startIndex];
  const end = samples[endIndex];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const travel = Math.hypot(dx, dy);
  const direction = Math.atan2(dy, dx);
  const durationMs = end.songMs - start.songMs;
  const { contactDistance, impactSongMs } = contactForRange(note, samples, startIndex, endIndex);
  const offsetMs = impactSongMs - note.time;

  const timingScore = scoreFor(offsetMs);
  const contactCap = capUpper(contactDistance, CUT_CONTACT_TIER3, CUT_CONTACT_TIER2, CUT_CONTACT_TIER1);
  const travelCap = capLower(travel, CUT_TRAVEL_TIER3, CUT_TRAVEL_TIER2, CUT_TRAVEL_TIER1);
  let directionError = 0;
  let directionCap: HitResult = "tier3";
  let continuityCap: HitResult = "tier3";

  if (note.kind !== "lyric") {
    directionError = Math.abs(angleDiff(direction, note.direction));
    directionCap = capUpper(directionError, CUT_DIRECTION_TIER3, CUT_DIRECTION_TIER2, CUT_DIRECTION_TIER1);

    if (note.kind === "flow") {
      continuityCap = flowContinuityCap(note, direction, previousFlowNote);
    }
  }

  const result = minTier(
    minTier(timingScore.result, contactCap),
    minTier(minTier(travelCap, directionCap), continuityCap),
  );
  const points = result === "tier3" ? TIER3_POINTS
    : result === "tier2" ? TIER2_POINTS
    : result === "tier1" ? TIER1_POINTS
    : 0;
  const missReason = missReasonFor(timingScore.result, contactCap, travelCap, directionCap, continuityCap);

  return {
    result,
    points,
    offsetMs,
    timing: timingFor(offsetMs),
    missReason,
    gesture: {
      travel,
      direction,
      impactSongMs,
      contactDistance,
    },
    contactCap,
    directionError,
    directionCap,
    durationMs,
    timingCap: timingScore.result,
    travelCap,
  };
}

function candidateSortKey(candidate: Candidate): number[] {
  return [
    tierRank(candidate.result),
    tierRank(candidate.timingCap),
    tierRank(candidate.contactCap),
    tierRank(candidate.directionCap),
    tierRank(candidate.travelCap),
    -Math.abs(candidate.offsetMs),
    -candidate.gesture.contactDistance,
    -candidate.directionError,
    -candidate.durationMs,
  ];
}

function isBetterCandidate(candidate: Candidate, best: Candidate | null): boolean {
  if (!best) return true;
  const candidateKey = candidateSortKey(candidate);
  const bestKey = candidateSortKey(best);
  for (let i = 0; i < candidateKey.length; i++) {
    if (candidateKey[i] !== bestKey[i]) return candidateKey[i] > bestKey[i];
  }
  return false;
}

function selectBestCandidate(
  note: JudgementNote,
  pointerSamples: PointerSample[],
  previousFlowNote?: PreviousFlowNote,
): Candidate | null {
  if (pointerSamples.length < 2) return null;
  const latestSongMs = pointerSamples[pointerSamples.length - 1].songMs;
  const samples = clipSamples(
    pointerSamples,
    note.time - CUT_METRIC_WINDOW_MS,
    Math.min(latestSongMs, note.time + CUT_METRIC_WINDOW_MS),
  );
  if (samples.length < 2) return null;

  let best: Candidate | null = null;
  for (let startIndex = 0; startIndex < samples.length - 1; startIndex++) {
    for (let endIndex = startIndex + 1; endIndex < samples.length; endIndex++) {
      const candidate = buildCandidate(note, samples, startIndex, endIndex, previousFlowNote);
      if (isBetterCandidate(candidate, best)) best = candidate;
    }
  }

  return best;
}

export function getGesturePhrase(note: JudgementNote, pointerSamples: PointerSample[]): GesturePhrase | null {
  return selectBestCandidate(note, pointerSamples)?.gesture ?? null;
}

function canStillImprove(candidate: Candidate, latestSongMs: number, noteTime: number): boolean {
  if (latestSongMs < noteTime) return true;
  if (candidate.result === "tier3") return false;
  if (candidate.result === "tier2") return latestSongMs < noteTime + TIER3_MS;
  if (candidate.result === "tier1") return latestSongMs < noteTime + TIER2_MS;
  return latestSongMs < noteTime + CUT_METRIC_WINDOW_MS;
}

export function judgeGesture(
  note: JudgementNote,
  pointerSamples: PointerSample[],
  previousFlowNote?: PreviousFlowNote,
): JudgementAttempt {
  const latestSongMs = pointerSamples[pointerSamples.length - 1]?.songMs;
  if (latestSongMs === undefined) return { status: "noGesture" };

  const best = selectBestCandidate(note, pointerSamples, previousFlowNote);
  if (!best) return { status: "noGesture" };
  if (canStillImprove(best, latestSongMs, note.time)) return { status: "pending", best };
  return { status: "judged", judgement: best };
}
