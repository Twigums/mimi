// Regenerate test/fixtures/kotaete-lyrics.json expected lyricChar values from hard.mimi + kotaete-timings.json.
//
//   npm run build:kotaete-lyrics
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { computeLyricHolds } from "../ts/game/lyrics";
import { collectTextAliveChars } from "../ts/song/charLookup";
import { matchLyrics } from "../ts/song/lyricMatch";
import type { Note } from "../ts/game/engine";
import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "../ts/song/textalive";

const KIND: Record<string, Note["kind"]> = { c: "cut", cut: "cut", f: "flow", flow: "flow", l: "lyric", lyric: "lyric" };

function parseMimiNote(line: string): Note | { endTime: number } | null {
  const t = line.split(",").map(s => s.trim());
  if (t[0] === "end") return { endTime: Number(t[1]) };
  const kind = KIND[t[0]];
  if (!kind) return null;
  const n: Note = { kind, time: Number(t[1]), x: Number(t[3] ?? 0), y: Number(t[4] ?? 0), direction: 0, state: "pending" };
  if (kind === "lyric") {
    for (let i = 5; i < t.length; i++) {
      const tok = t[i];
      if (tok === "endchar") n.includeEndChar = true;
      else if (tok.startsWith("char=")) n.lyricChar = tok.slice(5);
      else if (tok.startsWith("span=")) n.lyricSpan = Number(tok.slice(5));
      else if (tok.startsWith("src=")) n.lyricSrcTime = Number(tok.slice(4));
      else if (!tok.includes("=")) n.lyricChar = tok;
    }
  }
  return n;
}

function buildVideo(phrases: Array<{ startTime: number; endTime: number; chars: Array<{ text: string; startTime: number; endTime: number }> }>): TextAliveVideo {
  const byPhrase: TextAliveChar[][] = phrases.map(p =>
    p.chars.map(c => ({ text: c.text, startTime: c.startTime, endTime: c.endTime, next: null, parent: null })));
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
    duration: phrases.at(-1)?.endTime ?? 0,
    charCount: all.length,
    firstPhrase: phraseNodes[0] ?? null,
    findPhrase: t => phraseNodes.find(p => t >= p.startTime && t <= p.endTime) ?? null,
    findChar: t => all.find(c => t >= c.startTime && t <= c.endTime) ?? null,
  };
}

const root = process.cwd();
const mimi = readFileSync(resolve(root, "src/songs/kotaete/hard.mimi"), "utf8");
const timings = JSON.parse(readFileSync(resolve(root, "test/fixtures/kotaete-timings.json"), "utf8"));

const notes: Note[] = [];
const endTimes: number[] = [];
const fixtureNotes: Array<{ mimi: string; expected?: string }> = [];

for (const line of mimi.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const parsed = parseMimiNote(trimmed);
  if (!parsed) continue;
  if ("endTime" in parsed) {
    endTimes.push(parsed.endTime);
    fixtureNotes.push({ mimi: trimmed });
    continue;
  }
  notes.push(parsed);
  const entry: { mimi: string; expected?: string } = { mimi: trimmed };
  if (parsed.kind === "lyric") fixtureNotes.push(entry);
  else fixtureNotes.push({ mimi: trimmed });
}

notes.sort((a, b) => a.time - b.time);
computeLyricHolds(notes, endTimes);
matchLyrics(buildVideo(timings), notes, []);

const expectedByTime = new Map<number, string>();
for (const n of notes) {
  if (n.kind === "lyric") expectedByTime.set(n.time, n.lyricChar ?? "");
}
for (const entry of fixtureNotes) {
  const parsed = parseMimiNote(entry.mimi);
  if (!parsed || "endTime" in parsed || parsed.kind !== "lyric") continue;
  entry.expected = expectedByTime.get(parsed.time);
}

const out = {
  description: "Lyric char-population fixture for src/songs/kotaete/hard.mimi. Expected values come from matchLyrics against test/fixtures/kotaete-timings.json (TextAlive dump with staff chorus overlay).",
  timings: "kotaete-timings.json",
  notes: fixtureNotes,
};

writeFileSync(resolve(root, "test/fixtures/kotaete-lyrics.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`Wrote test/fixtures/kotaete-lyrics.json (${expectedByTime.size} lyric expectations)`);
