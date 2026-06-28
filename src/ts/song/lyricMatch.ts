import type { Note } from "../game/engine";
import { LYRIC_CHAR_MAX_DIST_MS } from "../game/engine";
import {
  LYRIC_CHAR_BOUNDARY_EPSILON_MS,
  lyricCharWindow,
  noteEndMs,
} from "../game/lyrics";
import { collectTextAliveChars } from "./charLookup";
import type { TextAliveChar, TextAliveVideo } from "./textalive";

export interface ExcludeRange { from: number; to: number; }

export function flattenChars(video: TextAliveVideo): TextAliveChar[] {
  return collectTextAliveChars(video);
}

export interface LyricMatchResult {
  charToNote: Map<TextAliveChar, Note>;
}

function charDist(c: TextAliveChar, timeMs: number): number {
  if (timeMs >= c.startTime && timeMs <= c.endTime) return 0;
  return Math.min(Math.abs(c.startTime - timeMs), Math.abs(c.endTime - timeMs));
}

const last = <T>(xs: T[]): T | undefined => xs.length > 0 ? xs[xs.length - 1] : undefined;

// Assign TextAlive characters to lyric notes
export function matchLyrics(
  chars: TextAliveChar[],
  notes: Note[],
  excludes: ExcludeRange[],
): LyricMatchResult {
  const charToNote = new Map<TextAliveChar, Note>();
  const consumed = new Set<TextAliveChar>();
  const excluded = new Set<TextAliveChar>();

  const isExcluded = (c: TextAliveChar): boolean =>
    excludes.some(r => c.startTime >= r.from && c.startTime <= r.to);
  for (const c of chars) if (isExcluded(c)) excluded.add(c);

  const lyricNotes = notes
    .filter(n => n.kind === "lyric")
    .sort((a, b) => a.time - b.time);

  const containingIdx = (t: number): number =>
    chars.findIndex(c => !excluded.has(c) && t >= c.startTime && t <= c.endTime);

  const nearestFreeIdx = (t: number): number => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (excluded.has(c) || consumed.has(c)) continue;
      const d = charDist(c, t);
      if (d < bd) { bd = d; bi = i; }
    }
    return bd <= LYRIC_CHAR_MAX_DIST_MS ? bi : -1;
  };

  const charsInRange = (startMs: number, endMs: number): TextAliveChar[] =>
    chars.filter(c => !excluded.has(c) && c.startTime >= startMs && c.startTime < endMs);

  const previousInProgress = (startMs: number): TextAliveChar | undefined => {
    let best: TextAliveChar | undefined;
    for (const c of chars) {
      if (excluded.has(c) || c.startTime >= startMs || c.endTime <= startMs) continue;
      if (!best || c.startTime > best.startTime) best = c;
    }
    return best;
  };

  const matchHoldWindow = (note: Note, noteIndex: number): TextAliveChar[] => {
    const prevEnd = noteIndex > 0 ? noteEndMs(notes[noteIndex - 1]) : -Infinity;
    const { startMs, endMs } = lyricCharWindow(note, prevEnd);
    const eps = LYRIC_CHAR_BOUNDARY_EPSILON_MS;
    const selected = charsInRange(startMs, endMs);
    const includePrev =
      charsInRange(note.time - eps, note.time + eps).length === 0 &&
      charsInRange(prevEnd - eps, startMs).length > 0;
    const inProgress = includePrev ? previousInProgress(startMs) : undefined;
    const result = inProgress ? [inProgress, ...selected] : selected;
    const fallback = last(charsInRange(prevEnd, startMs));
    return result.length > 0 ? result : fallback ? [fallback] : [];
  };

  for (const note of lyricNotes) {
    const override = note.lyricChar !== undefined && note.lyricChar !== "";
    const noteIndex = notes.indexOf(note);
    const usesAuthoredSource = note.lyricSpan !== undefined || note.lyricSrcTime !== undefined;

    if (!override && note.holdMs !== undefined && !usesAuthoredSource) {
      const selected = matchHoldWindow(note, noteIndex);
      if (selected.length === 0) {
        note.lyricChar = "";
        console.warn(`[mimi] lyric note at ${note.time}ms: no vocal characters in its hold window`);
        continue;
      }
      note.lyricChar = selected.map(c => c.text).join("");
      for (const c of selected) charToNote.set(c, note);
      continue;
    }

    // An authored `src=<ms>` points the funnel at a specific TextAlive char by time
    const anchorTime = note.lyricSrcTime ?? note.time;

    let idx = containingIdx(anchorTime);
    const shared = idx >= 0;
    if (idx < 0) idx = nearestFreeIdx(anchorTime);

    if (idx < 0) {
      if (!override) {
        note.lyricChar = "";
        console.warn(`[mimi] lyric note at ${note.time}ms: no vocal char within ${LYRIC_CHAR_MAX_DIST_MS}ms`);
      }
      continue;
    }

    if (override) {
      charToNote.set(chars[idx], note);
      if (!shared) consumed.add(chars[idx]);
      continue;
    }

    const span = Math.max(1, note.lyricSpan ?? 1);
    let text = "";
    let taken = 0;
    for (let i = idx; i < chars.length && taken < span; i++) {
      const c = chars[i];
      if (excluded.has(c)) continue;
      if (!shared && consumed.has(c)) continue;
      if (!shared) consumed.add(c);
      charToNote.set(c, note);
      text += c.text;
      taken++;
    }
    note.lyricChar = text;
  }

  return { charToNote };
}