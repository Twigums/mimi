// Leniency failure-mode spec for issue #74 ("revisit leniency failure modes").
//
// This file is a LIVING SPEC, distilled from the gameplay captures
// (attempt_1_hard.log = clean play, attempt_2_hard.log = spamming + deliberately
// swiping cut arrows backwards). It is split into two groups:
//
//   DOING RIGHT     -- behaviour the judge gets correct (after the coherent-gesture
//                      + commit-gate fixes). Hard-asserts; must stay green.
//
//   REMAINING (#74) -- leniency the cut fix does NOT address (flow shape / lyric
//                      motion-only, plus axis-aligned oscillation that is correct
//                      by design). Each asserts the CURRENT behaviour and prints a
//                      NOTE line so the next tuning pass has a target.
//
// Gestures are synthesised in the harness style of test/judgement.test.ts; you
// cannot replay raw pointer paths from the logs, only the summary metrics, so the
// spam strokes below model what the log shows the run did: many short oscillating
// strokes across the contact zone, of which selectBestCandidate cherry-picks the
// best sub-gesture. The fix keeps that cherry-pick but requires the picked gesture
// to be ONE coherent stroke (straightness), so a backward pass can no longer borrow
// a forward endpoint displacement.
//
// Run standalone:
//   npx esbuild test/leniency.test.ts --bundle --platform=node --format=cjs \
//     --outfile=/tmp/mimi-leniency.test.cjs --log-level=silent && node /tmp/mimi-leniency.test.cjs

import assert from "node:assert/strict";
import {
  CUT_METRIC_WINDOW_MS,
  type HitResult,
  type Judgement,
  type JudgementAttempt,
  type JudgementNote,
  type PointerSample,
  judgeGesture,
} from "../src/ts/game/judgement";

const NOTE_TIME = 1000;
const CENTER_X = 400;
const CENTER_Y = 300;
const WINDOW_END = NOTE_TIME + CUT_METRIC_WINDOW_MS;

function note(overrides: Partial<JudgementNote> = {}): JudgementNote {
  return { kind: "cut", time: NOTE_TIME, x: CENTER_X, y: CENTER_Y, direction: 0, ...overrides };
}

function samples(points: Array<[songMs: number, x: number, y: number]>): PointerSample[] {
  return points.map(([songMs, x, y]) => ({ songMs, x, y }));
}

function lineThroughCenter(angle: number, halfLength: number, startMs = 960, endMs = 1040): PointerSample[] {
  const dx = Math.cos(angle) * halfLength;
  const dy = Math.sin(angle) * halfLength;
  return samples([
    [startMs, CENTER_X - dx, CENTER_Y - dy],
    [endMs, CENTER_X + dx, CENTER_Y + dy],
  ]);
}

function withLatest(pointerSamples: PointerSample[], songMs: number): PointerSample[] {
  const last = pointerSamples[pointerSamples.length - 1];
  assert.ok(last);
  if (last.songMs >= songMs) return pointerSamples;
  return [...pointerSamples, { ...last, songMs }];
}

function judged(attempt: JudgementAttempt): Judgement {
  assert.equal(attempt.status, "judged");
  return (attempt as Extract<JudgementAttempt, { status: "judged" }>).judgement;
}

function resultFor(attempt: JudgementAttempt): HitResult {
  return judged(attempt).result;
}

// A back-and-forth spam burst: `crossings` short strokes that all pass through the
// contact zone, alternating along `axis`, spanning the metric window. Models the
// spam run's "spray many strokes, one will land" pattern.
function spamBurst(axis: number, reach: number, crossings: number, startMs = 800, stepMs = 40): PointerSample[] {
  const dx = Math.cos(axis) * reach;
  const dy = Math.sin(axis) * reach;
  const pts: Array<[number, number, number]> = [];
  let t = startMs;
  for (let k = 0; k <= crossings; k++) {
    const sign = k % 2 === 0 ? -1 : 1;
    pts.push([t, CENTER_X + sign * dx, CENTER_Y + sign * dy]);
    t += stepMs;
  }
  return samples(pts);
}

interface Case { group: "RIGHT" | "REMAINING"; name: string; run: () => void; }
const cases: Case[] = [];
function right(name: string, run: () => void): void { cases.push({ group: "RIGHT", name, run }); }
function remaining(name: string, run: () => void): void { cases.push({ group: "REMAINING", name, run }); }
function note_(scenario: string, target: string, actual: string): void {
  console.log(`NOTE  - ${scenario} | target=${target} | actual=${actual}`);
}

// ---------------------------------------------------------------------------
// GROUP 1: DOING RIGHT
// ---------------------------------------------------------------------------

// Clean-play analogue (attempt_1 @2361: cut, dirErr 23, tier3): one deliberate
// stroke through the note along the arrow earns perfect.
right("clean single cut along the arrow earns tier3", () => {
  const j = judged(judgeGesture(
    note({ direction: 79 * Math.PI / 180 }),
    withLatest(lineThroughCenter(102 * Math.PI / 180, 40), WINDOW_END),
  ));
  assert.equal(j.result, "tier3");
});

// A single fast forward flick (one segment) through the note is a legit cut: a
// good gesture executed on its own, so it scores even amid spam.
right("single fast forward flick through the note earns tier3", () => {
  const flick = withLatest(samples([[984, CENTER_X - 50, CENTER_Y], [1000, CENTER_X + 50, CENTER_Y]]), WINDOW_END);
  assert.equal(resultFor(judgeGesture(note(), flick)), "tier3");
});

// Axis-aligned oscillation through a same-axis arrow contains genuine forward
// strokes through the note, so scoring it IS correct -- "is the gesture good on its
// own?" yes. (A single-axis spammer still can't clear off-axis arrows; see below.)
right("axis-aligned oscillation scores (it contains real cuts)", () => {
  assert.equal(resultFor(judgeGesture(note(), withLatest(spamBurst(0, 60, 11), WINDOW_END))), "tier3");
});

// Clean flow sweep tracing a straight ribbon is tier3 (flow path unchanged).
right("clean flow sweep tracing the ribbon earns tier3", () => {
  const flow = note({ kind: "flow", flowShape: [0, 0, 0, 0] });
  assert.equal(resultFor(judgeGesture(flow, withLatest(lineThroughCenter(0, 40), WINDOW_END))), "tier3");
});

// FIXED (#74 concern 1): a clean ~180-degree-opposite swipe misses on direction.
right("clean opposite-direction swipe misses on direction", () => {
  const g = samples([[960, CENTER_X + 40, CENTER_Y], [1040, CENTER_X - 40, CENTER_Y], [WINDOW_END, CENTER_X - 120, CENTER_Y]]);
  const j = judged(judgeGesture(note(), g));
  assert.equal(j.result, "miss");
  assert.equal(j.issue, "direction");
});

// FIXED (#74 concern 1): the opposite swipe still misses on DIRECTION even when the
// pointer parks near the note -- the degenerate parked candidate no longer outranks
// the real reversed sweep, so the binding issue is reported correctly.
right("opposite swipe with a parked tail still misses on direction", () => {
  const g = samples([[960, CENTER_X + 40, CENTER_Y], [1040, CENTER_X - 40, CENTER_Y], [WINDOW_END, CENTER_X - 40, CENTER_Y]]);
  const j = judged(judgeGesture(note(), g));
  assert.equal(j.result, "miss");
  assert.equal(j.issue, "direction");
});

// FIXED (#74 concern 1): a short pure backward flick (opposite the arrow) misses.
right("pure backward flick misses on direction", () => {
  const flick = withLatest(samples([[984, CENTER_X + 50, CENTER_Y], [1000, CENTER_X - 50, CENTER_Y]]), WINDOW_END);
  const j = judged(judgeGesture(note(), flick));
  assert.equal(j.result, "miss");
  assert.equal(j.issue, "direction");
});

// A perpendicular-only spam burst misses on direction: every stroke is ~90 degrees
// off the arrow and no coherent sub-stroke can rescue the heading.
right("perpendicular-only spam misses a cut on direction", () => {
  const burst = withLatest(spamBurst(0, 60, 11), WINDOW_END); // horizontal burst...
  const j = judged(judgeGesture(note({ direction: -Math.PI / 2 }), burst)); // ...vs UP arrow
  assert.equal(j.result, "miss");
  assert.equal(j.issue, "direction");
});

// Resting on the note (no travel) still misses on gesture -- spam that stalls
// dead-centre cannot farm a hit from contact + timing alone.
right("dead-stop on the note misses for insufficient travel", () => {
  const g = withLatest(samples([[995, CENTER_X - 3, CENTER_Y], [1005, CENTER_X + 3, CENTER_Y]]), WINDOW_END);
  const j = judged(judgeGesture(note(), g));
  assert.equal(j.result, "miss");
  assert.equal(j.issue, "gesture");
});

// A far-away spam burst (never enters the contact zone) misses on contact.
right("spam that never reaches the note misses on contact", () => {
  const burst = withLatest(spamBurst(0, 60, 9).map((s) => ({ ...s, y: s.y + 200 })), WINDOW_END);
  const j = judged(judgeGesture(note(), burst));
  assert.equal(j.result, "miss");
  assert.equal(j.issue, "contact");
});

// FIXED (#74 concern 1, the core farm): a backward pass through the note can no
// longer borrow a far-away forward endpoint displacement -- the straightness cap on
// the coherent slice holds the Frankenstein candidate below tier3.
right("backward-contact-plus-far-forward Frankenstein is capped below tier3", () => {
  const g = samples([[960, 440, CENTER_Y], [1000, 360, CENTER_Y], [1100, 360, CENTER_Y - 160], [1200, 760, CENTER_Y - 160]]);
  const j = judged(judgeGesture(note(), g));
  assert.notEqual(j.result, "tier3");
});

// ---------------------------------------------------------------------------
// GROUP 2: REMAINING (#74) -- leniency the cut fix does not address.
// ---------------------------------------------------------------------------

// FIXED (#74): flow has no direction cap (heading folds into the shape metric), and
// the shape tiers were pulled in (60/75/100 degrees). A flow gesture ~90 degrees off
// the ribbon now drops to tier1 instead of tier2 -- in attempt_2 most of the inflated
// GREATs were flow notes held up by the old wide tiers. A backward (180deg) trace
// still misses.
right("flow ~90deg off the ribbon is held to tier1 (not tier2)", () => {
  const flow = note({ kind: "flow", flowShape: [0, 0, 0, 0] });
  const g = withLatest(lineThroughCenter(Math.PI / 2, 40), WINDOW_END);
  const j = judged(judgeGesture(flow, g));
  assert.equal(j.result, "tier1");
  assert.equal(j.issue, "gesture");
});

// A flow gesture pointing opposite the ribbon (180deg off every bin) misses.
right("flow traced backward along the ribbon misses", () => {
  const flow = note({ kind: "flow", flowShape: [0, 0, 0, 0] });
  const g = withLatest(lineThroughCenter(Math.PI, 40), WINDOW_END); // sweeps left vs a rightward ribbon
  assert.equal(resultFor(judgeGesture(flow, g)), "miss");
});

// Lyric notes intentionally ignore direction (brush-through), so any motion through
// the circle scores regardless of heading. Spam therefore clears lyrics freely.
// This is by design today, but it is part of why a full-chart spam still scores;
// flagged here so a future pass can decide whether lyrics need a motion-quality bar.
remaining("lyric scores on any direction of motion through it", () => {
  const lyric = note({ kind: "lyric" });
  const j = judged(judgeGesture(lyric, withLatest(lineThroughCenter(Math.PI / 2, 40), WINDOW_END)));
  assert.equal(j.result, "tier3");
  note_("lyric brushed in an arbitrary direction", "motion-quality bar TBD", `${j.result}`);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
let rightCount = 0;
let remainingCount = 0;
for (const testCase of cases) {
  testCase.run();
  if (testCase.group === "RIGHT") { rightCount++; console.log(`ok   [RIGHT]     ${testCase.name}`); }
  else { remainingCount++; console.log(`spec [REMAINING] ${testCase.name}`); }
}
console.log(`\n${rightCount} doing-right cases passed, ${remainingCount} remaining-leniency cases documented`);
