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

assert.equal(LYRIC_CHAR_BOUNDARY_EPSILON_MS, 30);

{
  const notes = [
    note("lyric", 1000),
    note("cut", 1300),
  ];
  computeLyricHolds(notes, []);

  // First note: no previous event, so the window keeps the raw [time−ε, holdEnd−ε).
  assert.deepEqual(lyricCharWindow(notes[0], -Infinity), {
    startMs: 970,
    endMs: 1270,
    clampedToPrev: false,
  });

  fillLyrics(notes, [
    ["a", 969],   // just before the start → excluded
    ["b", 970],   // at the start → included
    ["c", 1000],
    ["d", 1269],  // just before the end → included
    ["e", 1270],  // at the end → excluded (left for the next boundary)
    ["f", 1300],
  ]);

  assert.equal(notes[0].lyricChar, "bcd");
}

{
  // Back-to-back lyrics tile at note−ε (prevEnd == this note's time), no overlap.
  const notes = [
    note("lyric", 1000),
    note("lyric", 1300),
    note("cut", 1600),
  ];
  computeLyricHolds(notes, []);

  fillLyrics(notes, [
    ["a", 1269],  // < 1270 → first lyric
    ["b", 1270],  // ≥ 1270 → second lyric
    ["c", 1299],
    ["d", 1300],
  ]);

  assert.equal(notes[0].lyricChar, "a");
  assert.equal(notes[1].lyricChar, "bcd");
}

{
  // Gap tiling (issue #39): a flow note between two lyrics bounds the first lyric's hold
  // early; the second lyric's window must tile back to that flow note so a vocal char
  // leading the second lyric isn't orphaned in the gap.
  const notes = [
    note("lyric", 1000),
    note("flow", 1300),
    note("lyric", 1500),
    note("cut", 1800),
  ];
  computeLyricHolds(notes, []);

  // The second lyric starts at the flow note's end − ε (1270), not its own time − ε (1470).
  assert.deepEqual(lyricCharWindow(notes[2], 1300), {
    startMs: 1270,
    endMs: 1770,
    clampedToPrev: true,
  });

  fillLyrics(notes, [
    ["a", 1269],  // first lyric's window [970, 1270)
    ["b", 1280],  // in the gap after the flow → tiles into the second lyric (was dropped)
    ["c", 1500],
  ]);

  assert.equal(notes[0].lyricChar, "a");
  assert.equal(notes[2].lyricChar, "bc");
}

console.log("3 lyric char-window simulations passed");
