import type { Note } from "./engine";

// TextAlive character timings can land a few milliseconds to either side of an authored
// lyric boundary. Treat chars within epsilon of a lyric start as part of that lyric, and
// chars within epsilon of its end as part of the following boundary instead.
export const LYRIC_CHAR_BOUNDARY_EPSILON_MS = 20;

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
  const prevBoundaryStart = prevEnd - LYRIC_CHAR_BOUNDARY_EPSILON_MS;
  return {
    startMs: Math.max(rawStart, prevBoundaryStart),
    endMs: note.time + (note.holdMs ?? 0) - LYRIC_CHAR_BOUNDARY_EPSILON_MS,
    clampedToPrev: prevBoundaryStart > rawStart,
  };
}

// Auto-fill each lyric's text with every sung character in its hold window (typically
// 1–4 chars). Runs after computeLyricHolds, so holdMs is set. An explicit chart
// override (lyricChar already present) and invalid (unbounded) lyrics are skipped.
//
// The effective fetch window is [note.time - epsilon, holdEnd - epsilon). This includes
// chars that are within epsilon before the lyric start, and excludes chars that are
// within epsilon before the hold end. The lower bound is clamped to the previous
// boundary minus epsilon, so adjacent lyric windows still tile without overlap.
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
