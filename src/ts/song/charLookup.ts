import type { TextAliveChar, TextAliveVideo } from "./textalive";
import type { CharLookup } from "../game/lyrics";

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
// TextAlive's `char.next` is a song-wide linked list: it does NOT stop at phrase
// boundaries. Walking it unbounded from every phrase's first char would re-collect each
// later char once per preceding phrase (a phrase-3 char three times, etc.), so the
// per-phrase walk is bounded by the phrase's own end — the same guard the storyboard
// uses (storyboard.ts) — to collect every char exactly once.
export function makeCharLookup(video: TextAliveVideo): CharLookup {
  const chars: TextAliveChar[] = [];
  let phrase = video.firstPhrase;
  while (phrase) {
    let c = phrase.firstChar;
    while (c && c.startTime <= phrase.endTime) { chars.push(c); c = c.next; }
    phrase = phrase.next;
  }
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
