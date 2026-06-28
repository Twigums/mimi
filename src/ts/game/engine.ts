import { clamp } from "../core/utils";
import { drawArrow, drawFlowAnchor, drawLyricDemoFunnel, drawLyricNote, drawFireworks, drawFlowRibbon, notePulseScale, RIBBON_ERASE_LAG_MS, RIBBON_ERASE_MS } from "./draw";
import { arToMs, loadAr, loadHitsoundVolume, subscribeHitsoundVolume, volToFactor, loadHiddenMod, subscribeHiddenMod } from "../core/settings";
import { createCursorRenderer, type CursorRenderer } from "./cursor";
import { lyricDemoFunnelOrigin, lyricFillProgress, lyricVisualScale } from "./lyricLayout";
import { computeLyricHolds, noteEndMs } from "./lyrics";
import {
  createLyricHoldState,
  updateLyricHoldState,
  type LyricHoldState,
} from "./holdTracker";
import { hashChart } from "./personalBest";
import {
  CUT_METRIC_WINDOW_MS,
  FLOW_SHAPE_BINS,
  LYRIC_HOLD_RADIUS,
  MAX_POINTS,
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

export const LYRIC_CHAR_MAX_DIST_MS = 80;

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
  lyricSpan?: number;
  lyricSrcTime?: number;
  // Lyric only: hold duration in ms (derived from the next note; see computeLyricHolds).
  holdMs?: number;
  // Lyric only: extend the char-fetch window past the hold end by epsilon to include the
  // closing syllable (the `endchar` chart option / osu `finish` hitsound; see lyricCharWindow).
  includeEndChar?: boolean;
  directionPinned?: boolean;
  newCombo?: boolean;
  flowPrevIndex?: number;
  flowNextIndex?: number;
  // Non-flow neighbours used only for auto tangent at phrase boundaries (no ribbon link).
  flowHintPrevIndex?: number;
  flowHintNextIndex?: number;
  flowTanX?: number;
  flowTanY?: number;
  flowShape?: number[];
  // Flow only: wall-clock ms when this anchor was hit, driving the ribbon's post-hit erase
  // (the tail retreating toward the next anchor, dissolving into a poof). Cleared on reset.
  flowHitMs?: number;
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
  lyricSpan?: number;
  holdMs?: number;
  flowPrevIndex?: number;
}

export interface GameHandle {
  setChart(notes: Note[]): void;
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
  onAccuracy:      (accuracy: number) => void;
  onFeedback:      (result: HitResult, x: number, y: number) => void;
  onComboChange:   (combo: number) => void;
  onPlayingChange: (playing: boolean) => void;
  hitSoundUrl?:    string;
  logicalW?:       number;
  logicalH?:       number;
  /** Draw a canvas lyric funnel (TestPlay/tutorial; song pages use the storyboard). */
  lyricDemoFunnel?: boolean;
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
  const { canvas, gameArea, onAccuracy, onFeedback, onComboChange, onPlayingChange } = deps;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const logicalW = deps.logicalW ?? LOGICAL_W;
  const logicalH = deps.logicalH ?? LOGICAL_H;
  const lyricDemoFunnel = deps.lyricDemoFunnel ?? false;
  const funnelOrigin = lyricDemoFunnelOrigin(logicalW, logicalH);
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
  const lyricHoldStates = new Map<number, LyricHoldState>();

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
  // Indices of flow anchors whose post-hit ribbon erase is still in flight (the tail retreating
  // toward the next anchor, dissolving into a poof); culled in draw() once fully consumed.
  let flowErasing: number[] = [];
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

  // After reset(), skip expiry until the song confirms it has rewound to the lead-in window,
  // preventing stale mid-song positions from triggering immediate misses.
  let skipExpiry = false;

  // `score` is the internal accuracy accumulator (sum of judged points), never shown
  // to the player; accuracy = score / (judged notes × MAX_POINTS) is the live readout.
  const emitAccuracy = (): void => {
    const total = tier3Count + tier2Count + tier1Count + missCount;
    onAccuracy(total === 0 ? 0 : score / (total * MAX_POINTS));
  };

  const recordPointerSample = (songMs: number): void => {
    pointerSamples.push({
      x: pointer.x,
      y: pointer.y,
      songMs,
      wallMs: performance.now(),
    });
    // Cut/flow gesture windows only; lyric holds use per-note trackers instead.
    while (pointerSamples.length > 256) pointerSamples.shift();
  };

  const updateLyricHoldTrackers = (songMs: number): void => {
    for (let i = pendingStart; i < notes.length; i++) {
      const n = notes[i];
      if (n.state !== "pending" || n.kind !== "lyric") continue;
      const holdMs = n.holdMs ?? 0;
      if (holdMs <= 0) continue;

      const windowStart = n.time - TIER1_MS;
      const holdEnd = n.time + holdMs;
      if (songMs < windowStart) continue;

      let state = lyricHoldStates.get(i);
      if (state === undefined) {
        state = createLyricHoldState(n.time, holdMs);
        lyricHoldStates.set(i, state);
      }
      updateLyricHoldState(state, n.x, n.y, pointer.x, pointer.y, Math.min(songMs, holdEnd));
    }
  };

  // Flow anchors take their direction from the ribbon they trace. By default the
  // tangent points along the bisector of the incoming (prev->this) and outgoing
  // (this->next) unit chords; at a phrase boundary, a neighbouring non-flow object
  // may stand in when the chart has no `break` (`newCombo`) on that side — it
  // influences auto heading only (no ribbon is drawn to it). An anchor whose chart
  // row authored a `degrees` value (`directionPinned`) instead pins that heading.
  // Either way the length is the tension weight times the shorter adjacent chord,
  // which keeps the cubic Hermite ribbon from overshooting where spacing is uneven.
  // The arrow and the judged shape use the angle; `draw` uses the full vector. A
  // lone anchor (no links or hints) or a 180-degree cusp without a pin returns null
  // and keeps its current direction.
  const flowTangent = (index: number): { x: number; y: number } | null => {
    const n = notes[index];
    let dirX = 0, dirY = 0;
    let span = Infinity;
    const prevIndex = n.flowPrevIndex ?? n.flowHintPrevIndex;
    if (prevIndex !== undefined) {
      const p = notes[prevIndex];
      const dx = n.x - p.x, dy = n.y - p.y, len = Math.hypot(dx, dy);
      if (len > 0) { dirX += dx / len; dirY += dy / len; span = Math.min(span, len); }
    }
    const nextIndex = n.flowNextIndex ?? n.flowHintNextIndex;
    if (nextIndex !== undefined) {
      const x = notes[nextIndex];
      const dx = x.x - n.x, dy = x.y - n.y, len = Math.hypot(dx, dy);
      if (len > 0) { dirX += dx / len; dirY += dy / len; span = Math.min(span, len); }
    }
    if (!Number.isFinite(span)) return null;
    let ux: number, uy: number;
    if (n.directionPinned) {
      ux = Math.cos(n.direction);
      uy = Math.sin(n.direction);
    } else {
      const dirLen = Math.hypot(dirX, dirY);
      if (dirLen === 0) return null;
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
    let prevFlowIndex: number | null = null;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      note.flowPrevIndex = undefined;
      note.flowNextIndex = undefined;
      note.flowHintPrevIndex = undefined;
      note.flowHintNextIndex = undefined;
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

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      if (note.kind !== "flow") continue;
      if (note.flowPrevIndex === undefined && !note.newCombo && i > 0) {
        note.flowHintPrevIndex = i - 1;
      }
      if (note.flowNextIndex === undefined) {
        const next = notes[i + 1];
        if (next && !next.newCombo) note.flowHintNextIndex = i + 1;
      }
    }

    // links are now resolved for the whole chart
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
    emitAccuracy();
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

  const tryHit = (note: Note, songMs: number, noteIndex: number, prevNoteTime?: number): void => {
    if (note.state !== "pending") return;

    const attempt = judgeGesture(note, pointerSamples, prevNoteTime, lyricHoldStates.get(noteIndex));
    if (attempt.status !== "judged") return;

    lyricHoldStates.delete(noteIndex);

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
      score += points;
      emitAccuracy();
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
      // A hit flow anchor with a linked successor starts its ribbon erasing toward it.
      if (note.kind === "flow" && note.flowNextIndex !== undefined) {
        note.flowHitMs = songMs;
        flowErasing.push(noteIndex);
      }
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
      lyricHoldStates.delete(i);
    }
  };

  // Ribbon reveal fraction (0..1) for a linked segment: keyed to the inter-anchor gap (starting
  // when `from` appears) so the leading edge reaches `to` just as `to` appears — one approach
  // window before to's hit — eased with smoothstep so the band settles gently into each anchor.
  const ribbonReveal = (from: Note, to: Note, songMs: number): number => {
    const gap = to.time - from.time;
    const lin = gap > 0 ? clamp((songMs - from.time + approachMs) / gap, 0, 1) : 1;
    return lin * lin * (3 - 2 * lin);
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
    // Pending ribbons: each linked flow segment reveals toward its (still pending) next anchor.
    for (let i = pendingStart; i < notes.length; i++) {
      const note = notes[i];
      if (note.state !== "pending" || note.kind !== "flow" || note.flowNextIndex === undefined) continue;
      const next = notes[note.flowNextIndex];
      if (!next || next.state !== "pending") continue;
      const dtFrom = note.time - songMs;
      if (dtFrom > approachMs) break;
      if (next.time - songMs < -TIER1_MS) continue;
      drawFlowRibbon(ctx, note, next, scale, ribbonReveal(note, next, songMs));
    }
    // Erasing ribbons: a hit anchor's segment keeps drawing while its tail erases toward the next
    // anchor (fixed wall-clock; see RIBBON_* in draw.ts), dissolving into a poof at the retreating
    // edge. A segment is dropped once the erase overtakes the revealed front (fully consumed).
    const stillErasing: number[] = [];
    for (const fromIdx of flowErasing) {
      const from = notes[fromIdx];
      const nextIdx = from?.flowNextIndex;
      if (!from || nextIdx === undefined || from.flowHitMs === undefined) continue;
      const next = notes[nextIdx];
      if (!next) continue;
      const el = songMs - from.flowHitMs;
      const revealFront = ribbonReveal(from, next, songMs);
      const eraseBack = clamp((el - RIBBON_ERASE_LAG_MS) / RIBBON_ERASE_MS, 0, 1);
      if (eraseBack >= revealFront) continue;
      drawFlowRibbon(ctx, from, next, scale, revealFront, eraseBack);
      stillErasing.push(fromIdx);
    }
    flowErasing = stillErasing;
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
        const fillProgress = lyricFillProgress(note.lyricChar ?? "", note.time, songMs, approachMs);
        const approachPulse = notePulseScale(dt);
        const visualScale = songMs >= note.time
          ? lyricVisualScale(holdMs, songMs, note.time, holding, approachPulse)
          : approachPulse;
        const elapsedSinceHitMs = Math.max(0, songMs - note.time);
        drawLyricNote(
          ctx, note, appearProgress, scale, hiddenMod,
          holdProgress, holding, visualScale, fillProgress,
          holdMs, elapsedSinceHitMs,
        );
        if (lyricDemoFunnel && dt > 0 && fillProgress < 1) {
          drawLyricDemoFunnel(
            ctx, note, songMs, approachMs, scale,
            funnelOrigin.x, funnelOrigin.y, approachPulse,
          );
        }
      } else {
        if (dt < -TIER1_MS) continue;
        const appearProgress = clamp(1 - dt / approachMs, 0, 1);
        if (note.kind === "flow") {
          drawFlowAnchor(ctx, note, appearProgress, scale, hiddenMod, notePulseScale(dt));
        } else {
          drawArrow(ctx, note, appearProgress, scale, hiddenMod, notePulseScale(dt));
        }
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
      flowErasing = [];
      debugDrawOnce = true;
      linkFlowPhrases();
      computeLyricHolds(notes, endTimes);
      lyricHoldStates.clear();
    },

    reset(): void {
      skipExpiry = true;
      pendingStart = 0;
      for (const n of notes) { n.state = "pending"; n.hitResult = undefined; n.flowHitMs = undefined; }
      animations = [];
      animStart = 0;
      flowErasing = [];
      score = 0;
      tier3Count = 0;
      tier2Count = 0;
      tier1Count = 0;
      missCount  = 0;
      comboCount = 0;
      maxCombo   = 0;
      hitDetails = [];
      pointerSamples.length = 0;
      lyricHoldStates.clear();
      emitAccuracy();
      onComboChange(0);
      onPlayingChange(false);
    },

    start(): void {
      onPlayingChange(true);
    },

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

    spawnNote(spec: SpawnSpec): number {
      const note: Note = {
        kind: spec.kind,
        time: spec.time,
        x: spec.x,
        y: spec.y,
        direction: spec.direction,
        state: "pending",
        lyricChar: spec.lyricChar,
        lyricSpan: spec.lyricSpan,
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
          applyFlowTangent(spec.flowPrevIndex);
        }
      }
      if (spec.kind === "flow") applyFlowTangent(index);

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
        updateLyricHoldTrackers(songMs);
        for (let i = pendingStart; i < notes.length; i++) {
          const n = notes[i];
          if (n.time > songMs + TIER1_MS) break;
          if (n.state === "pending") tryHit(n, songMs, i, notes[i - 1]?.time);
        }
        if (skipExpiry) {
          if (songMs <= approachMs) skipExpiry = false;
        } else {
          expireMisses(songMs);
        }

        // Advance past resolved notes
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
