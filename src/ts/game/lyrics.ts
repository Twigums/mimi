import type { Note } from "./engine";

// A vocal character's TextAlive onset can lead its authored lyric note by a few tens of
// milliseconds. This epsilon is the lead tolerance at a lyric boundary: a char within
// epsilon before a lyric's note counts as that lyric's (not the previous one's), and a
// char within epsilon before a lyric's hold end is left for the following boundary.
export const LYRIC_CHAR_BOUNDARY_EPSILON_MS = 30;

// A lyric's note row resolves once its hold window plus the metric grace has passed.
// An invalid (unbounded) lyric has no hold, so it resolves at its note time like a tap.
export const noteEndMs = (n: Note): number =>
  n.time + (n.kind === "lyric" ? (n.holdMs ?? 0) : 0);

// A lyric is a hold lasting until the next event strictly after its start — no
// default, no cap. The bound is the nearest of: a following note (any kind) or an
// inert `end` marker time (a chart-level lyric-end marker, which lets the hold end
// where no playable note sits). Using "strictly after" keeps a note charted on the
// lyric's own beat (e.g. a cut leading into it) from collapsing the hold to zero. A
// lyric with no later event cannot be bounded: it is an invalid chart (left holdMs
// undefined and logged), and the engine judges it as a miss. See LYRIC_HOLD_PLAN.md.
export function computeLyricHolds(notes: Note[], endTimes: number[]): void {
  const boundTimes = notes.map(n => n.time).concat(endTimes).sort((a, b) => a - b);
  for (const n of notes) {
    if (n.kind !== "lyric") continue;
    const end = boundTimes.find(t => t > n.time);
    if (end !== undefined) {
      n.holdMs = end - n.time;
    } else {
      n.holdMs = undefined;
      console.error(`[mimi] lyric note at ${n.time}ms has no following note or end marker to bound its hold (invalid chart).`);
    }
  }
}

export function lyricCharWindow(
  note: Note,
  prevEnd: number,
): { startMs: number; endMs: number; clampedToPrev: boolean } {
  const rawStart = note.time - LYRIC_CHAR_BOUNDARY_EPSILON_MS;
  // Start collecting where the previous event ended (minus epsilon), so consecutive
  // lyric windows TILE the timeline with no gaps. When a flow/cut note sits between two
  // lyrics it bounds the earlier lyric's hold early; without tiling, a vocal char that
  // leads the later lyric falls into that uncovered gap and is dropped. For back-to-back
  // lyrics prevEnd == note.time, so the start stays note−epsilon; the first note has no
  // previous event (prevEnd is -Infinity), so it keeps the raw start.
  const prevBoundaryStart = prevEnd - LYRIC_CHAR_BOUNDARY_EPSILON_MS;
  const startMs = Number.isFinite(prevBoundaryStart) ? Math.min(rawStart, prevBoundaryStart) : rawStart;
  return {
    startMs,
    endMs: note.time + (note.holdMs ?? 0) - LYRIC_CHAR_BOUNDARY_EPSILON_MS,
    clampedToPrev: startMs < rawStart,
  };
}

// Auto-fill each lyric's text with every sung character in its hold window (typically
// 1–4 chars). Runs after computeLyricHolds, so holdMs is set. An explicit chart
// override (lyricChar already present) and invalid (unbounded) lyrics are skipped.
//
// The effective fetch window is [prevEnd - epsilon, holdEnd - epsilon): it starts where
// the previous note ended (so the windows tile with no gap and a char that leads this
// lyric across an intervening flow/cut note is still collected) and ends epsilon before
// the hold end (so a char within epsilon of the boundary belongs to the next lyric). For
// back-to-back lyrics prevEnd == note.time, i.e. [note.time - epsilon, holdEnd - epsilon).
//
// `charsInRange` returns the text of every sung character whose start time falls in
// [startMs, endMs), concatenated in order (empty when none).
export function populateLyricChars(
  notes: Note[],
  charsInRange: (startMs: number, endMs: number) => string,
): void {
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (note.kind !== "lyric" || note.lyricChar !== undefined || note.holdMs === undefined) continue;
    const prevEnd = i > 0 ? noteEndMs(notes[i - 1]) : -Infinity;
    const { startMs, endMs } = lyricCharWindow(note, prevEnd);
    const text = charsInRange(startMs, endMs);
    note.lyricChar = text;
    if (text === "") {
      console.warn(`[mimi] lyric note at ${note.time}ms: no vocal characters in its hold window`);
    }
  }
}
