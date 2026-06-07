import { clamp } from "../core/utils";
import { drawArrow, drawLyricNote, drawFireworks, drawFlowRibbon } from "./draw";
import { arToMs, loadAr, loadHitsoundVolume, subscribeHitsoundVolume, volToFactor, loadHiddenMod, subscribeHiddenMod } from "../core/settings";
import { createCursorRenderer, type CursorRenderer } from "./cursor";
import {
  FLOW_LINK_MAX_MS,
  TIER1_MS,
  type HitResult,
  type HitTiming,
  type MissReason,
  type NoteKind,
  type PointerSample,
  judgeGesture,
  timingFor,
} from "./judgement";
export { MAX_POINTS, TIER1_POINTS, TIER2_POINTS, TIER3_POINTS } from "./judgement";

export const LOGICAL_W = 800;
export const LOGICAL_H = 600;

const LYRIC_CHAR_MAX_DIST_MS = 80;

type NoteState         = "pending" | "hit" | "missed";
export type { HitResult, HitTiming, MissReason, NoteKind } from "./judgement";

export interface Note {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  state: NoteState;
  hitResult?: HitResult;
  lyricChar?: string;
  flowPrevIndex?: number;
  flowNextIndex?: number;
}

export interface HitDetail {
  result: HitResult;
  kind: NoteKind;
  offsetMs: number;
  timing: HitTiming;
  x: number;
  y: number;
  missReason?: MissReason;
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
}

export interface GameHandle {
  setChart(notes: Note[]): void;
  setCharLookup(findClosestChar: (timeMs: number) => { text: string; distMs: number } | null): void;
  reset(): void;
  start(): void;
  tick(songMs: number): void;
  getStats(): GameStats;
  setApproachMs(ms: number): void;
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
}

export function createGame(deps: GameDeps): GameHandle {
  const { canvas, gameArea, onScore, onFeedback, onComboChange, onPlayingChange } = deps;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const cursor: CursorRenderer = createCursorRenderer(canvas);

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
    source.playbackRate.value = result === "tier3" ? 1.08
      : result === "tier2" ? 1.0
      : 0.92;
    resultGain.gain.value = result === "tier3" ? 1.0
      : result === "tier2" ? 0.85
      : 0.62;
    source.connect(resultGain);
    resultGain.connect(hitsoundGain);
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

  const getScale = (): number => canvas.width / LOGICAL_W;

  const pointer = { x: 0, y: 0, prevX: 0, prevY: 0 };
  const pointerSamples: PointerSample[] = [];

  const setPointer = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (clientX - rect.left) * (LOGICAL_W / rect.width);
    pointer.y = (clientY - rect.top)  * (LOGICAL_H / rect.height);
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

  let lyricCharLookup: ((timeMs: number) => { text: string; distMs: number } | null) | null = null;

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
    while (pointerSamples.length > 12) pointerSamples.shift();
  };

  const populateLyricChars = (): void => {
    if (!lyricCharLookup) return;
    for (const note of notes) {
      if (note.kind !== "lyric") continue;
      if (note.lyricChar !== undefined) continue;
      const result = lyricCharLookup(note.time);
      if (result && result.distMs <= LYRIC_CHAR_MAX_DIST_MS) {
        note.lyricChar = result.text;
      } else {
        note.lyricChar = "";
        console.warn(`[mimi] lyric note at ${note.time}ms: no vocal char within ${LYRIC_CHAR_MAX_DIST_MS}ms`);
      }
    }
  };

  const linkFlowPhrases = (): void => {
    let prevFlowIndex: number | null = null;
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      note.flowPrevIndex = undefined;
      note.flowNextIndex = undefined;
      if (note.kind !== "flow") {
        prevFlowIndex = null;
        continue;
      }
      if (prevFlowIndex !== null) {
        const prev = notes[prevFlowIndex];
        if (note.time - prev.time <= FLOW_LINK_MAX_MS) {
          note.flowPrevIndex = prevFlowIndex;
          prev.flowNextIndex = i;
        }
      }
      prevFlowIndex = i;
    }
  };

  const resolveMiss = (note: Note, offsetMs: number, reason: MissReason): void => {
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
      missReason: reason,
    });
    onFeedback("miss", note.x, note.y);
  };

  const tryHit = (note: Note, songMs: number): void => {
    if (note.state !== "pending") return;

    const prevFlow = note.flowPrevIndex === undefined ? undefined : notes[note.flowPrevIndex];
    const attempt = judgeGesture(note, pointerSamples, prevFlow);
    if (attempt.status !== "judged") return;

    const { result, points, offsetMs, timing, missReason } = attempt.judgement;
    if (result === "miss") {
      resolveMiss(note, offsetMs, missReason ?? "timing");
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
    });
    onFeedback(result, note.x, note.y);
    playHitSound(result);
  };

  const expireMisses = (songMs: number): void => {
    // Notes are time-sorted: break as soon as a pending note is within the hit window
    for (let i = pendingStart; i < notes.length; i++) {
      const n = notes[i];
      if (n.state !== "pending") continue;
      if (songMs - n.time <= TIER1_MS) break;
      resolveMiss(n, songMs - n.time, "timing");
    }
  };

  const draw = (songMs: number): void => {
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
      if (dt < -TIER1_MS) continue;
      const appearProgress = clamp(1 - dt / approachMs, 0, 1);
      if (note.kind === "lyric") {
        drawLyricNote(ctx, note, appearProgress, scale, hiddenMod);
      } else {
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
      notes = n;
      pendingStart = 0;
      linkFlowPhrases();
      populateLyricChars();
    },

    setCharLookup(findClosestChar): void {
      lyricCharLookup = findClosestChar;
      populateLyricChars();
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

    getStats(): GameStats {
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
      };
    },

    setApproachMs(ms: number): void {
      approachMs = ms;
    },

    tick(songMs: number): void {
      recordPointerSample(songMs);
      // Only check notes within the hit window; notes are time-sorted so break early
      for (let i = pendingStart; i < notes.length; i++) {
        const n = notes[i];
        if (n.time > songMs + TIER1_MS) break;
        if (n.state === "pending") tryHit(n, songMs);
      }
      if (skipExpiry) {
        if (songMs <= approachMs) skipExpiry = false;
      } else {
        expireMisses(songMs);
      }
      // Advance past resolved notes (hit or missed) at the front
      while (pendingStart < notes.length && notes[pendingStart].state !== "pending") pendingStart++;
      draw(songMs);
      cursor.render(performance.now());
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
