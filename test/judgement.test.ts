import assert from "node:assert/strict";
import {
  CUT_METRIC_WINDOW_MS,
  CUT_TRAVEL_TIER1,
  CUT_TRAVEL_TIER2,
  CUT_TRAVEL_TIER3,
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

function note(overrides: Partial<JudgementNote> = {}): JudgementNote {
  return {
    kind: "cut",
    time: NOTE_TIME,
    x: CENTER_X,
    y: CENTER_Y,
    direction: 0,
    ...overrides,
  };
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
  return attempt.judgement;
}

interface Case {
  name: string;
  run: () => void;
}

function resultFor(attempt: JudgementAttempt): HitResult {
  return judged(attempt).result;
}

const cases: Case[] = [];

function check(name: string, run: () => void): void {
  cases.push({ name, run });
}

check("centered cut earns tier 3 with interpolated timing", () => {
  const judgement = judged(judgeGesture(note(), lineThroughCenter(0, 40)));

  assert.equal(judgement.result, "tier3");
  assert.equal(judgement.points, 100);
  assert.equal(judgement.offsetMs, 0);
  assert.equal(judgement.gesture.contactDistance, 0);
  assert.equal(judgement.gesture.travel, 80);
});

check("short deliberate brush is accepted with lenient travel capping", () => {
  const gesture = withLatest(samples([
    [990, CENTER_X - 15, CENTER_Y],
    [1010, CENTER_X + 15, CENTER_Y],
  ]), NOTE_TIME + CUT_METRIC_WINDOW_MS);
  const judgement = judged(judgeGesture(note(), gesture));

  assert.equal(judgement.result, "tier2");
  assert.equal(judgement.points, 90);
  assert.equal(judgement.gesture.travel, 30);
  assert.ok(judgement.gesture.travel >= CUT_TRAVEL_TIER2);
});

check("lower-tier gestures wait until a better timing tier is impossible", () => {
  const gesture = samples([
    [990, CENTER_X - 15, CENTER_Y],
    [1010, CENTER_X + 15, CENTER_Y],
  ]);

  const attempt = judgeGesture(note(), gesture);
  assert.equal(attempt.status, "pending");
  assert.equal(attempt.best?.result, "tier2");
});

check("resting on a note still misses for insufficient travel", () => {
  const gesture = withLatest(samples([
    [995, CENTER_X - 3, CENTER_Y],
    [1005, CENTER_X + 3, CENTER_Y],
  ]), NOTE_TIME + CUT_METRIC_WINDOW_MS);
  const judgement = judged(judgeGesture(note(), gesture));

  assert.equal(judgement.result, "miss");
  assert.equal(judgement.issue, "travel");
  assert.ok(judgement.gesture.travel < CUT_TRAVEL_TIER1);
});

check("direction error caps a cut instead of overriding timing", () => {
  const fiftyDegrees = 50 * Math.PI / 180;
  const gesture = withLatest(lineThroughCenter(fiftyDegrees, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);
  assert.equal(resultFor(judgeGesture(note(), gesture)), "tier1");
});

check("opposite-direction cuts miss even when contact and timing are good", () => {
  // Keep travelling in one direction (no stationary tail) so the best miss is the
  // reversed sweep itself rather than a zero-travel candidate from a held endpoint.
  const gesture = samples([
    [960, CENTER_X + 40, CENTER_Y],
    [1040, CENTER_X - 40, CENTER_Y],
    [NOTE_TIME + CUT_METRIC_WINDOW_MS, CENTER_X - 120, CENTER_Y],
  ]);
  const judgement = judged(judgeGesture(note(), gesture));

  assert.equal(judgement.result, "miss");
  assert.equal(judgement.issue, "direction");
});

check("near misses by contact cap to lower accepted tiers", () => {
  const gesture = withLatest(samples([
    [960, CENTER_X - 40, CENTER_Y + 90],
    [1040, CENTER_X + 40, CENTER_Y + 90],
  ]), NOTE_TIME + CUT_METRIC_WINDOW_MS);

  assert.equal(resultFor(judgeGesture(note(), gesture)), "tier1");
});

check("gestures outside the contact zone are not judged immediately", () => {
  const gesture = samples([
    [960, CENTER_X - 40, CENTER_Y + 130],
    [1040, CENTER_X + 40, CENTER_Y + 130],
  ]);

  assert.equal(judgeGesture(note(), gesture).status, "pending");
  const judgement = judged(judgeGesture(note(), withLatest(gesture, NOTE_TIME + CUT_METRIC_WINDOW_MS)));
  assert.equal(judgement.result, "miss");
  assert.equal(judgement.issue, "contact");
});

check("lyric notes ignore gesture direction but still require motion", () => {
  const lyric = note({ kind: "lyric" });

  assert.equal(resultFor(judgeGesture(lyric, lineThroughCenter(Math.PI / 2, 40))), "tier3");
});

check("flow continuity ignores the previous anchor's grade (no cascade)", () => {
  // Last anchor of a pair: its tangent is the incoming chord (rightward). A clean
  // rightward sweep flows perfectly, so it earns tier 3 regardless of how the
  // previous anchor was judged — one weak anchor no longer caps the rest.
  const flow = note({ kind: "flow", flowPrevIndex: 0 });
  const prev = { x: CENTER_X - 120, y: CENTER_Y };

  const gesture = withLatest(lineThroughCenter(0, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);
  assert.equal(resultFor(judgeGesture(flow, gesture, prev)), "tier3");
});

check("a lone flow anchor judges motion only, ignoring direction", () => {
  // No phrase neighbours means no ribbon tangent, so direction is free (like a lyric).
  const lone = note({ kind: "flow" });
  const gesture = withLatest(lineThroughCenter(Math.PI / 2, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);

  assert.equal(resultFor(judgeGesture(lone, gesture)), "tier3");
});

check("a sharp flow corner caps continuity even when the tangent is followed", () => {
  // Middle anchor whose ribbon turns ~160 degrees: the engine-set tangent bisects to
  // 80 degrees. Following the tangent satisfies direction, but the heading is 80
  // degrees off the incoming chord, so continuity — not direction — caps it to tier 2.
  const eighty = 80 * Math.PI / 180;
  const flow = note({ kind: "flow", flowPrevIndex: 0, flowNextIndex: 2, direction: eighty });
  const prev = { x: CENTER_X - 120, y: CENTER_Y };
  const gesture = withLatest(lineThroughCenter(eighty, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);
  const judgement = judged(judgeGesture(flow, gesture, prev));

  assert.equal(judgement.result, "tier2");
  assert.equal(judgement.issue, "continuity");
});

check("best sub-gesture is selected when another motion shares the metric window", () => {
  const noisyThenClean = samples([
    [820, CENTER_X, CENTER_Y + 80],
    [900, CENTER_X - 60, CENTER_Y + 20],
    [960, CENTER_X - 40, CENTER_Y],
    [1000, CENTER_X, CENTER_Y],
    [1040, CENTER_X + 40, CENTER_Y],
    [1120, CENTER_X + 20, CENTER_Y + 70],
  ]);
  const judgement = judged(judgeGesture(note(), noisyThenClean));

  assert.equal(judgement.result, "tier3");
  assert.equal(judgement.offsetMs, 0);
  assert.ok(judgement.gesture.travel >= CUT_TRAVEL_TIER3);
});

check("early cut commits as soon as the gesture leaves the contact zone (issue #53)", () => {
  // Tier-2-timed early cut (crosses center near -52 ms) that sweeps out past the
  // contact radius. Old behaviour held it pending until noteTime + TIER3_MS; the
  // settled commit finalizes immediately so feedback tracks the gesture.
  const gesture = samples([
    [930, CENTER_X - 60, CENTER_Y],
    [990, CENTER_X + 140, CENTER_Y],
  ]);
  const attempt = judgeGesture(note(), gesture);

  assert.equal(attempt.status, "judged");
  assert.equal(judged(attempt).result, "tier2");
});

check("density guard defers an early commit during a stacked previous note", () => {
  // Crosses center early (~-105 ms) and exits the zone by 930 ms.
  const gesture = samples([
    [880, CENTER_X - 60, CENTER_Y],
    [930, CENTER_X + 140, CENTER_Y],
  ]);

  // No nearby previous note: the settled gesture commits immediately.
  assert.equal(judgeGesture(note(), gesture).status, "judged");
  // A previous note at 950 ms pushes the earliest commit past the gesture's exit,
  // so the same gesture stays pending rather than mis-committing to this note.
  assert.equal(judgeGesture(note(), gesture, undefined, NOTE_TIME - 50).status, "pending");
});

for (const testCase of cases) {
  testCase.run();
  console.log(`ok - ${testCase.name}`);
}

console.log(`${cases.length} judgement simulations passed`);
