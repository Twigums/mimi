import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "./textalive";
import type { CharLookup } from "../game/lyrics";

// TextAlive's `char.next` is a song-wide linked list. A phrase's `firstChar` points into
// that global stream; it is not a private phrase-local list. Some phrase spans also abut
// or overlap, so bounded per-phrase walks can miss later chars from a parent phrase or
// collect shared boundary chars twice. Collect from the global linked list, de-dupe by
// object identity and stable timing/text identity, then sort once for deterministic range
// lookups and storyboard rendering.
export function collectTextAliveChars(video: TextAliveVideo): TextAliveChar[] {
  const chars: TextAliveChar[] = [];
  const seenNodes = new Set<TextAliveChar>();
  const seenKeys = new Set<string>();
  const order = new Map<TextAliveChar, number>();

  let phrase = video.firstPhrase;
  while (phrase) {
    let c = phrase.firstChar;
    while (c) {
      if (seenNodes.has(c)) break;
      seenNodes.add(c);

      const key = `${c.startTime}\0${c.endTime}\0${c.text}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        order.set(c, chars.length);
        chars.push(c);
      }
      c = c.next;
    }
    phrase = phrase.next;
  }

  return chars.sort((a, b) =>
    a.startTime - b.startTime || a.endTime - b.endTime || (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
}

/** Chars belonging to one phrase — bounded so a song-wide `char.next` chain cannot bleed in. */
export function walkPhraseChars(phrase: TextAlivePhrase): TextAliveChar[] {
  const out: TextAliveChar[] = [];
  let c = phrase.firstChar;
  while (c) {
    if (c.startTime > phrase.endTime) break;
    if (c.startTime >= phrase.startTime) out.push(c);
    c = c.next;
  }
  return out;
}

// Build a range lookup over the song's characters (a fixed, time-ordered list once the
// video is ready): returns the text of every character whose start time falls in
// [startMs, endMs), concatenated in order. Used to auto-fill a lyric note from its hold
// window. Deterministic given the loaded video — the only input is the time range.
//
// With `includePrevChar`, the syllable still in progress at startMs is prepended — the
// character whose onset precedes startMs but whose end is after it (still sounding when the
// window opens), which a window opening after that syllable's onset would otherwise miss.
// A character that already ended before startMs is not in progress, so it is not pulled in
// (this keeps an adjacent lyric's finished syllable from being borrowed).
//
export function makeCharLookup(video: TextAliveVideo): CharLookup {
  const chars = collectTextAliveChars(video);
  return (startMs: number, endMs: number, includePrevChar = false) => {
    let text = "";
    let prev: TextAliveChar | null = null;
    for (const c of chars) {
      if (c.startTime < startMs) {
        // The latest syllable still sounding at startMs (onset before, end after).
        if (c.endTime > startMs && (!prev || c.startTime > prev.startTime)) prev = c;
      } else if (c.startTime < endMs) {
        text += c.text;
      }
    }
    return includePrevChar && prev ? prev.text + text : text;
  };
}
