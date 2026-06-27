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
  assert.equal(judgement.issue, "gesture");
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

// ---- Lyric hold judgement -------------------------------------------------

const HOLD_MS = 300;

function lyric(overrides: Partial<JudgementNote> = {}): JudgementNote {
  return note({ kind: "lyric", holdMs: HOLD_MS, ...overrides });
}

// A pointer parked at (x, y) sampled across [startMs, endMs].
function holdAt(x: number, y: number, startMs: number, endMs: number, stepMs = 20): PointerSample[] {
  const out: PointerSample[] = [];
  for (let t = startMs; t <= endMs; t += stepMs) out.push({ songMs: t, x, y });
  return out;
}

check("a held lyric kept in the circle for its duration earns tier 3", () => {
  // Present from before the note and held through the full window.
  const gesture = holdAt(CENTER_X, CENTER_Y, 960, NOTE_TIME + HOLD_MS);
  const judgement = judged(judgeGesture(lyric(), gesture));

  assert.equal(judgement.result, "tier3");
  assert.equal(judgement.issue, undefined);
  assert.equal(judgement.offsetMs, 0);
});

check("a lyric released early is capped by the hold (gesture) issue", () => {
  // Held ~170 ms of the 200 ms required target, then the cursor leaves the circle.
  const gesture = [
    ...holdAt(CENTER_X, CENTER_Y, 1000, 1170),
    { songMs: 1200, x: CENTER_X + 400, y: CENTER_Y },
  ];
  const judgement = judged(judgeGesture(lyric(), gesture));

  assert.equal(judgement.result, "tier2");
  assert.equal(judgement.issue, "gesture");
});

check("a lyric held off-center is capped by contact", () => {
  // Inside the hold radius (90 px) for the full duration, but never near the center.
  const gesture = holdAt(CENTER_X, CENTER_Y + 90, 960, NOTE_TIME + HOLD_MS);
  const judgement = judged(judgeGesture(lyric(), gesture));

  assert.equal(judgement.result, "tier1");
  assert.equal(judgement.issue, "contact");
});

check("a lyric entered late is capped by timing", () => {
  // Reaches the circle 100 ms late, then holds out the rest of the window.
  const gesture = holdAt(CENTER_X, CENTER_Y, 1100, NOTE_TIME + HOLD_MS);
  const judgement = judged(judgeGesture(lyric(), gesture));

  assert.equal(judgement.result, "tier1");
  assert.equal(judgement.issue, "timing");
});

check("a lyric the cursor never reaches misses on contact", () => {
  // Nearest approach is on time but well outside the hold radius the whole time.
  const gesture = holdAt(CENTER_X, CENTER_Y + 200, 960, NOTE_TIME + 200);
  const judgement = judged(judgeGesture(lyric(), gesture));

  assert.equal(judgement.result, "miss");
  assert.equal(judgement.issue, "contact");
});

check("a lyric stays pending while the hold is still in progress", () => {
  // Inside the circle but the window has not elapsed and the cursor has not left.
  const gesture = holdAt(CENTER_X, CENTER_Y, 960, 1100);
  assert.equal(judgeGesture(lyric(), gesture).status, "pending");
});

check("a lyric with no hold bound (invalid chart) resolves as a miss", () => {
  // No holdMs (the engine leaves it undefined for a last-note lyric and logs an error).
  const invalid = note({ kind: "lyric" });
  const gesture = holdAt(CENTER_X, CENTER_Y, 960, NOTE_TIME + 200);
  assert.equal(judged(judgeGesture(invalid, gesture)).result, "miss");
});

check("an early brush before the note start does not finalize the lyric", () => {
  // Cursor dips through the circle early, then leaves before the note time. No hold
  // has been scored yet, so the note must stay pending (the player can still hold).
  const brush = [
    { songMs: 900, x: CENTER_X, y: CENTER_Y },
    { songMs: 940, x: CENTER_X + 400, y: CENTER_Y },
  ];
  assert.equal(judgeGesture(lyric(), brush).status, "pending");

  // The same player then returns and holds it out: a clean tier 3.
  const recovered = [...brush, ...holdAt(CENTER_X, CENTER_Y, 1000, NOTE_TIME + HOLD_MS)];
  assert.equal(resultFor(judgeGesture(lyric(), recovered)), "tier3");
});

check("a flow gesture tracing the ribbon shape earns tier 3", () => {
  // Ribbon heads straight right (all bins 0); a clean rightward sweep matches it.
  const flow = note({ kind: "flow", flowShape: [0, 0, 0, 0] });
  const gesture = withLatest(lineThroughCenter(0, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);

  assert.equal(resultFor(judgeGesture(flow, gesture)), "tier3");
});

check("a flow gesture off the ribbon shape is capped by the flow metric", () => {
  // Ribbon heads right; the gesture sweeps perpendicular (90 degrees off every bin).
  // The shape cap reports a perpendicular trace as a low accepted tier, not a clean
  // flow, and the gesture issue slot reports it.
  const flow = note({ kind: "flow", flowShape: [0, 0, 0, 0] });
  const gesture = withLatest(lineThroughCenter(Math.PI / 2, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);
  const judgement = judged(judgeGesture(flow, gesture));

  assert.equal(judgement.result, "tier1");
  assert.equal(judgement.issue, "gesture");
});

check("flow timing is more lenient than cut", () => {
  // Same gesture crossing the note ~60 ms late: tier 2 for a cut (past its 40 ms
  // perfect window) but tier 3 for flow's wider 70 ms window.
  const gesture = withLatest(lineThroughCenter(0, 40, 1020, 1100), NOTE_TIME + CUT_METRIC_WINDOW_MS);

  assert.equal(resultFor(judgeGesture(note({ kind: "cut" }), gesture)), "tier2");
  assert.equal(resultFor(judgeGesture(note({ kind: "flow", flowShape: [0, 0, 0, 0] }), gesture)), "tier3");
});

check("a lone flow anchor (no shape) judges motion only", () => {
  // No phrase neighbours means no ribbon shape, so heading is free (like a lyric).
  const lone = note({ kind: "flow" });
  const gesture = withLatest(lineThroughCenter(Math.PI / 2, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);

  assert.equal(resultFor(judgeGesture(lone, gesture)), "tier3");
});

check("flow shape match accounts for the ribbon's bend, not just one heading", () => {
  // Ribbon bends hard across its bins (right -> down-left). A straight rightward sweep
  // matches only the first bin (~84 degrees RMS error), so the whole-shape cap reads
  // the bend, not a single heading.
  const curved = note({ kind: "flow", flowShape: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4] });
  const straight = withLatest(lineThroughCenter(0, 40), NOTE_TIME + CUT_METRIC_WINDOW_MS);

  assert.equal(judged(judgeGesture(curved, straight)).result, "tier1");
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
  assert.equal(judgeGesture(note(), gesture, NOTE_TIME - 50).status, "pending");
});

for (const testCase of cases) {
  testCase.run();
  console.log(`ok - ${testCase.name}`);
}

console.log(`${cases.length} judgement simulations passed`);
