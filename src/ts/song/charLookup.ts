import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "./textalive";
import type { CharLookup } from "../game/lyrics";

// TextAlive's `char.next` is a song-wide linked list
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

export function walkPhraseChars(phrase: TextAlivePhrase): TextAliveChar[] {
  const out: TextAliveChar[] = [];
  let c = phrase.firstChar;
  while (c) {
    if (c.startTime >= phrase.endTime) break;
    if (c.startTime >= phrase.startTime) out.push(c);
    c = c.next;
  }
  return out;
}

export function makeCharLookup(video: TextAliveVideo): CharLookup {
  const chars = collectTextAliveChars(video);
  return (startMs: number, endMs: number, includePrevChar = false) => {
    let text = "";
    let prev: TextAliveChar | null = null;
    for (const c of chars) {
      if (c.startTime < startMs) {

        // The latest syllable still sounding at startMs
        if (c.endTime > startMs && (!prev || c.startTime > prev.startTime)) prev = c;
      } else if (c.startTime < endMs) {
        text += c.text;
      }
    }
    return includePrevChar && prev ? prev.text + text : text;
  };
}