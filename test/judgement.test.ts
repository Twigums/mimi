import assert from "node:assert/strict";
import {
  CUT_TRAVEL_TIER1,
  CUT_TRAVEL_TIER2,
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
  const gesture = samples([
    [990, CENTER_X - 15, CENTER_Y],
    [1010, CENTER_X + 15, CENTER_Y],
  ]);
  const judgement = judged(judgeGesture(note(), gesture));

  assert.equal(judgement.result, "tier2");
  assert.equal(judgement.points, 90);
  assert.equal(judgement.gesture.travel, 30);
  assert.ok(judgement.gesture.travel >= CUT_TRAVEL_TIER2);
});

check("resting on a note still misses for insufficient travel", () => {
  const gesture = samples([
    [995, CENTER_X - 3, CENTER_Y],
    [1005, CENTER_X + 3, CENTER_Y],
  ]);
  const judgement = judged(judgeGesture(note(), gesture));

  assert.equal(judgement.result, "miss");
  assert.equal(judgement.missReason, "travel");
  assert.ok(judgement.gesture.travel < CUT_TRAVEL_TIER1);
});

check("direction error caps a cut instead of overriding timing", () => {
  const fiftyDegrees = 50 * Math.PI / 180;
  assert.equal(resultFor(judgeGesture(note(), lineThroughCenter(fiftyDegrees, 40))), "tier1");
});

check("opposite-direction cuts miss even when contact and timing are good", () => {
  const judgement = judged(judgeGesture(note(), lineThroughCenter(Math.PI, 40)));

  assert.equal(judgement.result, "miss");
  assert.equal(judgement.missReason, "direction");
});

check("near misses by contact cap to lower accepted tiers", () => {
  const gesture = samples([
    [960, CENTER_X - 40, CENTER_Y + 90],
    [1040, CENTER_X + 40, CENTER_Y + 90],
  ]);

  assert.equal(resultFor(judgeGesture(note(), gesture)), "tier1");
});

check("gestures outside the contact zone are not judged immediately", () => {
  const gesture = samples([
    [960, CENTER_X - 40, CENTER_Y + 130],
    [1040, CENTER_X + 40, CENTER_Y + 130],
  ]);

  assert.equal(judgeGesture(note(), gesture).status, "outOfContact");
});

check("lyric notes ignore gesture direction but still require motion", () => {
  const lyric = note({ kind: "lyric" });

  assert.equal(resultFor(judgeGesture(lyric, lineThroughCenter(Math.PI / 2, 40))), "tier3");
});

check("flow anchors after an unhit previous anchor are capped to tier 1", () => {
  const flow = note({ kind: "flow", flowPrevIndex: 0 });
  const prev = { x: CENTER_X - 120, y: CENTER_Y, state: "pending" as const };

  assert.equal(resultFor(judgeGesture(flow, lineThroughCenter(0, 40), prev)), "tier1");
});

check("flow path continuity can reject a sharp path break", () => {
  const flow = note({ kind: "flow", flowPrevIndex: 0 });
  const prev = { x: CENTER_X - 120, y: CENTER_Y, state: "hit" as const, hitResult: "tier3" as const };
  const judgement = judged(judgeGesture(flow, lineThroughCenter(Math.PI / 2, 40), prev));

  assert.equal(judgement.result, "miss");
  assert.equal(judgement.missReason, "continuity");
});

for (const testCase of cases) {
  testCase.run();
  console.log(`ok - ${testCase.name}`);
}

console.log(`${cases.length} judgement simulations passed`);
