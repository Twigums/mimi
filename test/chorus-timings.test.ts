import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { matchLyrics } from "../src/ts/song/lyricMatch";
import type { Note } from "../src/ts/game/engine";
import {
  isDegeneratePhrase,
  loadChorusTimingsJsonc,
  mergeChorusTimings,
  parseChorusTimingsJsonc,
} from "../src/ts/song/chorusTimings";
import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "../src/ts/song/textalive";

const wikiJsonc = readFileSync(resolve(process.cwd(), "wiki/6W2N_chorus_timings.jsonc"), "utf8");
const { phrases, wordSizes } = loadChorusTimingsJsonc(wikiJsonc);

assert.equal(phrases.length, 2);
assert.equal(phrases[0].text, "どれほどの苦しみも悲しみの向こうに");
assert.equal(phrases[1].text, "きっと私の目指す私がいると信じ続けていた");
assert.equal(phrases[0].chars.length, 17);
assert.equal(phrases[1].chars.length, 20);
assert.equal(phrases[0].chars[0].text, "ど");
assert.equal(phrases[0].chars[0].startTime, 52140);

function degenerateVideo(): TextAliveVideo {
  const chars: TextAliveChar[] = Array.from({ length: 17 }, (_, i) => ({
    text: "x",
    startTime: 65307 + i,
    endTime: 65308 + i,
    next: null,
    parent: null,
  }));
  for (let i = 0; i < chars.length - 1; i++) chars[i].next = chars[i + 1];
  const bad: TextAlivePhrase = {
    startTime: 65307,
    endTime: 65381,
    text: "placeholder",
    firstChar: chars[0],
    next: null,
  };
  assert.equal(isDegeneratePhrase(bad), true);
  return {
    duration: 120000,
    charCount: chars.length,
    firstPhrase: bad,
    findPhrase: () => bad,
    findChar: t => chars.find(c => t >= c.startTime && t <= c.endTime) ?? null,
  };
}

const merged = mergeChorusTimings(degenerateVideo(), phrases, wordSizes);
assert.equal(merged.findChar(53545)?.text, "苦");
assert.equal(merged.findChar(65307)?.text, "け");

function note(time: number): Note {
  return { kind: "lyric", time, x: 300, y: 300, direction: 0, state: "pending", holdMs: 900 };
}

{
  const notes = [
    note(53545),
    note(55161),
    note(57238),
    note(58853),
  ];
  notes[0].includeEndChar = true;
  notes[1].includeEndChar = true;
  notes[3].includeEndChar = true;

  const flat: TextAliveChar[] = [];
  let p = merged.firstPhrase;
  while (p) {
    let c = p.firstChar;
    while (c) { flat.push(c); c = c.next; }
    p = p.next;
  }
  flat.sort((a, b) => a.startTime - b.startTime);

  const { charToNote } = matchLyrics(flat, notes, []);
  assert.ok([...charToNote.values()].some(n => n.time === 53545));
  assert.ok(notes[0].lyricChar && notes[0].lyricChar.length > 0);
}

console.log("chorus timings: parse, merge, and lyric match checks passed");
