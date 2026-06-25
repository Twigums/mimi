// lyrictrace — statically traces what the lyric char-population logic does to a chart's
// lyric notes, using the REAL runtime functions (`makeCharLookup`, `computeLyricHolds`,
// `populateLyricChars`) against a mocked TextAlive video. No live API or browser needed.
//
//   npm run --silent trace:lyrics -- [chart.json] [--chars chars.json] [--json]
//
// Default chart: docs/songs/kotaete/hard.json. Supply real TextAlive timings with
// `--chars` (see the capture snippet printed by `--help`) to reconcile against the chart;
// without it a small illustrative mock is used so the tool runs out of the box.
//
// Because a chart's note times need NOT match the API's char `startTime`s exactly, every
// lyric block also lists the chars just outside its epsilon-adjusted window with their
// offset to the window bounds — so a near-miss caused by an offset mismatch is visible
// at a glance.
import { readFileSync } from "fs";
import {
  computeLyricHolds,
  populateLyricChars,
  noteEndMs,
  lyricCharWindow,
  LYRIC_CHAR_BOUNDARY_EPSILON_MS,
} from "../ts/game/lyrics";
import { makeCharLookup } from "../ts/song/charLookup";
import type { Note } from "../ts/game/engine";
import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "../ts/song/textalive";

interface CharData   { text: string; startTime: number; endTime: number; }
interface PhraseData { startTime: number; endTime: number; chars: CharData[]; }

// ── Mock TextAlive video ──────────────────────────────────────────────────────────────
// Faithfully reproduces the API's structure: `char.next` is a SONG-WIDE linked list that
// crosses phrase boundaries (this is exactly what made the old, unbounded char walk
// re-collect each later char once per preceding phrase). Phrases are linked via `next`.
function buildVideo(phrases: PhraseData[]): TextAliveVideo {
  const charNodesByPhrase: TextAliveChar[][] = phrases.map(p =>
    p.chars.map(c => ({ text: c.text, startTime: c.startTime, endTime: c.endTime, next: null })),
  );
  const allChars: TextAliveChar[] = charNodesByPhrase.flat();
  for (let i = 0; i < allChars.length - 1; i++) allChars[i].next = allChars[i + 1];

  const phraseNodes: TextAlivePhrase[] = phrases.map((p, i) => ({
    startTime: p.startTime,
    endTime: p.endTime,
    text: p.chars.map(c => c.text).join(""),
    firstChar: charNodesByPhrase[i][0] ?? null,
    next: null,
  }));
  for (let i = 0; i < phraseNodes.length - 1; i++) phraseNodes[i].next = phraseNodes[i + 1];

  return {
    duration: phrases.length ? phrases[phrases.length - 1].endTime : 0,
    charCount: allChars.length,
    firstPhrase: phraseNodes[0] ?? null,
    findPhrase: t => phraseNodes.find(p => t >= p.startTime && t <= p.endTime) ?? null,
    findChar:   t => allChars.find(c => t >= c.startTime && t <= c.endTime) ?? null,
  };
}

// The OLD, buggy walk — kept here ONLY to show, per lyric, what the bug produced
// (each char re-collected once per preceding phrase → triplicated/garbled syllables).
function collectCharsBuggy(video: TextAliveVideo): TextAliveChar[] {
  const chars: TextAliveChar[] = [];
  let phrase = video.firstPhrase;
  while (phrase) {
    let c = phrase.firstChar;
    while (c) { chars.push(c); c = c.next; }     // no phrase-boundary guard (the bug)
    phrase = phrase.next;
  }
  return chars;
}

function lookupFrom(chars: TextAliveChar[]): (startMs: number, endMs: number) => string {
  return (startMs, endMs) =>
    chars.filter(c => c.startTime >= startMs && c.startTime < endMs).map(c => c.text).join("");
}

// ── Built-in illustrative mock (used when no --chars file is given) ──────────────────────
// NOT the real kotaete lyrics — placeholder kana timed loosely around the chart's lyric
// notes, split across several phrases so the cross-phrase dedup is exercised. One window
// is deliberately left empty (chars land just outside it) to mimic an offset mismatch.
const MOCK_PHRASES: PhraseData[] = [
  { startTime: 20000, endTime: 22900, chars: [
    { text: "あ", startTime: 20545, endTime: 20880 },
    { text: "い", startTime: 20900, endTime: 21560 },
    { text: "う", startTime: 21699, endTime: 22600 },
  ] },
  { startTime: 23100, endTime: 30200, chars: [
    { text: "え", startTime: 24238, endTime: 25200 },
    { text: "お", startTime: 28975, endTime: 29850 },   // close to a lyric boundary; useful for offset reconciliation
    { text: "か", startTime: 29084, endTime: 30000 },
  ] },
  { startTime: 33200, endTime: 37000, chars: [
    { text: "き", startTime: 33500, endTime: 34000 },   // 33500: just AFTER lyric@33468's onset
    { text: "く", startTime: 35545, endTime: 36400 },
    { text: "け", startTime: 36468, endTime: 37000 },
  ] },
  { startTime: 42000, endTime: 52200, chars: [
    { text: "こ", startTime: 42238, endTime: 42650 },
    { text: "さ", startTime: 42699, endTime: 43300 },
    { text: "し", startTime: 49161, endTime: 50000 },
    { text: "す", startTime: 50084, endTime: 50900 },
    { text: "せ", startTime: 51007, endTime: 51600 },
    { text: "そ", startTime: 51720, endTime: 52150 },   // 51720: just AFTER lyric@51699 — still inside its window
  ] },
];

// ── chart + chars loading ────────────────────────────────────────────────────────────
function loadChart(jsonPath: string): { notes: Note[]; endTimes: number[] } {
  const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as Array<{ kind: string; time: number }>;
  const endTimes: number[] = [];
  const notes: Note[] = [];
  for (const r of raw) {
    if (r.kind === "end") { if (typeof r.time === "number") endTimes.push(r.time); }
    else notes.push(r as unknown as Note);
  }
  notes.sort((a, b) => a.time - b.time);
  return { notes, endTimes };
}

function loadChars(jsonPath: string): PhraseData[] {
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  if (!Array.isArray(data) || data.length === 0) return [];
  // Phrase-grouped (preferred — reproduces cross-phrase linking) vs a flat char array.
  if (typeof data[0] === "object" && data[0] !== null && Array.isArray(data[0].chars)) {
    return data as PhraseData[];
  }
  const chars = data as CharData[];
  const sorted = chars.slice().sort((a, b) => a.startTime - b.startTime);
  return [{
    startTime: sorted[0]?.startTime ?? 0,
    endTime:   sorted[sorted.length - 1]?.endTime ?? 0,
    chars: sorted,
  }];
}

// ── formatting ───────────────────────────────────────────────────────────────────────
const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
const q    = (s: string): string => (s === "" ? "∅ (empty)" : `"${s}"`);

interface LyricTrace {
  chartIndex: number;
  time: number;
  x: number;
  y: number;
  holdMs: number | undefined;
  windowStart: number;
  windowEnd: number;
  clampedToPrev: boolean;
  bound: string;
  override?: string;
  newText: string;
  oldText: string;
  selected: { startTime: number; text: string }[];
  before: { startTime: number; text: string }[];
  after:  { startTime: number; text: string }[];
}

function buildTraces(
  notes: Note[],
  endTimes: number[],
  chars: TextAliveChar[],
  newLookup: (s: number, e: number) => string,
  oldLookup: (s: number, e: number) => string,
  overrides: Set<number>,
): LyricTrace[] {
  const sortedChars = chars.slice().sort((a, b) => a.startTime - b.startTime);
  const boundTimes = notes.map(n => n.time).concat(endTimes).sort((a, b) => a - b);
  const out: LyricTrace[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (note.kind !== "lyric") continue;

    const holdMs = note.holdMs;
    const prevEnd = i > 0 ? noteEndMs(notes[i - 1]) : -Infinity;
    const rawStart = note.time - LYRIC_CHAR_BOUNDARY_EPSILON_MS;
    const {
      startMs: windowStart,
      endMs: windowEnd,
      clampedToPrev,
    } = holdMs !== undefined
      ? lyricCharWindow(note, prevEnd)
      : { startMs: rawStart, endMs: note.time, clampedToPrev: false };

    // Describe the bounding event (what set holdMs).
    const boundT = boundTimes.find(t => t > note.time);
    let bound = "none (UNBOUNDED — invalid chart)";
    if (boundT !== undefined) {
      const boundNote = notes.find(n => n.time === boundT);
      const isEnd = endTimes.includes(boundT);
      bound = boundNote ? `${boundNote.kind}@${boundT} (next note)`
        : isEnd ? `end-marker@${boundT}`
        : `@${boundT}`;
    }

    const inWin = (c: TextAliveChar): boolean => c.startTime >= windowStart && c.startTime < windowEnd;
    const selected = sortedChars.filter(inWin).map(c => ({ startTime: c.startTime, text: c.text }));
    const before = sortedChars.filter(c => c.startTime < windowStart).slice(-3)
      .map(c => ({ startTime: c.startTime, text: c.text }));
    const after = sortedChars.filter(c => c.startTime >= windowEnd).slice(0, 3)
      .map(c => ({ startTime: c.startTime, text: c.text }));

    out.push({
      chartIndex: i,
      time: note.time,
      x: note.x,
      y: note.y,
      holdMs,
      windowStart,
      windowEnd,
      clampedToPrev,
      bound,
      override: overrides.has(i) ? note.lyricChar : undefined,
      newText: holdMs !== undefined ? newLookup(windowStart, windowEnd) : "",
      oldText: holdMs !== undefined ? oldLookup(windowStart, windowEnd) : "",
      selected,
      before,
      after,
    });
  }
  return out;
}

function printTrace(t: LyricTrace, ordinal: number): void {
  console.log(`\nLYRIC #${ordinal}  (chart note index ${t.chartIndex})`);
  console.log(`  chart   : time=${t.time}ms  pos=(${t.x}, ${t.y})`);
  if (t.override !== undefined) {
    console.log(`  override: lyricChar="${t.override}"  (population skipped — char field set in chart)`);
    return;
  }
  if (t.holdMs === undefined) {
    console.log(`  hold    : UNBOUNDED — no following note/end marker. Invalid chart; judged as miss.`);
    return;
  }
  console.log(`  hold    : holdMs=${t.holdMs}  bound=${t.bound}`);
  const clampNote = t.clampedToPrev ? `  (lower clamped to prev boundary minus ${LYRIC_CHAR_BOUNDARY_EPSILON_MS}ms)` : "";
  console.log(`  window  : [${t.windowStart}, ${t.windowEnd})  = [note−${LYRIC_CHAR_BOUNDARY_EPSILON_MS} .. holdEnd−${LYRIC_CHAR_BOUNDARY_EPSILON_MS}), end epsilon EXCLUDED${clampNote}`);
  console.log(`  result  : ${q(t.newText)}`);
  if (t.oldText !== t.newText) {
    console.log(`  was(BUG): ${q(t.oldText)}   ⚠ old cross-phrase walk differed here`);
  }
  if (t.selected.length > 0) {
    console.log(`  chars in window:`);
    for (const c of t.selected) {
      console.log(`     ${String(c.startTime).padStart(7)}  Δnote ${sign(c.startTime - t.time).padStart(6)}  "${c.text}"`);
    }
  } else {
    console.log(`  chars in window:  (none — lyric shows nothing, warning logged at runtime)`);
  }
  if (t.before.length || t.after.length) {
    console.log(`  nearby (offset reconciliation):`);
    for (const c of t.before) {
      console.log(`     before  ${String(c.startTime).padStart(7)}  Δstart ${sign(c.startTime - t.windowStart).padStart(6)}  "${c.text}"`);
    }
    for (const c of t.after) {
      const excl = c.startTime === t.windowEnd ? "  [starts ON bound → next note's]" : "";
      console.log(`     after   ${String(c.startTime).padStart(7)}  Δend   ${sign(c.startTime - t.windowEnd).padStart(6)}  "${c.text}"${excl}`);
    }
  }
}

function printHelp(): void {
  console.log(`lyrictrace — trace lyric char population against a mocked TextAlive video.

Usage:
  npm run --silent trace:lyrics -- [chart.json] [--chars chars.json] [--json]

  chart.json     compiled chart (default: docs/songs/kotaete/hard.json)
  --chars FILE   real TextAlive timings to reconcile against the chart. Either:
                   phrase-grouped: [{ "startTime", "endTime", "chars":[{ "text","startTime","endTime" }] }]
                   or a flat list:  [{ "text","startTime","endTime" }]
                 Capture real data from the song page browser console:

  copy(JSON.stringify((()=>{const o=[];let p=player.video.firstPhrase;while(p){const ch=[];
  let c=p.firstChar;while(c&&c.startTime<=p.endTime){ch.push({text:c.text,startTime:c.startTime,
  endTime:c.endTime});c=c.next;}o.push({startTime:p.startTime,endTime:p.endTime,chars:ch});p=p.next;}return o;})()))

  --json         emit the per-lyric trace as JSON instead of the readable report
`);
}

// ── main ─────────────────────────────────────────────────────────────────────────────
function main(): void {
  const argv: string[] = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { printHelp(); return; }

  const asJson = argv.includes("--json");
  const charsIdx = argv.indexOf("--chars");
  const charsPath = charsIdx >= 0 ? argv[charsIdx + 1] : undefined;
  const positional = argv.filter((a, i) =>
    !a.startsWith("--") && i !== charsIdx + 1);
  const chartPath = positional[0] ?? "docs/songs/kotaete/hard.json";

  const { notes, endTimes } = loadChart(chartPath);
  const phrases = charsPath ? loadChars(charsPath) : MOCK_PHRASES;
  const video = buildVideo(phrases);

  // Record which lyrics carry a real chart `char` override BEFORE population overwrites
  // lyricChar, so the trace can distinguish authored overrides from auto-filled text.
  const overrides = new Set<number>();
  notes.forEach((n, i) => { if (n.kind === "lyric" && n.lyricChar !== undefined) overrides.add(i); });

  // Populate via the REAL runtime functions, exactly as the engine does at load time.
  computeLyricHolds(notes, endTimes);
  const newLookup = makeCharLookup(video);   // the shipped (fixed) lookup
  populateLyricChars(notes, newLookup);

  // Ground-truth set of distinct chars (unique nodes, in song order) for neighbour display.
  const uniqueChars = Array.from(new Set(collectCharsBuggy(video)));
  const oldLookup = lookupFrom(collectCharsBuggy(video));   // what the buggy walk yielded
  const traces = buildTraces(notes, endTimes, uniqueChars, newLookup, oldLookup, overrides);

  if (asJson) {
    console.log(JSON.stringify(traces, null, 2));
    return;
  }

  // Validate the SHIPPED makeCharLookup over the whole song: with the per-phrase bound it
  // must yield each char exactly once (the old walk re-collected later chars once per
  // preceding phrase). Comparing full-range outputs exercises the real closure directly.
  const fullNew = newLookup(-Infinity, Infinity);
  const fullOld = oldLookup(-Infinity, Infinity);
  const newCount = [...fullNew].length, oldCount = [...fullOld].length;

  console.log(`chart : ${chartPath}`);
  console.log(`chars : ${charsPath ?? "(built-in illustrative mock — pass --chars for real data)"}`);
  console.log(`        ${phrases.length} phrase(s), ${uniqueChars.length} unique char(s)`);
  console.log(`dedup : shipped makeCharLookup yields ${newCount} chars; old cross-phrase walk yielded ${oldCount}` +
    (newCount === oldCount && newCount === uniqueChars.length
      ? `  ✓ each char once`
      : `  ⚠ old walk over-collected ${oldCount - newCount}`));
  console.log(`lyrics: ${traces.length} lyric note(s) in chart`);

  traces.forEach((t, i) => printTrace(t, i + 1));
  console.log("");
}

main();
