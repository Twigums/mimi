import { angleDiff, clamp } from "../core/utils";

export const TIER3_MS               = 40;
export const TIER2_MS               = 80;
export const TIER1_MS               = 160;
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
// Flow gesture caps are deliberately looser than cut: flow rewards a continuous
// motion, so direction/contact/travel forgive more than a precise slash.
export const FLOW_DIRECTION_TIER3 = 40 * Math.PI / 180;
export const FLOW_DIRECTION_TIER2 = 65 * Math.PI / 180;
export const FLOW_DIRECTION_TIER1 = 95 * Math.PI / 180;
export const FLOW_CONTACT_TIER3  = 65;
export const FLOW_CONTACT_TIER2  = 95;
export const FLOW_CONTACT_TIER1  = 130;
export const FLOW_TRAVEL_TIER3   = 24;
export const FLOW_TRAVEL_TIER2   = 12;
export const FLOW_TRAVEL_TIER1   = 4;
export const FLOW_LINK_MAX_MS    = 700;
// Continuity is lenient on purpose: any forward heading along the ribbon (including
// smooth curves and corners up to a ~120 degrees turn) keeps full credit, while
// heading sideways or backward against the phrase falls off toward a miss.
export const FLOW_CONT_TIER3     = 60 * Math.PI / 180;
export const FLOW_CONT_TIER2     = 90 * Math.PI / 180;
export const FLOW_CONT_TIER1     = 120 * Math.PI / 180;

export type NoteKind   = "cut" | "flow" | "lyric";
export type HitResult  = "tier3" | "tier2" | "tier1" | "miss";
export type HitTiming  = "early" | "late" | "on";
export type IssueReason = "timing" | "contact" | "direction" | "travel" | "continuity";

export interface JudgementNote {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  flowPrevIndex?: number;
  flowNextIndex?: number;
}

export interface PreviousFlowNote {
  x: number;
  y: number;
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
  issue?: IssueReason;
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

function contactForSegment(note: JudgementNote, start: PointerSample, end: PointerSample): {
  contactDistance: number;
  impactSongMs: number;
} {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp(
    ((note.x - start.x) * dx + (note.y - start.y) * dy) / lenSq,
    0, 1,
  );
  const closestX = start.x + t * dx;
  const closestY = start.y + t * dy;
  return {
    contactDistance: Math.hypot(closestX - note.x, closestY - note.y),
    impactSongMs: start.songMs + (end.songMs - start.songMs) * t,
  };
}

// The issue is the binding constraint that held the note below Tier 3: the
// first metric (in priority order) whose cap equals the final result. Since the
// result is the minimum of all caps, at least one cap matches it for any
// non-Tier-3 note; a clean Tier 3 has no issue. For a miss this resolves to the
// first metric that fell past Tier 1, identical to the previous miss-only logic.
function issueFor(
  result: HitResult,
  timingCap: HitResult,
  contactCap: HitResult,
  travelCap: HitResult,
  directionCap: HitResult,
  continuityCap: HitResult,
): IssueReason | undefined {
  if (result === "tier3") return undefined;
  if (timingCap === result) return "timing";
  if (contactCap === result) return "contact";
  if (travelCap === result) return "travel";
  if (directionCap === result) return "direction";
  if (continuityCap === result) return "continuity";
  return undefined;
}

// Continuity guards forward progress through the phrase: the gesture should head
// along the ribbon away from the previous anchor, not stall or backtrack. It is the
// angle between the gesture heading and the incoming chord (prev -> this), judged
// regardless of the previous anchor's own grade, so one weak anchor no longer caps
// the rest of the phrase. The first anchor (no previous) has no continuity constraint.
function flowContinuityCap(note: JudgementNote, heading: number, previousFlowNote?: PreviousFlowNote): HitResult {
  if (note.flowPrevIndex === undefined || !previousFlowNote) return "tier3";
  const incoming = Math.atan2(note.y - previousFlowNote.y, note.x - previousFlowNote.x);
  return capUpper(Math.abs(angleDiff(heading, incoming)), FLOW_CONT_TIER3, FLOW_CONT_TIER2, FLOW_CONT_TIER1);
}

function buildCandidate(
  note: JudgementNote,
  samples: PointerSample[],
  startIndex: number,
  endIndex: number,
  contactDistance: number,
  impactSongMs: number,
  previousFlowNote?: PreviousFlowNote,
): Candidate {
  const start = samples[startIndex];
  const end = samples[endIndex];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const travel = Math.hypot(dx, dy);
  const direction = Math.atan2(dy, dx);
  const durationMs = end.songMs - start.songMs;
  const offsetMs = impactSongMs - note.time;

  const isFlow = note.kind === "flow";
  const timingScore = scoreFor(offsetMs);
  // Contact uses the cut thresholds for both kinds until there's evidence to tune
  // flow separately; FLOW_CONTACT_* are kept defined for that future tuning.
  const contactCap = capUpper(contactDistance, CUT_CONTACT_TIER3, CUT_CONTACT_TIER2, CUT_CONTACT_TIER1);
  const travelCap = isFlow
    ? capLower(travel, FLOW_TRAVEL_TIER3, FLOW_TRAVEL_TIER2, FLOW_TRAVEL_TIER1)
    : capLower(travel, CUT_TRAVEL_TIER3, CUT_TRAVEL_TIER2, CUT_TRAVEL_TIER1);
  let directionError = 0;
  let directionCap: HitResult = "tier3";
  let continuityCap: HitResult = "tier3";

  if (note.kind === "cut") {
    directionError = Math.abs(angleDiff(direction, note.direction));
    directionCap = capUpper(directionError, CUT_DIRECTION_TIER3, CUT_DIRECTION_TIER2, CUT_DIRECTION_TIER1);
  } else if (isFlow) {
    // Direction follows the engine-computed ribbon tangent (stored in note.direction).
    // A lone anchor with no phrase neighbours has no tangent, so direction is free.
    if (note.flowPrevIndex !== undefined || note.flowNextIndex !== undefined) {
      directionError = Math.abs(angleDiff(direction, note.direction));
      directionCap = capUpper(directionError, FLOW_DIRECTION_TIER3, FLOW_DIRECTION_TIER2, FLOW_DIRECTION_TIER1);
    }
    continuityCap = flowContinuityCap(note, direction, previousFlowNote);
  }

  const result = minTier(
    minTier(timingScore.result, contactCap),
    minTier(minTier(travelCap, directionCap), continuityCap),
  );
  const points = result === "tier3" ? TIER3_POINTS
    : result === "tier2" ? TIER2_POINTS
    : result === "tier1" ? TIER1_POINTS
    : 0;
  const issue = issueFor(result, timingScore.result, contactCap, travelCap, directionCap, continuityCap);

  return {
    result,
    points,
    offsetMs,
    timing: timingFor(offsetMs),
    issue,
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
    let contactDistance = Infinity;
    let impactSongMs = note.time;
    for (let endIndex = startIndex + 1; endIndex < samples.length; endIndex++) {
      const contact = contactForSegment(note, samples[endIndex - 1], samples[endIndex]);
      if (contact.contactDistance < contactDistance) {
        contactDistance = contact.contactDistance;
        impactSongMs = contact.impactSongMs;
      }
      const candidate = buildCandidate(
        note,
        samples,
        startIndex,
        endIndex,
        contactDistance,
        impactSongMs,
        previousFlowNote,
      );
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

// The gesture for a cut is "settled" once the pointer has left the contact zone:
// no current motion is improving contact, and a better-timed re-cut would need a
// physically implausible re-approach within the few ms left. Committing here
// instead of holding for the timing window keeps non-perfect feedback from lagging
// behind an early cut (issue #53). `prevNoteTime` gates how early this can fire so a
// sweep toward an adjacent note can't claim this note during the previous note's
// territory; the min() clamps the gate at the note's own perfect-window start when a
// near-simultaneous previous note would otherwise over-delay it.
function gestureSettled(
  best: Candidate,
  note: JudgementNote,
  latest: PointerSample,
  prevNoteTime: number | undefined,
): boolean {
  if (best.result === "miss" || note.kind !== "cut") return false;
  const earliestCommitMs = Math.min(note.time - TIER3_MS, prevNoteTime ?? -Infinity);
  if (latest.songMs < earliestCommitMs) return false;
  return Math.hypot(latest.x - note.x, latest.y - note.y) > CUT_CONTACT_TIER1;
}

export function judgeGesture(
  note: JudgementNote,
  pointerSamples: PointerSample[],
  previousFlowNote?: PreviousFlowNote,
  prevNoteTime?: number,
): JudgementAttempt {
  const latest = pointerSamples[pointerSamples.length - 1];
  if (latest === undefined) return { status: "noGesture" };

  const best = selectBestCandidate(note, pointerSamples, previousFlowNote);
  if (!best) return { status: "noGesture" };
  if (gestureSettled(best, note, latest, prevNoteTime)) return { status: "judged", judgement: best };
  if (canStillImprove(best, latest.songMs, note.time)) return { status: "pending", best };
  return { status: "judged", judgement: best };
}
