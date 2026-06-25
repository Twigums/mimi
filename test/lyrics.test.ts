import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// Single-phrase video from flat [text, startTime] pairs (for the synthetic unit cases).
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
    endTime: 1_000_000,
    firstChar: charNodes[0] ?? null,
    text: chars.map(([text]) => text).join(""),
    next: null,
  };

  return {
    duration: 1_000_000,
    charCount: charNodes.length,
    firstPhrase: phrase,
    findPhrase: time => (time >= phrase.startTime && time <= phrase.endTime ? phrase : null),
    findChar: time => charNodes.find(c => time >= c.startTime && time <= c.endTime) ?? null,
  };
}

function fillLyrics(notes: Note[], chars: Array<[text: string, startTime: number]>): void {
  populateLyricChars(notes, makeCharLookup(videoFrom(chars)));
}

assert.equal(LYRIC_CHAR_BOUNDARY_EPSILON_MS, 100);

// ── window bounds: [time − ε, holdEnd − ε), ε excluded at each end ──────────────────────
{
  const notes = [note("lyric", 1000), note("cut", 1300)];
  computeLyricHolds(notes, []);

  assert.deepEqual(lyricCharWindow(notes[0], -Infinity), {
    startMs: 900,
    endMs: 1200,
    clampedToPrev: false,
  });

  fillLyrics(notes, [
    ["a", 899],   // before the start → excluded
    ["b", 900],   // at the start → included
    ["c", 1000],
    ["d", 1199],  // before the end → included
    ["e", 1200],  // at the end → excluded (left for the next boundary)
    ["f", 1300],
  ]);

  assert.equal(notes[0].lyricChar, "bcd");
}

// ── back-to-back lyrics partition at note − ε, no overlap ───────────────────────────────
{
  const notes = [note("lyric", 1000), note("lyric", 1300), note("cut", 1600)];
  computeLyricHolds(notes, []);

  fillLyrics(notes, [
    ["a", 1199],  // < 1200 → first lyric
    ["b", 1200],  // ≥ 1200 → second lyric
    ["c", 1300],
  ]);

  assert.equal(notes[0].lyricChar, "a");
  assert.equal(notes[1].lyricChar, "bc");
}

// ── previous-char fallback: a syllable leading the note by more than ε is recovered ─────
{
  // A flow note between two lyrics bounds the first lyric's hold; the second lyric's
  // syllable onset (1390) leads its note (1500) by 110ms, so its window [1400, 1700) is
  // empty and the fallback pulls the orphaned char from the gap after the flow note.
  const notes = [note("lyric", 1000), note("flow", 1300), note("lyric", 1500), note("cut", 1800)];
  computeLyricHolds(notes, []);

  fillLyrics(notes, [
    ["x", 1000],
    ["y", 1390],
  ]);

  assert.equal(notes[0].lyricChar, "x");
  assert.equal(notes[2].lyricChar, "y");
}

// ── fallback never steals a previous lyric's char (lookback bounded below by prevEnd) ────
{
  const notes = [note("lyric", 1000), note("lyric", 1300), note("cut", 1600)];
  computeLyricHolds(notes, []);

  fillLyrics(notes, [
    ["a", 1150],  // inside the first lyric's window [900, 1200)
  ]);

  assert.equal(notes[0].lyricChar, "a");
  assert.equal(notes[1].lyricChar, ""); // empty: lookback [1300, 1200) is degenerate → no steal
}

// ── real kotaete hard.mimi lyric notes (verbatim) against captured TextAlive timings ────
function buildVideoFromPhrases(
  phrases: Array<{ startTime: number; endTime: number; chars: Array<{ text: string; startTime: number; endTime: number }> }>,
): TextAliveVideo {
  const byPhrase: TextAliveChar[][] = phrases.map(p =>
    p.chars.map(c => ({ text: c.text, startTime: c.startTime, endTime: c.endTime, next: null })));
  const all = byPhrase.flat();
  for (let i = 0; i < all.length - 1; i++) all[i].next = all[i + 1];

  const phraseNodes: TextAlivePhrase[] = phrases.map((p, i) => ({
    startTime: p.startTime,
    endTime: p.endTime,
    text: p.chars.map(c => c.text).join(""),
    firstChar: byPhrase[i][0] ?? null,
    next: null,
  }));
  for (let i = 0; i < phraseNodes.length - 1; i++) phraseNodes[i].next = phraseNodes[i + 1];

  return {
    duration: phrases.length ? phrases[phrases.length - 1].endTime : 0,
    charCount: all.length,
    firstPhrase: phraseNodes[0] ?? null,
    findPhrase: t => phraseNodes.find(p => t >= p.startTime && t <= p.endTime) ?? null,
    findChar: t => all.find(c => t >= c.startTime && t <= c.endTime) ?? null,
  };
}

const KIND: Record<string, Note["kind"]> = { c: "cut", cut: "cut", f: "flow", flow: "flow", l: "lyric", lyric: "lyric" };

// Parse one verbatim ".mimi" note line: "kind, time, degrees, x, y[, char]" or "end, time".
function parseMimiNote(line: string): Note | { endTime: number } | null {
  const t = line.split(",").map(s => s.trim());
  if (t[0] === "end") return { endTime: Number(t[1]) };
  const kind = KIND[t[0]];
  if (!kind) return null;
  const n = note(kind, Number(t[1]));
  if (kind === "lyric" && t[5]) n.lyricChar = t[5];
  return n;
}

{
  const dir = resolve(process.cwd(), "test/fixtures");
  const timings = JSON.parse(readFileSync(resolve(dir, "kotaete-hard-timings.json"), "utf8"));
  const fixture = JSON.parse(readFileSync(resolve(dir, "kotaete-hard-lyrics.json"), "utf8")) as {
    notes: Array<{ mimi: string; expected?: string }>;
  };

  const notes: Note[] = [];
  const endTimes: number[] = [];
  const expectedByTime = new Map<number, string>();
  for (const entry of fixture.notes) {
    const parsed = parseMimiNote(entry.mimi);
    if (!parsed) continue;
    if ("endTime" in parsed) { endTimes.push(parsed.endTime); continue; }
    notes.push(parsed);
    if (entry.expected !== undefined) expectedByTime.set(parsed.time, entry.expected);
  }
  notes.sort((a, b) => a.time - b.time);

  computeLyricHolds(notes, endTimes);
  populateLyricChars(notes, makeCharLookup(buildVideoFromPhrases(timings)));

  let checked = 0;
  for (const n of notes) {
    if (n.kind !== "lyric") continue;
    const expected = expectedByTime.get(n.time);
    assert.equal(
      n.lyricChar,
      expected,
      `lyric@${n.time}ms: expected ${JSON.stringify(expected)}, got ${JSON.stringify(n.lyricChar)}`,
    );
    checked++;
  }
  assert.equal(checked, expectedByTime.size);
  console.log(`kotaete hard.mimi fixture: ${checked} lyric notes match expected charsets`);
}

console.log("4 lyric char-window simulations passed");
