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
// Path straightness = net displacement / path length over the chosen sub-gesture
// (1 = a clean straight slash, lower = the path wanders or doubles back). This is
// what makes the selected gesture have to be *one coherent stroke*: contact and
// direction can no longer be borrowed from different motions inside the window,
// because any slice spanning a reversal scores low here. Cut only; reported in the
// gesture issue slot alongside travel.
export const CUT_STRAIGHT_TIER3  = 0.9;
export const CUT_STRAIGHT_TIER2  = 0.8;
export const CUT_STRAIGHT_TIER1  = 0.65;
// Flow caps run looser than cut — flow rewards continuous traced motion. Contact
// reuses the cut thresholds for now (FLOW_CONTACT_* kept for future tuning); flow
// has no direction cap, folding heading into the shape metric below.
export const FLOW_CONTACT_TIER3  = 65;
export const FLOW_CONTACT_TIER2  = 95;
export const FLOW_CONTACT_TIER1  = 130;
export const FLOW_TRAVEL_TIER3   = 24;
export const FLOW_TRAVEL_TIER2   = 12;
export const FLOW_TRAVEL_TIER1   = 4;
// Flow's perfect/great windows are more lenient than cut (gliding a phrase shouldn't
// demand cut-level precision per anchor). Tier 1 stays at the shared TIER1_MS so the
// engine's eligibility/expiry/draw windows are unchanged.
export const FLOW_TIER3_MS       = 70;
export const FLOW_TIER2_MS       = 120;
// Flow's single shape metric: the RMS angle between the gesture's heading sequence
// and the ribbon's local heading sequence (FLOW_SHAPE_BINS bins each). The perfect
// threshold stays generous so smooth curves and corners keep full credit, but the
// great/good boundaries are pulled in (issue #74) so a roughly perpendicular sweep
// (~90°) no longer earns a GREAT — it drops to GOOD, and clearly-wrong motion
// (sideways past ~100°, backward) misses outright.
export const FLOW_SHAPE_BINS     = 4;
export const FLOW_CONT_TIER3     = 35 * Math.PI / 180;
export const FLOW_CONT_TIER2     = 50 * Math.PI / 180;
export const FLOW_CONT_TIER1     = 70 * Math.PI / 180;

export type NoteKind   = "cut" | "flow" | "lyric";
export type HitResult  = "tier3" | "tier2" | "tier1" | "miss";
export type HitTiming  = "early" | "late" | "on";
// The four player-facing issue buckets. `gesture` captures whether the stroke
// itself was good — a cut's travel/slash and a flow's traced shape both report
// here (there is no separate `travel`/`flow`/`continuity` issue). `direction`
// applies to cut only; lyric and flow have no direction issue (flow folds heading
// into its shape, reported as `gesture`).
export type IssueReason = "timing" | "contact" | "direction" | "gesture";

export interface JudgementNote {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  // Flow only: the ribbon's local heading sequence (FLOW_SHAPE_BINS entries) the
  // gesture is matched against. Absent for a lone anchor (judged on motion only).
  flowShape?: number[];
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

// Per-kind timing windows. Flow widens tier3/tier2; tier1 stays shared so the engine
// windows keyed to TIER1_MS hold for every kind.
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
// Each heading reflects the path's shape over its bin, so no single raw sample is
// load-bearing. Returns null if the path has no length.
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

// The issue is the binding constraint that held the note below Tier 3: the first
// metric (in priority order) whose cap equals the final result. The result is the
// minimum of all caps, so at least one matches for any non-Tier-3 note; a clean
// Tier 3 has no issue. Travel (cut slash / flow motion) and the flow shape cap both
// surface as the single `gesture` issue.
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

// The flow shape cap: how well the gesture traces the ribbon's local shape. Gesture
// and ribbon are both reduced to a heading sequence (resampled by arc length), and the
// cap is the RMS per-bin heading error — position-invariant, so it measures shape, not
// distance. A lone anchor has no ribbon shape and is left free (travel/contact still
// require motion); the previous anchor's grade does not cascade into this one.
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
  // How directly the path connects its endpoints: 1 for a straight stroke, lower the
  // more it wanders or doubles back. A degenerate (no-motion) slice is treated as
  // straight so travel — not straightness — is what fails it.
  const straightness = pathLen > 1e-6 ? clamp(travel / pathLen, 0, 1) : 1;

  const isFlow = note.kind === "flow";
  const tt = timingTiers(note.kind);
  const timingScore = scoreFor(offsetMs, tt.t3, tt.t2, tt.t1);
  // Contact uses the cut thresholds for both kinds until there's evidence to tune
  // flow separately; FLOW_CONTACT_* are kept defined for that future tuning.
  const contactCap = capUpper(contactDistance, CUT_CONTACT_TIER3, CUT_CONTACT_TIER2, CUT_CONTACT_TIER1);
  const travelCap = isFlow
    ? capLower(travel, FLOW_TRAVEL_TIER3, FLOW_TRAVEL_TIER2, FLOW_TRAVEL_TIER1)
    : capLower(travel, CUT_TRAVEL_TIER3, CUT_TRAVEL_TIER2, CUT_TRAVEL_TIER1);
  let directionError = 0;
  let directionCap: HitResult = "tier3";
  let flowCap: HitResult = "tier3";
  // Straightness gates cut only: it forces the scored gesture to be one coherent
  // slash so contact and direction describe the same motion. Flow ribbons bend by
  // design and lyrics ignore shape, so both stay unconstrained here.
  let straightCap: HitResult = "tier3";

  if (note.kind === "cut") {
    directionError = Math.abs(angleDiff(direction, note.direction));
    directionCap = capUpper(directionError, CUT_DIRECTION_TIER3, CUT_DIRECTION_TIER2, CUT_DIRECTION_TIER1);
    straightCap = capLower(straightness, CUT_STRAIGHT_TIER3, CUT_STRAIGHT_TIER2, CUT_STRAIGHT_TIER1);
  } else if (isFlow) {
    // Flow has no separate direction cap: how the gesture follows the ribbon (heading
    // and bend) is the shape metric, reported in the "flow" / flow slot.
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
    // Gesture substance (real travel + a coherent straight path) ranks ahead of
    // direction so that, among equally-missing candidates, an actual reversed sweep
    // beats a degenerate zero-travel one parked near the note — the binding issue is
    // then the wrong direction, not a spurious "no gesture" from the parked point.
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

  // Cumulative path length so each slice's arc length (for the straightness metric)
  // is an O(1) difference rather than an inner re-sum.
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

export function getGesturePhrase(note: JudgementNote, pointerSamples: PointerSample[]): GesturePhrase | null {
  return selectBestCandidate(note, pointerSamples)?.gesture ?? null;
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

// The gesture for a cut is "settled" once the pointer has left the contact zone:
// no current motion is improving contact, and a better-timed re-cut would need a
// physically implausible re-approach within the few ms left. Committing here
// instead of holding for the timing window keeps non-perfect feedback from lagging
// behind an early cut (issue #53). The gate is the LATER of two floors: the note's
// own GOOD window opening (note.time − TIER1_MS — before that no result is even a
// non-miss, so an early sweep that leaves the zone sooner is not yet this note's
// gesture) and the previous note's time (a sweep toward an adjacent note must not
// claim this note during the previous note's territory). Using the GOOD-window
// floor — not the perfect-window start — keeps a legitimately early GOOD/GREAT cut
// committing promptly, while stopping spam from locking a grade hundreds of ms
// early off the back of a far-earlier previous note (issue #74).
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

export function judgeGesture(
  note: JudgementNote,
  pointerSamples: PointerSample[],
  prevNoteTime?: number,
): JudgementAttempt {
  const latest = pointerSamples[pointerSamples.length - 1];
  if (latest === undefined) return { status: "noGesture" };

  const best = selectBestCandidate(note, pointerSamples);
  if (!best) return { status: "noGesture" };
  if (gestureSettled(best, note, latest, prevNoteTime)) return { status: "judged", judgement: best };
  const tt = timingTiers(note.kind);
  if (canStillImprove(best, latest.songMs, note.time, tt.t3, tt.t2)) return { status: "pending", best };
  return { status: "judged", judgement: best };
}
