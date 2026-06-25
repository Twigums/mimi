import type { TextAliveChar, TextAliveVideo } from "./textalive";

// Build a range lookup over the song's characters (a fixed, time-ordered list once the
// video is ready): returns the text of every character whose start time falls in
// [startMs, endMs), concatenated in order. Used to auto-fill a lyric note from its hold
// window. Deterministic given the loaded video — the only input is the time range.
//
// TextAlive's `char.next` is a song-wide linked list: it does NOT stop at phrase
// boundaries. Walking it unbounded from every phrase's first char would re-collect each
// later char once per preceding phrase (a phrase-3 char three times, etc.), so the
// per-phrase walk is bounded by the phrase's own end — the same guard the storyboard
// uses (storyboard.ts) — to collect every char exactly once.
export function makeCharLookup(video: TextAliveVideo): (startMs: number, endMs: number) => string {
  const chars: TextAliveChar[] = [];
  let phrase = video.firstPhrase;
  while (phrase) {
    let c = phrase.firstChar;
    while (c && c.startTime <= phrase.endTime) { chars.push(c); c = c.next; }
    phrase = phrase.next;
  }
  return (startMs: number, endMs: number) => {
    let text = "";
    for (const c of chars) {
      if (c.startTime >= startMs && c.startTime < endMs) text += c.text;
    }
    return text;
  };
}
