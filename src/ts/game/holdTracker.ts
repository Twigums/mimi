import { LYRIC_HOLD_RADIUS } from "./judgement";

/** Incremental lyric-hold metrics; updated once per tick (not replayed from samples). */
export interface LyricHoldState {
  noteTime: number;
  holdEnd: number;
  closest: number;
  closestMs: number;
  firstInsideMs: number;
  bestHeldMs: number;
  runStartMs: number | null;
  runEndMs: number;
}

export interface HoldAnalysis {
  entered: boolean;
  closest: number;
  offsetMs: number;
  heldDuration: number;
}

export function createLyricHoldState(noteTime: number, holdMs: number): LyricHoldState {
  return {
    noteTime,
    holdEnd: noteTime + holdMs,
    closest: Infinity,
    closestMs: noteTime,
    firstInsideMs: Infinity,
    bestHeldMs: 0,
    runStartMs: null,
    runEndMs: 0,
  };
}

function flushRun(state: LyricHoldState): void {
  if (state.runStartMs === null) return;
  const overlap = Math.min(state.runEndMs, state.holdEnd) - Math.max(state.runStartMs, state.noteTime);
  if (overlap > state.bestHeldMs) state.bestHeldMs = overlap;
  state.runStartMs = null;
}

/** Record one pointer sample for a pending lyric within its tracking window. */
export function updateLyricHoldState(
  state: LyricHoldState,
  noteX: number,
  noteY: number,
  x: number,
  y: number,
  songMs: number,
): void {
  const d = Math.hypot(x - noteX, y - noteY);
  if (d < state.closest) {
    state.closest = d;
    state.closestMs = songMs;
  }
  if (d <= LYRIC_HOLD_RADIUS) {
    if (songMs < state.firstInsideMs) state.firstInsideMs = songMs;
    if (state.runStartMs === null) state.runStartMs = songMs;
    state.runEndMs = songMs;
  } else {
    flushRun(state);
  }
}

function heldDurationSoFar(state: LyricHoldState): number {
  let best = state.bestHeldMs;
  if (state.runStartMs !== null) {
    const overlap = Math.min(state.runEndMs, state.holdEnd) - Math.max(state.runStartMs, state.noteTime);
    if (overlap > best) best = overlap;
  }
  return Math.max(0, best);
}

export function toHoldAnalysis(state: LyricHoldState): HoldAnalysis {
  const entered = state.firstInsideMs !== Infinity;
  const offsetMs = !entered ? state.closestMs - state.noteTime
    : state.firstInsideMs <= state.noteTime ? 0
    : state.firstInsideMs - state.noteTime;
  return {
    entered,
    closest: state.closest,
    offsetMs,
    heldDuration: heldDurationSoFar(state),
  };
}
