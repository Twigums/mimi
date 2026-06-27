import type { Note } from "./engine";

// Range lookup over the song's sung characters: the text of every character whose start
// time falls in [startMs, endMs), concatenated in order. With `includePrevChar`, the
// character in progress at startMs (the latest onset before it) is prepended. Implemented
// by makeCharLookup over a TextAlive video; the engine stays TextAlive-agnostic.
export type CharLookup = (startMs: number, endMs: number, includePrevChar?: boolean) => string;

// A vocal character's TextAlive onset commonly leads its authored lyric note, by up to
// roughly this many ms. The epsilon is the lead tolerance at a lyric boundary: a char
// within epsilon before a lyric's note counts as that lyric's, and a char within epsilon
// before its hold end is left for the following boundary. A syllable that leads by more
// than epsilon is recovered by the previous-char fallback in populateLyricChars.
export const LYRIC_CHAR_BOUNDARY_EPSILON_MS = 80;

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

// The end bound normally trims epsilon off the hold end, leaving a char within epsilon of
// the bounding event for the next boundary. An `includeEndChar` lyric (a `finish`-marked
// clap in osu) instead *extends* the bound by epsilon to claim that closing syllable — its
// window is (note − epsilon, holdEnd + epsilon).
export function lyricCharWindow(
  note: Note,
  prevEnd: number,
): { startMs: number; endMs: number; clampedToPrev: boolean } {
  const rawStart = note.time - LYRIC_CHAR_BOUNDARY_EPSILON_MS;
  const prevBoundaryStart = prevEnd - LYRIC_CHAR_BOUNDARY_EPSILON_MS;
  const endEpsilon = note.includeEndChar ? LYRIC_CHAR_BOUNDARY_EPSILON_MS : -LYRIC_CHAR_BOUNDARY_EPSILON_MS;
  return {
    startMs: Math.max(rawStart, prevBoundaryStart),
    endMs: note.time + (note.holdMs ?? 0) + endEpsilon,
    clampedToPrev: prevBoundaryStart > rawStart,
  };
}

// The last character (code-point aware) of a concatenated lookup result, or "" if empty.
const lastChar = (s: string): string => {
  const chars = Array.from(s);
  return chars.length ? chars[chars.length - 1] : "";
};

// Auto-fill each lyric's text with every sung character in its hold window (typically
// 1–4 chars). Runs after computeLyricHolds, so holdMs is set. An explicit chart
// override (lyricChar already present) and invalid (unbounded) lyrics are skipped.
//
// The fetch window is [note.time - epsilon, holdEnd - epsilon): it admits a char whose
// onset leads the note by up to epsilon and excludes a char within epsilon of the hold
// end (it belongs to the next boundary). The lower bound is clamped to the previous
// boundary minus epsilon, so adjacent lyric windows don't overlap.
//
// When no character onsets near the note time — nothing in [note − epsilon, note + epsilon]
// — the syllable the note sits on began earlier and is still in progress, so the lookup is
// asked to include that previous (in-progress) character.
//
// If the window is still empty — the syllable leads the note by more than epsilon, so its
// onset never landed inside — fall back to the last char between the previous note and the
// window start, so the note still shows the syllable it sits on. The lookback is bounded
// below by prevEnd, so it can only pick up a char orphaned in the gap before this note,
// never one already claimed by a previous lyric's window.
//
// `charsInRange` returns the text of every sung character whose start time falls in
// [startMs, endMs), concatenated in order (empty when none).
export function populateLyricChars(
  notes: Note[],
  charsInRange: CharLookup,
): void {
  const eps = LYRIC_CHAR_BOUNDARY_EPSILON_MS;
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (note.kind !== "lyric" || note.lyricChar !== undefined || note.holdMs === undefined) continue;
    const prevEnd = i > 0 ? noteEndMs(notes[i - 1]) : -Infinity;
    const { startMs, endMs } = lyricCharWindow(note, prevEnd);
    // When no character onsets near the note time, the syllable it sits on began earlier and
    // is still in progress, so ask the lookup to prepend it. Gate this on the partition gap
    // [prevEnd − eps, startMs) being non-empty: that bounds the in-progress char to this
    // lyric's side, so a long syllable the previous lyric already showed is not repeated.
    const includePrev =
      charsInRange(note.time - eps, note.time + eps) === "" &&
      charsInRange(prevEnd - eps, startMs) !== "";
    const text = charsInRange(startMs, endMs, includePrev) || lastChar(charsInRange(prevEnd, startMs));
    note.lyricChar = text;
    if (text === "") {
      console.warn(`[mimi] lyric note at ${note.time}ms: no vocal characters in its hold window`);
    }
  }
}
