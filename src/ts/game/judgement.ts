import { angleDiff, clamp } from "../core/utils";
import {
  type HoldAnalysis,
  type LyricHoldState,
  toHoldAnalysis,
} from "./holdTracker";

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
export const CUT_STRAIGHT_TIER3  = 0.9;
export const CUT_STRAIGHT_TIER2  = 0.8;
export const CUT_STRAIGHT_TIER1  = 0.65;
export const FLOW_CONTACT_TIER3  = 65;
export const FLOW_CONTACT_TIER2  = 95;
export const FLOW_CONTACT_TIER1  = 130;
export const FLOW_TRAVEL_TIER3   = 24;
export const FLOW_TRAVEL_TIER2   = 12;
export const FLOW_TRAVEL_TIER1   = 4;
export const FLOW_TIER3_MS       = 70;
export const FLOW_TIER2_MS       = 120;
export const FLOW_SHAPE_BINS     = 4;
export const FLOW_CONT_TIER3     = 60 * Math.PI / 180;
export const FLOW_CONT_TIER2     = 75 * Math.PI / 180;
export const FLOW_CONT_TIER1     = 100 * Math.PI / 180;

// Lyric hold tuning. A lyric is judged as a hold: enter the circle on time (timing),
// reach the center (contact), and keep the pointer inside for the hold's duration
// (the `gesture` issue slot — hold completeness). The hold length is the gap to the
// next note (set by the engine); there is no default or cap — a lyric with no
// following note is an invalid chart and judged as a miss. See LYRIC_HOLD_PLAN.md / wiki.
export const LYRIC_HOLD_RADIUS     = 110;   // "still holding" tolerance (logical px)
export const LYRIC_RELEASE_GRACE   = 100;   // early release counted as a full hold (ms)
// Held-fraction tiers (fraction of the required hold actually sustained).
export const LYRIC_HOLD_TIER3      = 0.95;
export const LYRIC_HOLD_TIER2      = 0.80;
export const LYRIC_HOLD_TIER1      = 0.55;

export type NoteKind   = "cut" | "flow" | "lyric";
export type HitResult  = "tier3" | "tier2" | "tier1" | "miss";
export type HitTiming  = "early" | "late" | "on";
export type IssueReason = "timing" | "contact" | "direction" | "gesture";

export interface JudgementNote {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  flowShape?: number[];
  // Lyric only: how long (ms) the cursor must be held in the circle, derived by the
  // engine from the gap to the next note. Absent ⇒ an invalid lyric (judged as a miss).
  holdMs?: number;
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

export function scoreFor(
  deltaMs: number,
  t3 = TIER3_MS,
  t2 = TIER2_MS,
  t1 = TIER1_MS,
): { result: HitResult; points: number } {
  const d = Math.abs(deltaMs);
  if (d <= t3) return { result: "tier3", points: TIER3_POINTS };
  if (d <= t2) return { result: "tier2", points: TIER2_POINTS };
  if (d <= t1) return { result: "tier1", points: TIER1_POINTS };
  return { result: "miss", points: 0 };
}

function timingTiers(kind: NoteKind): { t3: number; t2: number; t1: number } {
  return kind === "flow"
    ? { t3: FLOW_TIER3_MS, t2: FLOW_TIER2_MS, t1: TIER1_MS }
    : { t3: TIER3_MS, t2: TIER2_MS, t1: TIER1_MS };
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
  flowCap: HitResult;
  straightness: number;
  straightCap: HitResult;
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

// Arc-length-uniform resample of a polyline into `bins` segment headings (radians).
export function resampleHeadings(points: { x: number; y: number }[], bins: number): number[] | null {
  const n = points.length;
  if (n < 2 || bins < 1) return null;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cum[n - 1];
  if (total <= 1e-6) return null;

  const knots: { x: number; y: number }[] = [];
  let seg = 0;
  for (let k = 0; k <= bins; k++) {
    const dist = (total * k) / bins;
    while (seg < n - 2 && cum[seg + 1] < dist) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen <= 0 ? 0 : (dist - cum[seg]) / segLen;
    knots.push({
      x: points[seg].x + (points[seg + 1].x - points[seg].x) * t,
      y: points[seg].y + (points[seg + 1].y - points[seg].y) * t,
    });
  }
  const headings: number[] = [];
  for (let k = 0; k < bins; k++) {
    headings.push(Math.atan2(knots[k + 1].y - knots[k].y, knots[k + 1].x - knots[k].x));
  }
  return headings;
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

function issueFor(
  result: HitResult,
  timingCap: HitResult,
  contactCap: HitResult,
  directionCap: HitResult,
  travelCap: HitResult,
  flowCap: HitResult,
  straightCap: HitResult,
): IssueReason | undefined {
  if (result === "tier3") return undefined;
  if (timingCap === result) return "timing";
  if (contactCap === result) return "contact";
  if (directionCap === result) return "direction";
  if (travelCap === result || flowCap === result || straightCap === result) return "gesture";
  return undefined;
}

// The flow shape cap
function flowShapeCap(note: JudgementNote, samples: PointerSample[], startIndex: number, endIndex: number): HitResult {
  const target = note.flowShape;
  if (!target || target.length === 0) return "tier3";
  const gesture = resampleHeadings(samples.slice(startIndex, endIndex + 1), target.length);
  if (!gesture) return "tier3"; // no motion; travel cap handles it
  let sumSq = 0;
  for (let k = 0; k < target.length; k++) {
    const err = angleDiff(gesture[k], target[k]);
    sumSq += err * err;
  }
  return capUpper(Math.sqrt(sumSq / target.length), FLOW_CONT_TIER3, FLOW_CONT_TIER2, FLOW_CONT_TIER1);
}

function buildCandidate(
  note: JudgementNote,
  samples: PointerSample[],
  startIndex: number,
  endIndex: number,
  contactDistance: number,
  impactSongMs: number,
  pathLen: number,
): Candidate {
  const start = samples[startIndex];
  const end = samples[endIndex];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const travel = Math.hypot(dx, dy);
  const direction = Math.atan2(dy, dx);
  const durationMs = end.songMs - start.songMs;
  const offsetMs = impactSongMs - note.time;
  const straightness = pathLen > 1e-6 ? clamp(travel / pathLen, 0, 1) : 1;

  const isFlow = note.kind === "flow";
  const tt = timingTiers(note.kind);
  const timingScore = scoreFor(offsetMs, tt.t3, tt.t2, tt.t1);
  const contactCap = capUpper(contactDistance, CUT_CONTACT_TIER3, CUT_CONTACT_TIER2, CUT_CONTACT_TIER1);
  const travelCap = isFlow
    ? capLower(travel, FLOW_TRAVEL_TIER3, FLOW_TRAVEL_TIER2, FLOW_TRAVEL_TIER1)
    : capLower(travel, CUT_TRAVEL_TIER3, CUT_TRAVEL_TIER2, CUT_TRAVEL_TIER1);
  let directionError = 0;
  let directionCap: HitResult = "tier3";
  let flowCap: HitResult = "tier3";
  let straightCap: HitResult = "tier3";

  if (note.kind === "cut") {
    directionError = Math.abs(angleDiff(direction, note.direction));
    directionCap = capUpper(directionError, CUT_DIRECTION_TIER3, CUT_DIRECTION_TIER2, CUT_DIRECTION_TIER1);
    straightCap = capLower(straightness, CUT_STRAIGHT_TIER3, CUT_STRAIGHT_TIER2, CUT_STRAIGHT_TIER1);
  } else if (isFlow) {
    flowCap = flowShapeCap(note, samples, startIndex, endIndex);
  }

  const result = minTier(
    minTier(timingScore.result, contactCap),
    minTier(minTier(travelCap, directionCap), minTier(flowCap, straightCap)),
  );
  const points = result === "tier3" ? TIER3_POINTS
    : result === "tier2" ? TIER2_POINTS
    : result === "tier1" ? TIER1_POINTS
    : 0;
  const issue = issueFor(result, timingScore.result, contactCap, directionCap, travelCap, flowCap, straightCap);

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
    flowCap,
    straightness,
    straightCap,
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
    tierRank(candidate.travelCap),
    tierRank(candidate.straightCap),
    tierRank(candidate.directionCap),
    tierRank(candidate.flowCap),
    -Math.abs(candidate.offsetMs),
    -candidate.gesture.contactDistance,
    -candidate.directionError,
    candidate.straightness,
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
): Candidate | null {
  if (pointerSamples.length < 2) return null;
  const latestSongMs = pointerSamples[pointerSamples.length - 1].songMs;
  const samples = clipSamples(
    pointerSamples,
    note.time - CUT_METRIC_WINDOW_MS,
    Math.min(latestSongMs, note.time + CUT_METRIC_WINDOW_MS),
  );
  if (samples.length < 2) return null;

  const cum = [0];
  for (let i = 1; i < samples.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y));
  }

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
        cum[endIndex] - cum[startIndex],
      );
      if (isBetterCandidate(candidate, best)) best = candidate;
    }
  }

  return best;
}

function canStillImprove(
  candidate: Candidate,
  latestSongMs: number,
  noteTime: number,
  t3: number,
  t2: number,
): boolean {
  if (latestSongMs < noteTime) return true;
  if (candidate.result === "tier3") return false;
  if (candidate.result === "tier2") return latestSongMs < noteTime + t3;
  if (candidate.result === "tier1") return latestSongMs < noteTime + t2;
  return latestSongMs < noteTime + CUT_METRIC_WINDOW_MS;
}

function cutEarliestCommitMs(note: JudgementNote, prevNoteTime: number | undefined): number {
  return Math.max(note.time - TIER1_MS, prevNoteTime ?? -Infinity);
}

function gestureSettled(
  best: Candidate,
  note: JudgementNote,
  latest: PointerSample,
  prevNoteTime: number | undefined,
): boolean {
  if (best.result === "miss" || note.kind !== "cut") return false;
  if (latest.songMs < cutEarliestCommitMs(note, prevNoteTime)) return false;
  return Math.hypot(latest.x - note.x, latest.y - note.y) > CUT_CONTACT_TIER1;
}

// ---- Lyric hold judgement -------------------------------------------------
// A lyric is judged as a hold rather than a stroke: the player keeps the cursor
// inside the circle for (about) the hold duration. It maps onto the same four issue
// buckets without adding a new one — timing (when you entered), contact (how close to
// center you got), gesture (the held fraction). Direction does not apply.

interface SampleHoldAnalysis {
  entered: boolean;       // the pointer reached inside LYRIC_HOLD_RADIUS at some point
  closest: number;        // closest distance to center over the window
  offsetMs: number;       // timing offset; early presence (before note.time) counts as 0
  heldDuration: number;   // longest contiguous span inside the radius within the window
}

function analyzeHold(note: JudgementNote, samples: PointerSample[], holdEnd: number): SampleHoldAnalysis {
  let closest = Infinity;
  let closestMs = note.time;
  let firstInsideMs = Infinity;
  // Longest contiguous in-radius run, measured by its overlap with [note.time, holdEnd].
  let bestHeld = 0;
  let runStart: number | null = null;
  let runEnd = 0;
  const flushRun = (): void => {
    if (runStart === null) return;
    const overlap = Math.min(runEnd, holdEnd) - Math.max(runStart, note.time);
    if (overlap > bestHeld) bestHeld = overlap;
    runStart = null;
  };
  for (const s of samples) {
    const d = Math.hypot(s.x - note.x, s.y - note.y);
    if (d < closest) { closest = d; closestMs = s.songMs; }
    if (d <= LYRIC_HOLD_RADIUS) {
      if (s.songMs < firstInsideMs) firstInsideMs = s.songMs;
      if (runStart === null) runStart = s.songMs;
      runEnd = s.songMs;
    } else {
      flushRun();
    }
  }
  flushRun();

  const entered = firstInsideMs !== Infinity;
  // Timing: late entry is penalized; presence at or before the note start is on time.
  // When the pointer never reached inside, fall back to the nearest-approach moment so
  // a well-timed miss reads as a contact issue (you were there, not on it) like a cut.
  const offsetMs = !entered ? closestMs - note.time
    : firstInsideMs <= note.time ? 0
    : firstInsideMs - note.time;
  return { entered, closest, offsetMs, heldDuration: Math.max(0, bestHeld) };
}

function buildHoldJudgement(note: JudgementNote, analysis: HoldAnalysis, holdMs: number): {
  judgement: Judgement;
  timingCap: HitResult;
  entered: boolean;
  held: boolean;
} {
  const required = Math.max(1, holdMs - LYRIC_RELEASE_GRACE);
  const heldFraction = clamp(analysis.heldDuration / required, 0, 1);

  const timingCap  = scoreFor(analysis.offsetMs).result;
  const contactCap = capUpper(analysis.closest, CUT_CONTACT_TIER3, CUT_CONTACT_TIER2, CUT_CONTACT_TIER1);
  const holdCap    = capLower(heldFraction, LYRIC_HOLD_TIER3, LYRIC_HOLD_TIER2, LYRIC_HOLD_TIER1);

  const result = minTier(minTier(timingCap, contactCap), holdCap);
  const points = result === "tier3" ? TIER3_POINTS
    : result === "tier2" ? TIER2_POINTS
    : result === "tier1" ? TIER1_POINTS
    : 0;
  // Reuse the shared issue priority (timing -> contact -> direction -> gesture). The
  // held fraction is the `gesture` slot; lyrics have no direction.
  const issue = issueFor(result, timingCap, contactCap, "tier3", holdCap, "tier3", "tier3");

  return {
    judgement: {
      result,
      points,
      offsetMs: analysis.offsetMs,
      timing: timingFor(analysis.offsetMs),
      issue,
      gesture: { travel: 0, direction: 0, impactSongMs: note.time + analysis.offsetMs, contactDistance: analysis.closest },
    },
    timingCap,
    entered: analysis.entered,
    held: analysis.heldDuration > 0,
  };
}

function judgeHold(
  note: JudgementNote,
  pointerSamples: PointerSample[],
  holdState?: LyricHoldState,
): JudgementAttempt {
  const latest = pointerSamples[pointerSamples.length - 1];
  if (latest === undefined) return { status: "noGesture" };

  // holdMs 0 ⇒ an invalid lyric (no following note to bound the hold, flagged at chart
  // load): the zero-length window holds nothing, so it resolves as a miss.
  const holdMs = note.holdMs ?? 0;
  const holdEnd = note.time + holdMs;
  const analysis = holdState !== undefined
    ? toHoldAnalysis(holdState)
    : analyzeHold(
      note,
      clipSamples(
        pointerSamples,
        note.time - TIER1_MS,
        Math.min(latest.songMs, holdEnd),
      ),
      holdEnd,
    );

  const { judgement, held } = buildHoldJudgement(note, analysis, holdMs);
  const latestInside = Math.hypot(latest.x - note.x, latest.y - note.y) <= LYRIC_HOLD_RADIUS;

  // Finalize at the hold end so feedback lands on the beat, or early when the player
  // releases after having held (the held fraction is then fixed). A mere early brush
  // before the note start is not a release — the player can still enter and hold.
  if (latest.songMs >= holdEnd) return { status: "judged", judgement };
  if (held && !latestInside) return { status: "judged", judgement };
  return { status: "pending", best: judgement };
}

export function judgeGesture(
  note: JudgementNote,
  pointerSamples: PointerSample[],
  prevNoteTime?: number,
  lyricHoldState?: LyricHoldState,
): JudgementAttempt {
  if (note.kind === "lyric") return judgeHold(note, pointerSamples, lyricHoldState);

  const latest = pointerSamples[pointerSamples.length - 1];
  if (latest === undefined) return { status: "noGesture" };

  const best = selectBestCandidate(note, pointerSamples);
  if (!best) return { status: "noGesture" };
  if (gestureSettled(best, note, latest, prevNoteTime)) return { status: "judged", judgement: best };
  const tt = timingTiers(note.kind);
  if (canStillImprove(best, latest.songMs, note.time, tt.t3, tt.t2)) return { status: "pending", best };
  return { status: "judged", judgement: best };
}
