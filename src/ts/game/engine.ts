import { clamp } from "../core/utils";
import { drawArrow, drawLyricNote, drawFireworks, drawFlowRibbon } from "./draw";
import { arToMs, loadAr, loadHitsoundVolume, subscribeHitsoundVolume, volToFactor, loadHiddenMod, subscribeHiddenMod } from "../core/settings";
import { createCursorRenderer, type CursorRenderer } from "./cursor";
import { computeLyricHolds, noteEndMs, populateLyricChars } from "./lyrics";
import { hashChart } from "./personalBest";
import {
  CUT_METRIC_WINDOW_MS,
  FLOW_SHAPE_BINS,
  LYRIC_HOLD_RADIUS,
  TIER1_MS,
  type HitResult,
  type HitTiming,
  type IssueReason,
  type NoteKind,
  type PointerSample,
  judgeGesture,
  resampleHeadings,
  timingFor,
} from "./judgement";
export { MAX_POINTS, TIER1_POINTS, TIER2_POINTS, TIER3_POINTS } from "./judgement";

export const LOGICAL_W = 800;
export const LOGICAL_H = 600;

// How far the ribbon bows through each flow anchor, as a fraction of the shorter
// adjacent chord. Higher = rounder curves (less kinking at the waypoint) at the cost
// of some overshoot risk on very uneven spacing.
const FLOW_TANGENT_WEIGHT = 0.9;

type NoteState         = "pending" | "hit" | "missed";
export type { HitResult, HitTiming, IssueReason, NoteKind } from "./judgement";

export interface Note {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  state: NoteState;
  hitResult?: HitResult;
  lyricChar?: string;
  // Lyric only: hold duration in ms (derived from the next note; see computeLyricHolds).
  holdMs?: number;
  directionPinned?: boolean;
  newCombo?: boolean;
  flowPrevIndex?: number;
  flowNextIndex?: number;
  flowTanX?: number;
  flowTanY?: number;
  flowShape?: number[];
}

interface RawNote extends Omit<Note, "kind" | "state"> {
  kind?: unknown;
  state?: unknown;
}

export interface HitDetail {
  result: HitResult;
  kind: NoteKind;
  offsetMs: number;
  timing: HitTiming;
  x: number;
  y: number;
  issue?: IssueReason;
}

interface HitAnimation {
  x: number;
  y: number;
  kind: NoteKind;
  startMs: number;
  seed: number;
}

export interface GameStats {
  score: number;
  tier3: number;
  tier2: number;
  tier1: number;
  miss: number;
  total: number;
  combo: number;
  maxCombo: number;
  hits: HitDetail[];
  // Total notes of each kind in the chart (independent of how they were judged),
  // surfaced as chart composition in the results screen.
  noteCounts: Record<NoteKind, number>;
  // Content hash of the live chart (independent of the run), so the results screen
  // can key personal-best tracking to this exact note set (see personalBest.ts).
  chartHash: string;
}

export interface SpawnSpec {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  lyricChar?: string;
  holdMs?: number;
  flowPrevIndex?: number;
}

export interface GameHandle {
  setChart(notes: Note[]): void;
  // Supplies the sung characters whose start time falls in [startMs, endMs), concatenated
  // in order (empty when none); used to auto-fill a lyric note's text from its hold window.
  setCharLookup(charsInRange: (startMs: number, endMs: number) => string): void;
  reset(): void;
  start(): void;
  setPlaying(playing: boolean): void;
  tick(songMs: number): void;
  getStats(): GameStats;
  setApproachMs(ms: number): void;
  spawnNote(spec: SpawnSpec): number;
  destroy(): void;
}

interface GameDeps {
  canvas:          HTMLCanvasElement;
  gameArea:        HTMLElement;
  onScore:         (score: number) => void;
  onFeedback:      (result: HitResult, x: number, y: number) => void;
  onComboChange:   (combo: number) => void;
  onPlayingChange: (playing: boolean) => void;
  hitSoundUrl?:    string;
  // logical play-field span in gameplay px; a smaller span than the default
  // 800×600 zooms the same notes in (used by the testplay surface)
  logicalW?:       number;
  logicalH?:       number;
}

function normalizeNoteKind(kind: unknown): NoteKind | null {
  if (typeof kind !== "string") return null;
  switch (kind.toLowerCase()) {
    case "cut":
    case "c":
      return "cut";
    case "flow":
    case "f":
      return "flow";
    case "lyric":
    case "l":
      return "lyric";
    default:
      return null;
  }
}

function normalizeChartNotes(rawNotes: RawNote[]): Note[] {
  const normalized: Note[] = [];
  const droppedKinds = new Set<unknown>();

  for (const raw of rawNotes) {
    const kind = normalizeNoteKind(raw.kind);
    if (!kind) {
      droppedKinds.add(raw.kind);
      continue;
    }

    normalized.push({
      ...raw,
      kind,
      state: raw.state === "hit" || raw.state === "missed" ? raw.state : "pending",
    });
  }

  if (droppedKinds.size > 0) {
    console.warn("[mimi] dropped chart notes with unknown kinds:", Array.from(droppedKinds));
  }

  return normalized.sort((a, b) => a.time - b.time);
}

export function createGame(deps: GameDeps): GameHandle {
  const { canvas, gameArea, onScore, onFeedback, onComboChange, onPlayingChange } = deps;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const logicalW = deps.logicalW ?? LOGICAL_W;
  const logicalH = deps.logicalH ?? LOGICAL_H;
  const getScale = (): number => canvas.width / logicalW;

  const cursor: CursorRenderer = createCursorRenderer(canvas, getScale);

  let approachMs = arToMs(loadAr());
  let hiddenMod  = loadHiddenMod();

  let audioCtx: AudioContext | null = null;
  let hitSoundBuffer: AudioBuffer | null = null;
  let hitsoundGain: GainNode | null = null;

  const playHitSound = (result: HitResult): void => {
    if (!audioCtx || !hitSoundBuffer || !hitsoundGain) return;
    const source = audioCtx.createBufferSource();
    const resultGain = audioCtx.createGain();
    source.buffer = hitSoundBuffer;
    source.playbackRate.value = result === "tier3" ? 1.2
      : result === "tier2" ? 1.0
      : 0.85;
    resultGain.gain.value = result === "tier3" ? 1.0
      : result === "tier2" ? 0.82
      : 0.6;
    source.connect(resultGain);
    if (result === "tier3") {
      // brighten the perfect hit so it reads as distinctly sharper/crisper
      const bright = audioCtx.createBiquadFilter();
      bright.type = "highshelf";
      bright.frequency.value = 3200;
      bright.gain.value = 10;
      resultGain.connect(bright);
      bright.connect(hitsoundGain);
    } else {
      resultGain.connect(hitsoundGain);
    }
    source.start();
  };

  let audioLoadCleanup: (() => void) | null = null;

  if (deps.hitSoundUrl) {
    const url = deps.hitSoundUrl;
    let loading = false;
    const loadSound = (): void => {
      if (loading) return;
      loading = true;
      audioCtx = new AudioContext();
      hitsoundGain = audioCtx.createGain();
      hitsoundGain.gain.value = volToFactor(loadHitsoundVolume());
      hitsoundGain.connect(audioCtx.destination);
      fetch(url)
        .then(r => r.arrayBuffer())
        .then(buf => audioCtx!.decodeAudioData(buf))
        .then(decoded => { hitSoundBuffer = decoded; })
        .catch(err => console.error("[mimi] hitsound load failed:", err));
    };
    window.addEventListener("pointerdown", loadSound, { once: true });
    window.addEventListener("keydown",     loadSound, { once: true });
    audioLoadCleanup = (): void => {
      window.removeEventListener("pointerdown", loadSound);
      window.removeEventListener("keydown",     loadSound);
    };
  }

  const unsubHitsound = subscribeHitsoundVolume(v => {
    if (hitsoundGain) hitsoundGain.gain.value = volToFactor(v);
  });

  const unsubHiddenMod = subscribeHiddenMod(v => { hiddenMod = v; });

  const resize = (): void => {
    const rect = gameArea.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
  };
  resize();

  const pointer = { x: 0, y: 0, prevX: 0, prevY: 0 };
  const pointerSamples: PointerSample[] = [];

  const setPointer = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (clientX - rect.left) * (logicalW / rect.width);
    pointer.y = (clientY - rect.top)  * (logicalH / rect.height);
  };

  const onMouseMove  = (e: MouseEvent): void => setPointer(e.clientX, e.clientY);
  const onMouseDown  = (e: MouseEvent): void => { setPointer(e.clientX, e.clientY); };
  const onTouchMove  = (e: TouchEvent): void => {
    const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY); e.preventDefault();
  };
  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY); e.preventDefault();
  };

  canvas.addEventListener("mousemove",  onMouseMove);
  canvas.addEventListener("mousedown",  onMouseDown);
  canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("resize",     resize);

  let notes: Note[] = [];
  let pendingStart = 0;
  let animations: HitAnimation[] = [];
  let animStart = 0;
  let score = 0;
  let tier3Count = 0;
  let tier2Count = 0;
  let tier1Count = 0;
  let missCount  = 0;
  let comboCount = 0;
  let maxCombo   = 0;
  let hitDetails: HitDetail[] = [];
  let reportedUpdateError = false;
  let reportedDrawError = false;
  let reportedCursorError = false;
  let debugDrawOnce = true;

  let lyricCharLookup: ((startMs: number, endMs: number) => string) | null = null;

  // After reset(), skip expiry until the song confirms it has rewound to the lead-in window,
  // preventing stale mid-song positions from triggering immediate misses.
  let skipExpiry = false;

  const setScore = (v: number): void => { score = v; onScore(v); };

  const recordPointerSample = (songMs: number): void => {
    pointerSamples.push({
      x: pointer.x,
      y: pointer.y,
      songMs,
      wallMs: performance.now(),
    });
    // Keep enough history to span a lyric hold plus the metric windows even at high
    // refresh rates, since a held lyric is judged across its whole duration.
    while (pointerSamples.length > 256) pointerSamples.shift();
  };

  // Flow anchors take their direction from the ribbon they trace. By default the
  // tangent points along the bisector of the incoming (prev->this) and outgoing
  // (this->next) unit chords; an anchor whose chart row authored a `degrees` value
  // (`directionPinned`) instead pins that heading. Either way the length is the
  // tension weight times the shorter adjacent chord, which keeps the cubic Hermite
  // ribbon from overshooting where spacing is uneven. The arrow and the judged shape
  // use the angle; `draw` uses the full vector. A lone anchor (no links) or a
  // 180-degree cusp without a pin returns null and keeps its current direction.
  const flowTangent = (index: number): { x: number; y: number } | null => {
    const n = notes[index];
    let dirX = 0, dirY = 0;
    let span = Infinity;
    if (n.flowPrevIndex !== undefined) {
      const p = notes[n.flowPrevIndex];
      const dx = n.x - p.x, dy = n.y - p.y, len = Math.hypot(dx, dy);
      if (len > 0) { dirX += dx / len; dirY += dy / len; span = Math.min(span, len); }
    }
    if (n.flowNextIndex !== undefined) {
      const x = notes[n.flowNextIndex];
      const dx = x.x - n.x, dy = x.y - n.y, len = Math.hypot(dx, dy);
      if (len > 0) { dirX += dx / len; dirY += dy / len; span = Math.min(span, len); }
    }
    if (!Number.isFinite(span)) return null; // lone anchor: no ribbon, no magnitude
    let ux: number, uy: number;
    if (n.directionPinned) {
      ux = Math.cos(n.direction);
      uy = Math.sin(n.direction);
    } else {
      const dirLen = Math.hypot(dirX, dirY);
      if (dirLen === 0) return null; // 180-degree cusp with no authored heading
      ux = dirX / dirLen;
      uy = dirY / dirLen;
    }
    const mag = FLOW_TANGENT_WEIGHT * span;
    return { x: ux * mag, y: uy * mag };
  };

  const applyFlowTangent = (index: number): void => {
    const t = flowTangent(index);
    if (!t) return;
    const n = notes[index];
    n.flowTanX = t.x;
    n.flowTanY = t.y;
    n.direction = Math.atan2(t.y, t.x);
  };

  // The local ribbon shape an anchor is judged against: sample the cubic Hermite over
  // the half-segments on either side of the anchor (so the window is centred on it),
  // then reduce to FLOW_SHAPE_BINS arc-length headings. A lone anchor has no shape.
  const SHAPE_HALF_STEPS = 5;
  const hermite = (
    ax: number, ay: number, tax: number, tay: number,
    bx: number, by: number, tbx: number, tby: number, s: number,
  ): { x: number; y: number } => {
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    return {
      x: h00 * ax + h10 * tax + h01 * bx + h11 * tbx,
      y: h00 * ay + h10 * tay + h01 * by + h11 * tby,
    };
  };

  const applyFlowShape = (index: number): void => {
    const n = notes[index];
    if (n.kind !== "flow") return;
    const pts: { x: number; y: number }[] = [];
    if (n.flowPrevIndex !== undefined) {
      const p = notes[n.flowPrevIndex];
      const tax = p.flowTanX ?? n.x - p.x, tay = p.flowTanY ?? n.y - p.y;
      const tbx = n.flowTanX ?? n.x - p.x, tby = n.flowTanY ?? n.y - p.y;
      for (let i = 0; i < SHAPE_HALF_STEPS; i++) {
        pts.push(hermite(p.x, p.y, tax, tay, n.x, n.y, tbx, tby, 0.5 + (0.5 * i) / SHAPE_HALF_STEPS));
      }
    }
    pts.push({ x: n.x, y: n.y });
    if (n.flowNextIndex !== undefined) {
      const x = notes[n.flowNextIndex];
      const tax = n.flowTanX ?? x.x - n.x, tay = n.flowTanY ?? x.y - n.y;
      const tbx = x.flowTanX ?? x.x - n.x, tby = x.flowTanY ?? x.y - n.y;
      for (let i = 1; i <= SHAPE_HALF_STEPS; i++) {
        pts.push(hermite(n.x, n.y, tax, tay, x.x, x.y, tbx, tby, (0.5 * i) / SHAPE_HALF_STEPS));
      }
    }
    n.flowShape = pts.length >= 2 ? resampleHeadings(pts, FLOW_SHAPE_BINS) ?? undefined : undefined;
  };

  const linkFlowPhrases = (): void => {
    // Phrases are explicit, not auto-detected: consecutive flow anchors link into one
    // phrase until a `newCombo` anchor (a chart `break`) starts a new one, or a
    // non-flow note interrupts the run.
    let prevFlowIndex: number | null = null;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      note.flowPrevIndex = undefined;
      note.flowNextIndex = undefined;
      if (note.kind !== "flow") {
        prevFlowIndex = null;
        continue;
      }
      if (prevFlowIndex !== null && !note.newCombo) {
        note.flowPrevIndex = prevFlowIndex;
        notes[prevFlowIndex].flowNextIndex = i;
      }
      prevFlowIndex = i;
    }
    // Links are now resolved for the whole chart; derive each anchor's tangent, then
    // its local shape (which depends on the neighbours' tangents).
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].kind === "flow") applyFlowTangent(i);
    }
    for (let i = 0; i < notes.length; i++) {
      if (notes[i].kind === "flow") applyFlowShape(i);
    }
  };

  const resolveMiss = (note: Note, offsetMs: number, reason: IssueReason): void => {
    note.state = "missed";
    note.hitResult = "miss";
    missCount++;
    comboCount = 0;
    onComboChange(0);
    hitDetails.push({
      result: "miss",
      kind: note.kind,
      offsetMs,
      timing: timingFor(offsetMs),
      x: note.x,
      y: note.y,
      issue: reason,
    });
    onFeedback("miss", note.x, note.y);
  };

  const tryHit = (note: Note, songMs: number, prevNoteTime?: number): void => {
    if (note.state !== "pending") return;

    const attempt = judgeGesture(note, pointerSamples, prevNoteTime);
    if (attempt.status !== "judged") return;

    const { result, points, offsetMs, timing, issue } = attempt.judgement;
    if (result === "miss") {
      resolveMiss(note, offsetMs, issue ?? "timing");
      return;
    }

    note.state = "hit";
    note.hitResult = result;
    if (result === "tier3") tier3Count++;
    else if (result === "tier2") tier2Count++;
    else if (result === "tier1") tier1Count++;
    if (points > 0) {
      setScore(score + points);
      if (result === "tier1") {
        comboCount = 0;
      } else {
        comboCount++;
        maxCombo = Math.max(maxCombo, comboCount);
      }
      onComboChange(comboCount);
      animations.push({
        x: note.x, y: note.y, kind: note.kind, startMs: songMs,
        seed: Math.floor(note.x * 7919 + note.y * 6271),
      });
    }
    hitDetails.push({
      result,
      kind: note.kind,
      offsetMs,
      timing,
      x: note.x,
      y: note.y,
      issue,
    });
    onFeedback(result, note.x, note.y);
    playHitSound(result);
  };

  const expireMisses = (songMs: number): void => {
    // Notes are time-sorted by start: once a note's start is recent enough that even a
    // zero-length note isn't expirable, nothing after it can be either. A lyric hold
    // expires off its end (start + holdMs), so it survives until its hold has elapsed.
    for (let i = pendingStart; i < notes.length; i++) {
      const n = notes[i];
      if (n.time > songMs - CUT_METRIC_WINDOW_MS) break;
      if (n.state !== "pending") continue;
      if (songMs - noteEndMs(n) <= CUT_METRIC_WINDOW_MS) continue;
      resolveMiss(n, songMs - n.time, "timing");
    }
  };

  const draw = (songMs: number): void => {
    if (debugDrawOnce && notes.length > 0) {
      debugDrawOnce = false;
      let renderedCount = 0;
      let drawnCount = 0;
      for (let i = pendingStart; i < notes.length; i++) {
        const note = notes[i];
        const dt = note.time - songMs;
        if (note.state === "pending") {
          renderedCount++;
          if (dt <= approachMs && dt >= -TIER1_MS) drawnCount++;
        }
        if (dt > approachMs) break;
      }
      console.log("[mimi] DRAW FIRST FRAME:", {
        songMs,
        approachMs,
        TIER1_MS,
        CUT_METRIC_WINDOW_MS,
        notesTotal: notes.length,
        pendingStart,
        pendingNotes: renderedCount,
        drawnNotes: drawnCount,
        firstNote: notes[pendingStart]?.time,
        firstNoteDt: notes[pendingStart] ? notes[pendingStart].time - songMs : undefined,
      });
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = getScale();
    for (let i = pendingStart; i < notes.length; i++) {
      const note = notes[i];
      if (note.state !== "pending" || note.kind !== "flow" || note.flowNextIndex === undefined) continue;
      const next = notes[note.flowNextIndex];
      if (!next || next.state !== "pending") continue;
      const dt = next.time - songMs;
      if (dt > approachMs) break;
      if (dt < -TIER1_MS) continue;
      const appearProgress = clamp(1 - dt / approachMs, 0, 1);
      drawFlowRibbon(ctx, note, next, scale, appearProgress);
    }
    // Notes are time-sorted: break once a pending note is past the approach window
    for (let i = pendingStart; i < notes.length; i++) {
      const note = notes[i];
      if (note.state !== "pending") continue;
      const dt = note.time - songMs;
      if (dt > approachMs) break;
      if (note.kind === "lyric") {
        const holdMs = note.holdMs ?? 0;
        // Keep the lyric (with its progress ring) on screen through the whole hold; an
        // invalid (unbounded) lyric has no hold, so it uses the standard note window.
        if (dt < -(holdMs + TIER1_MS)) continue;
        const appearProgress = clamp(1 - dt / approachMs, 0, 1);
        const holdProgress = holdMs > 0 ? clamp((songMs - note.time) / holdMs, 0, 1) : 0;
        const holding = holdMs > 0 && songMs >= note.time && songMs <= note.time + holdMs &&
          Math.hypot(pointer.x - note.x, pointer.y - note.y) <= LYRIC_HOLD_RADIUS;
        drawLyricNote(ctx, note, appearProgress, scale, hiddenMod, holdProgress, holding);
      } else {
        if (dt < -TIER1_MS) continue;
        const appearProgress = clamp(1 - dt / approachMs, 0, 1);
        drawArrow(ctx, note, appearProgress, scale, hiddenMod);
      }
    }
    for (let i = animStart; i < animations.length; i++) {
      const anim = animations[i];
      const dt = songMs - anim.startMs;
      if (dt < 0 || dt >= 300) continue;
      drawFireworks(ctx, anim.x, anim.y, anim.kind, dt / 300, scale, anim.seed);
    }
    while (animStart < animations.length && songMs - animations[animStart].startMs >= 300) animStart++;
  };

  return {
    setChart(n: Note[]): void {
      // `end` markers are inert: they only carry a time that bounds a preceding lyric's
      // hold. Pull their times out, then discard them so judging/drawing/stats never see
      // them (keeping the rest of the engine free of a non-playable kind).
      const endTimes: number[] = [];
      const playable: RawNote[] = [];
      for (const r of n as RawNote[]) {
        if (typeof r.kind === "string" && r.kind.toLowerCase() === "end") {
          if (typeof r.time === "number") endTimes.push(r.time);
        } else {
          playable.push(r);
        }
      }
      notes = normalizeChartNotes(playable);
      pendingStart = 0;
      debugDrawOnce = true;
      linkFlowPhrases();
      computeLyricHolds(notes, endTimes);
      if (lyricCharLookup) populateLyricChars(notes, lyricCharLookup);
    },

    setCharLookup(charsInRange): void {
      lyricCharLookup = charsInRange;
      populateLyricChars(notes, charsInRange);
    },

    reset(): void {
      skipExpiry = true;
      pendingStart = 0;
      for (const n of notes) { n.state = "pending"; n.hitResult = undefined; }
      animations = [];
      animStart = 0;
      setScore(0);
      tier3Count = 0;
      tier2Count = 0;
      tier1Count = 0;
      missCount  = 0;
      comboCount = 0;
      maxCombo   = 0;
      hitDetails = [];
      pointerSamples.length = 0;
      onComboChange(0);
      onPlayingChange(false);
    },

    start(): void {
      onPlayingChange(true);
    },

    // Reflect a playback state change that did NOT originate from start()/reset()
    // (e.g. the player pausing or stopping on its own) without wiping the score.
    setPlaying(playing: boolean): void {
      onPlayingChange(playing);
    },

    getStats(): GameStats {
      const noteCounts: Record<NoteKind, number> = { cut: 0, flow: 0, lyric: 0 };
      for (const n of notes) noteCounts[n.kind]++;
      return {
        score,
        tier3:   tier3Count,
        tier2:   tier2Count,
        tier1:   tier1Count,
        miss:    missCount,
        total:   tier3Count + tier2Count + tier1Count + missCount,
        combo:   comboCount,
        maxCombo,
        hits:    hitDetails.slice(),
        noteCounts,
        chartHash: hashChart(notes),
      };
    },

    setApproachMs(ms: number): void {
      approachMs = ms;
    },

    // Append a single live note. Used by the testplay surface, which has no song
    // timeline: callers pass an absolute `time` (the shared clock) so spawned
    // notes stay time-sorted, preserving the early-break assumptions in tick/draw.
    spawnNote(spec: SpawnSpec): number {
      const note: Note = {
        kind: spec.kind,
        time: spec.time,
        x: spec.x,
        y: spec.y,
        direction: spec.direction,
        state: "pending",
        lyricChar: spec.lyricChar,
        // Spawned lyrics have no chart timeline to derive a bound from, so the caller
        // (the testplay surface) supplies an explicit preview hold length.
        holdMs: spec.kind === "lyric" ? spec.holdMs : undefined,
      };
      const index = notes.length;
      notes.push(note);
      if (spec.flowPrevIndex !== undefined && spec.kind === "flow") {
        const prev = notes[spec.flowPrevIndex];
        if (prev && prev.kind === "flow") {
          note.flowPrevIndex = spec.flowPrevIndex;
          prev.flowNextIndex = index;
          applyFlowTangent(spec.flowPrevIndex); // prev gained an outgoing chord
        }
      }
      if (spec.kind === "flow") applyFlowTangent(index);
      // Re-derive shapes for the new anchor and the neighbours whose tangents moved
      // (the predecessor gained an outgoing chord; its own predecessor's outgoing
      // segment now ends on a re-tangented anchor).
      if (spec.kind === "flow") {
        applyFlowShape(index);
        if (note.flowPrevIndex !== undefined) {
          applyFlowShape(note.flowPrevIndex);
          const pp = notes[note.flowPrevIndex].flowPrevIndex;
          if (pp !== undefined) applyFlowShape(pp);
        }
      }
      return index;
    },

    tick(songMs: number): void {
      recordPointerSample(songMs);
      try {
        // Only check notes within the hit window; notes are time-sorted so break early
        for (let i = pendingStart; i < notes.length; i++) {
          const n = notes[i];
          if (n.time > songMs + TIER1_MS) break;
          if (n.state === "pending") tryHit(n, songMs, notes[i - 1]?.time);
        }
        if (skipExpiry) {
          // Clear only once the timer has actually rewound into the lead-in window.
          // A stale, large mid-song position (the old play head right after reset(),
          // before the async seek lands) must NOT re-enable expiry — otherwise the
          // next tick mass-misses every freshly-pending note before the song restarts.
          if (songMs <= approachMs) skipExpiry = false;
        } else {
          expireMisses(songMs);
        }
        // Advance past resolved notes (hit or missed) at the front
        while (pendingStart < notes.length && notes[pendingStart].state !== "pending") pendingStart++;
      } catch (err) {
        if (!reportedUpdateError) {
          reportedUpdateError = true;
          console.error("[mimi] gameplay update failed:", err);
        }
      }
      try {
        draw(songMs);
      } catch (err) {
        if (!reportedDrawError) {
          reportedDrawError = true;
          console.error("[mimi] gameplay draw failed:", err);
        }
      }
      try {
        cursor.render(performance.now());
      } catch (err) {
        if (!reportedCursorError) {
          reportedCursorError = true;
          console.error("[mimi] cursor render failed:", err);
        }
      }
      pointer.prevX = pointer.x;
      pointer.prevY = pointer.y;
    },

    destroy(): void {
      canvas.removeEventListener("mousemove",  onMouseMove);
      canvas.removeEventListener("mousedown",  onMouseDown);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("resize",     resize);
      cursor.destroy();
      unsubHitsound();
      unsubHiddenMod();
      audioLoadCleanup?.();
    },
  };
}
