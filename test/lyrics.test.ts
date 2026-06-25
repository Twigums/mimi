import assert from "node:assert/strict";
import {
  computeLyricHolds,
  lyricCharWindow,
  LYRIC_CHAR_BOUNDARY_EPSILON_MS,
  populateLyricChars,
} from "../src/ts/game/lyrics";
import { makeCharLookup } from "../src/ts/song/charLookup";
import type { Note } from "../src/ts/game/engine";
import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "../src/ts/song/textalive";

function note(kind: Note["kind"], time: number, overrides: Partial<Note> = {}): Note {
  return {
    kind,
    time,
    x: 400,
    y: 300,
    direction: 0,
    state: "pending",
    ...overrides,
  };
}

function videoFrom(chars: Array<[text: string, startTime: number]>): TextAliveVideo {
  const charNodes: TextAliveChar[] = chars.map(([text, startTime]) => ({
    text,
    startTime,
    endTime: startTime + 50,
    next: null,
  }));
  for (let i = 0; i < charNodes.length - 1; i++) charNodes[i].next = charNodes[i + 1];

  const phrase: TextAlivePhrase = {
    startTime: 0,
    endTime: 10_000,
    firstChar: charNodes[0] ?? null,
    text: chars.map(([text]) => text).join(""),
    next: null,
  };

  return {
    duration: 10_000,
    charCount: charNodes.length,
    firstPhrase: phrase,
    findPhrase: time => (time >= phrase.startTime && time <= phrase.endTime ? phrase : null),
    findChar: time => charNodes.find(c => time >= c.startTime && time <= c.endTime) ?? null,
  };
}

function fillLyrics(notes: Note[], chars: Array<[text: string, startTime: number]>): void {
  populateLyricChars(notes, makeCharLookup(videoFrom(chars)));
}

assert.equal(LYRIC_CHAR_BOUNDARY_EPSILON_MS, 20);

{
  const notes = [
    note("lyric", 1000),
    note("cut", 1300),
  ];
  computeLyricHolds(notes, []);

  assert.deepEqual(lyricCharWindow(notes[0], -Infinity), {
    startMs: 980,
    endMs: 1280,
    clampedToPrev: false,
  });

  fillLyrics(notes, [
    ["a", 979],
    ["b", 980],
    ["c", 1000],
    ["d", 1279],
    ["e", 1280],
    ["f", 1299],
    ["g", 1300],
  ]);

  assert.equal(notes[0].lyricChar, "bcd");
}

{
  const notes = [
    note("lyric", 1000),
    note("lyric", 1300),
    note("cut", 1600),
  ];
  computeLyricHolds(notes, []);

  fillLyrics(notes, [
    ["a", 1279],
    ["b", 1280],
    ["c", 1299],
    ["d", 1300],
  ]);

  assert.equal(notes[0].lyricChar, "a");
  assert.equal(notes[1].lyricChar, "bcd");
}

console.log("2 lyric char-window simulations passed");
