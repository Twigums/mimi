import type { Note } from "../game/engine";
import { LYRIC_CHAR_MAX_DIST_MS } from "../game/engine";
import {
  LYRIC_CHAR_BOUNDARY_EPSILON_MS,
  lyricCharWindow,
  noteEndMs,
} from "../game/lyrics";
import { collectTextAliveChars, walkPhraseChars } from "./charLookup";
import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "./textalive";

export interface ExcludeRange { from: number; to: number; }

// Flatten the TextAlive video into a single time-ordered char list (phrase by
// phrase, char by char), the input the matcher consumes.
export function flattenChars(video: TextAliveVideo): TextAliveChar[] {
  return collectTextAliveChars(video);
}

export interface LyricMatchResult {
  // Each TextAlive char that a lyric note claims, mapped to its note. The
  // storyboard uses this to render note-mapped chars as empty outlines until the
  // note is hit (then fill) or missed (then stay empty).
  charToNote: Map<TextAliveChar, Note>;
}

function isVideo(v: TextAliveChar[] | TextAliveVideo): v is TextAliveVideo {
  return !Array.isArray(v) && "firstPhrase" in v;
}

const collectPhrases = (video: TextAliveVideo): TextAlivePhrase[] => {
  const phrases: TextAlivePhrase[] = [];
  const seen = new Set<TextAlivePhrase>();
  for (let phrase = video.firstPhrase; phrase && !seen.has(phrase); phrase = phrase.next) {
    seen.add(phrase);
    phrases.push(phrase);
  }
  return phrases;
};

function charDist(c: TextAliveChar, timeMs: number): number {
  if (timeMs >= c.startTime && timeMs <= c.endTime) return 0;
  return Math.min(Math.abs(c.startTime - timeMs), Math.abs(c.endTime - timeMs));
}

const last = <T>(xs: T[]): T | undefined => xs.length > 0 ? xs[xs.length - 1] : undefined;

/** Find a phrase-local char run matching authored `char=` text; pick nearest onset to anchor time. */
function findAuthoredCharRun(
  phrases: TextAlivePhrase[],
  text: string,
  anchorTime: number,
  excluded: Set<TextAliveChar>,
): TextAliveChar[] | null {
  let best: { run: TextAliveChar[]; dist: number } | null = null;
  for (const phrase of phrases) {
    const pc = walkPhraseChars(phrase).filter(c => !excluded.has(c));
    for (let i = 0; i < pc.length; i++) {
      let built = "";
      const run: TextAliveChar[] = [];
      for (let j = i; j < pc.length && built.length < text.length; j++) {
        built += pc[j].text;
        run.push(pc[j]);
        if (built.length > text.length) break;
        if (built === text) {
          const dist = Math.abs(pc[i].startTime - anchorTime);
          if (!best || dist < best.dist) best = { run: [...run], dist };
          break;
        }
        if (!text.startsWith(built)) break;
      }
    }
  }
  return best?.run ?? null;
}

// Assign TextAlive characters to lyric notes.
//
// Matching is **containment-first**: a note whose time falls inside a character's span
// sources that character and does NOT consume it, so several notes placed over one
// long-held kanji (e.g. か, が, やき all over 輝) all funnel from the same glyph. When no
// character contains the note time, it falls back to the nearest *unconsumed* character
// within the window and consumes it, so notes that land between characters spread out
// instead of duplicating (自分 → 自 then 分, not 自 twice). Chars inside an exclude range
// are never sourced. A `lyricSpan` grabs the source char plus the following chars for the
// text; a manual `lyricChar` override keeps its text and resolves the source run by exact
// phrase-local text first, then time. Mutates `note.lyricChar` for auto notes.
export function matchLyrics(
  charsOrVideo: TextAliveChar[] | TextAliveVideo,
  notes: Note[],
  excludes: ExcludeRange[],
): LyricMatchResult {
  const video = isVideo(charsOrVideo) ? charsOrVideo : null;
  const chars = video ? flattenChars(video) : charsOrVideo;
  const phrases = video ? collectPhrases(video) : null;
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

  const bindAuthoredRun = (run: TextAliveChar[], note: Note, anchorTime: number): void => {
    const idx = chars.indexOf(run[0]);
    const shared = idx >= 0 && anchorTime >= run[0].startTime && anchorTime <= run[run.length - 1].endTime;
    for (const c of run) {
      charToNote.set(c, note);
      if (!shared) consumed.add(c);
    }
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

    const anchorTime = note.lyricSrcTime ?? note.time;

    if (override && phrases) {
      const run = findAuthoredCharRun(phrases, note.lyricChar!, anchorTime, excluded);
      if (run && run.length > 0) {
        bindAuthoredRun(run, note, anchorTime);
        continue;
      }
    }

    let idx = containingIdx(anchorTime);
    const shared = idx >= 0;
    if (idx < 0) idx = nearestFreeIdx(anchorTime);

    if (idx < 0) {
      if (!override) {
        note.lyricChar = "";
        console.warn(`[mimi] lyric note at ${note.time}ms: no vocal char within ${LYRIC_CHAR_MAX_DIST_MS}ms`);
      } else {
        console.warn(`[mimi] lyric note at ${note.time}ms: no phrase run for char=${note.lyricChar}`);
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
