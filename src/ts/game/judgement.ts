import { angleDiff, clamp } from "../core/utils";

export const TIER3_MS               = 30;
export const TIER2_MS               = 60;
export const TIER1_MS               = 120;
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
  | { status: "outOfContact"; gesture: GesturePhrase }
  | { status: "outOfTimingWindow"; gesture: GesturePhrase; offsetMs: number }
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

export function getGesturePhrase(note: JudgementNote, pointerSamples: PointerSample[]): GesturePhrase | null {
  if (pointerSamples.length < 2) return null;
  const windowStart = note.time - TIER1_MS;
  const windowEnd = note.time + TIER1_MS;

  let firstPoint: { x: number; y: number; songMs: number } | null = null;
  let lastPoint: { x: number; y: number; songMs: number } | null = null;
  let totalTravel = 0;
  let bestContactDistance = Infinity;
  let impactSongMs = note.time;

  for (let i = 0; i < pointerSamples.length - 1; i++) {
    const prev = pointerSamples[i];
    const curr = pointerSamples[i + 1];
    if (curr.songMs < windowStart || prev.songMs > windowEnd) continue;

    const segmentStartMs = Math.max(prev.songMs, windowStart);
    const segmentEndMs = Math.min(curr.songMs, windowEnd);
    const segmentDuration = curr.songMs - prev.songMs;
    if (segmentDuration <= 0) continue;

    const segmentStartT = (segmentStartMs - prev.songMs) / segmentDuration;
    const segmentEndT = (segmentEndMs - prev.songMs) / segmentDuration;
    const segmentDx = curr.x - prev.x;
    const segmentDy = curr.y - prev.y;
    const startX = prev.x + segmentStartT * segmentDx;
    const startY = prev.y + segmentStartT * segmentDy;
    const endX = prev.x + segmentEndT * segmentDx;
    const endY = prev.y + segmentEndT * segmentDy;
    const startSongMs = segmentStartMs;
    const endSongMs = segmentEndMs;

    if (!firstPoint || startSongMs < firstPoint.songMs) {
      firstPoint = { x: startX, y: startY, songMs: startSongMs };
    }
    if (!lastPoint || endSongMs > lastPoint.songMs) {
      lastPoint = { x: endX, y: endY, songMs: endSongMs };
    }

    const segmentTravel = Math.hypot(endX - startX, endY - startY);
    totalTravel += segmentTravel;

    const segmentLenSq = segmentTravel * segmentTravel;
    const t = segmentLenSq === 0 ? 0 : clamp(
      ((note.x - startX) * (endX - startX) + (note.y - startY) * (endY - startY)) / segmentLenSq,
      0, 1,
    );
    const closestX = startX + t * (endX - startX);
    const closestY = startY + t * (endY - startY);
    const contactDistance = Math.hypot(closestX - note.x, closestY - note.y);
    if (contactDistance < bestContactDistance) {
      bestContactDistance = contactDistance;
      impactSongMs = startSongMs + (endSongMs - startSongMs) * t;
    }
  }

  if (!firstPoint || !lastPoint) return null;

  return {
    travel: totalTravel,
    direction: Math.atan2(lastPoint.y - firstPoint.y, lastPoint.x - firstPoint.x),
    impactSongMs,
    contactDistance: bestContactDistance,
  };
}

function flowContinuityCap(note: JudgementNote, moveAngle: number, previousFlowNote?: PreviousFlowNote): HitResult {
  if (note.flowPrevIndex === undefined) return "tier3";
  if (!previousFlowNote || previousFlowNote.state !== "hit" || previousFlowNote.hitResult === "miss") return "tier1";
  const pathAngle = Math.atan2(note.y - previousFlowNote.y, note.x - previousFlowNote.x);
  return capUpper(Math.abs(angleDiff(moveAngle, pathAngle)), FLOW_CONT_TIER3, FLOW_CONT_TIER2, FLOW_CONT_TIER1);
}

export function judgeGesture(
  note: JudgementNote,
  pointerSamples: PointerSample[],
  previousFlowNote?: PreviousFlowNote,
): JudgementAttempt {
  const gesture = getGesturePhrase(note, pointerSamples);
  if (!gesture) return { status: "noGesture" };

  let gestureCap: HitResult = "tier3";
  let missReason: MissReason | null = null;

  if (gesture.contactDistance > CUT_CONTACT_TIER1) return { status: "outOfContact", gesture };
  gestureCap = minTier(gestureCap, capUpper(gesture.contactDistance, CUT_CONTACT_TIER3, CUT_CONTACT_TIER2, CUT_CONTACT_TIER1));

  const travelCap = capLower(gesture.travel, CUT_TRAVEL_TIER3, CUT_TRAVEL_TIER2, CUT_TRAVEL_TIER1);
  if (travelCap === "miss") missReason = "travel";
  else gestureCap = minTier(gestureCap, travelCap);

  if (note.kind !== "lyric") {
    const directionError = Math.abs(angleDiff(gesture.direction, note.direction));
    const directionCap = capUpper(directionError, CUT_DIRECTION_TIER3, CUT_DIRECTION_TIER2, CUT_DIRECTION_TIER1);
    if (directionCap === "miss") missReason = "direction";
    else gestureCap = minTier(gestureCap, directionCap);

    if (note.kind === "flow") {
      const continuityCap = flowContinuityCap(note, gesture.direction, previousFlowNote);
      if (continuityCap === "miss") missReason = "continuity";
      else gestureCap = minTier(gestureCap, continuityCap);
    }
  }

  const offsetMs = gesture.impactSongMs - note.time;
  if (Math.abs(offsetMs) > TIER1_MS) return { status: "outOfTimingWindow", gesture, offsetMs };
  if (missReason) {
    return {
      status: "judged",
      judgement: {
        result: "miss",
        points: 0,
        offsetMs,
        timing: timingFor(offsetMs),
        missReason,
        gesture,
      },
    };
  }

  const timingScore = scoreFor(offsetMs);
  const result = minTier(timingScore.result, gestureCap);
  const points = result === "tier3" ? TIER3_POINTS
    : result === "tier2" ? TIER2_POINTS
    : result === "tier1" ? TIER1_POINTS
    : 0;

  return {
    status: "judged",
    judgement: {
      result,
      points,
      offsetMs,
      timing: timingFor(offsetMs),
      gesture,
    },
  };
}
