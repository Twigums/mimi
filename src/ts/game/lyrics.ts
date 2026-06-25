import type { Note } from "./engine";

// A lyric auto-fills with every sung character within its hold window. The window reaches
// back by this tolerance before the note time so a note charted slightly after a
// syllable's onset still claims its first character; the reach-back is clamped to the
// previous note's end so it never steals a syllable from the prior hold (adjacent lyric
// windows stay a clean, non-overlapping partition of the song timeline).
export const LYRIC_CHAR_WINDOW_TOL_MS = 80;

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

// Auto-fill each lyric's text with every sung character in its hold window (typically
// 1–4 chars). Runs after computeLyricHolds, so holdMs is set. An explicit chart
// override (lyricChar already present) and invalid (unbounded) lyrics are skipped.
//
// The window runs from a tolerance before the note time up to — but excluding — the
// hold's end (note.time + holdMs). The upper bound is exclusive, so a syllable starting
// exactly on the bounding event belongs to the next note, not this one. The lower bound
// is clamped to the previous note's end so the backward tolerance only reaches into a
// gap, never into the prior hold: adjacent windows tile without overlap (no syllable
// claimed twice) and a short hold can't slide its whole window before its own note.
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
    const start = Math.max(note.time - LYRIC_CHAR_WINDOW_TOL_MS, prevEnd);
    const text = charsInRange(start, note.time + note.holdMs);
    note.lyricChar = text;
    if (text === "") {
      console.warn(`[mimi] lyric note at ${note.time}ms: no vocal characters in its hold window`);
    }
  }
}
