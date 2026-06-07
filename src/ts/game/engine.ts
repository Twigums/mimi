import { angleDiff, clamp } from "../core/utils";
import { drawArrow, drawLyricNote, drawFireworks, NOTE_RADIUS, LYRIC_RADIUS, NOTE_STYLE } from "./draw";
import { arToMs, loadAr, loadHitsoundVolume, subscribeHitsoundVolume, volToFactor, loadHiddenMod, subscribeHiddenMod } from "../core/settings";
import { createCursorRenderer, type CursorRenderer } from "./cursor";

const TIER3_MS               = 30;
const TIER2_MS               = 60;
const TIER1_MS               = 120;
const LYRIC_CHAR_MAX_DIST_MS = 80;
export const MAX_POINTS      = 100;
export const TIER3_POINTS    = 100;
export const TIER2_POINTS    = 90;
export const TIER1_POINTS    = 50;

export const LOGICAL_W = 800;
export const LOGICAL_H = 600;

const ANGULAR_MARGIN = Math.PI / 6;

export type NoteKind   = "cut" | "flow" | "lyric";
export type HitResult  = "tier3" | "tier2" | "tier1" | "miss";
type NoteState         = "pending" | "hit" | "missed";
export type HitTiming  = "early" | "late" | "on";
export type MissReason = "timing" | "contact" | "direction" | "travel" | "continuity";

export interface Note {
  kind: NoteKind;
  time: number;
  x: number;
  y: number;
  direction: number;
  state: NoteState;
  hitResult?: HitResult;
  lyricChar?: string;
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

interface PointerSample {
  x: number;
  y: number;
  songMs: number;
  wallMs: number;
  held: boolean;
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

  const playHitSound = (): void => {
    if (!audioCtx || !hitSoundBuffer || !hitsoundGain) return;
    const source = audioCtx.createBufferSource();
    source.buffer = hitSoundBuffer;
    source.connect(hitsoundGain);
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

  const pointer = { x: 0, y: 0, prevX: 0, prevY: 0, held: false };
  const keysHeld = new Set<string>();
  const actionHeld = (): boolean => pointer.held || keysHeld.size > 0;
  const pointerSamples: PointerSample[] = [];

  const setPointer = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (clientX - rect.left) * (LOGICAL_W / rect.width);
    pointer.y = (clientY - rect.top)  * (LOGICAL_H / rect.height);
  };

  const onMouseMove  = (e: MouseEvent): void => setPointer(e.clientX, e.clientY);
  const onMouseDown  = (e: MouseEvent): void => { setPointer(e.clientX, e.clientY); pointer.held = true; };
  const onMouseUp    = (): void => { pointer.held = false; };
  const onTouchMove  = (e: TouchEvent): void => {
    const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY); e.preventDefault();
  };
  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0]; if (t) { setPointer(t.clientX, t.clientY); pointer.held = true; } e.preventDefault();
  };
  const onTouchEnd   = (): void => { pointer.held = false; };
  const onKeyDown    = (e: KeyboardEvent): void => { if (!e.repeat) keysHeld.add(e.key); };
  const onKeyUp      = (e: KeyboardEvent): void => { keysHeld.delete(e.key); };

  canvas.addEventListener("mousemove",  onMouseMove);
  canvas.addEventListener("mousedown",  onMouseDown);
  window.addEventListener("mouseup",    onMouseUp);
  canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchend",   onTouchEnd);
  window.addEventListener("keydown",    onKeyDown);
  window.addEventListener("keyup",      onKeyUp);
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
      held: actionHeld(),
    });
    while (pointerSamples.length > 12) pointerSamples.shift();
  };

  const latestPointerSegment = (): { prev: PointerSample; curr: PointerSample } | null => {
    if (pointerSamples.length < 2) return null;
    const curr = pointerSamples[pointerSamples.length - 1];
    const prev = pointerSamples[pointerSamples.length - 2];
    return { prev, curr };
  };

  const interpolateSongMs = (prev: PointerSample, curr: PointerSample, t: number): number => {
    return prev.songMs + (curr.songMs - prev.songMs) * clamp(t, 0, 1);
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

  const timingFor = (deltaMs: number): HitTiming => {
    if (deltaMs < 0) return "early";
    if (deltaMs > 0) return "late";
    return "on";
  };

  const scoreFor = (deltaMs: number): { result: HitResult; points: number } => {
    const d = Math.abs(deltaMs);
    if (d <= TIER3_MS) return { result: "tier3", points: TIER3_POINTS };
    if (d <= TIER2_MS) return { result: "tier2", points: TIER2_POINTS };
    if (d <= TIER1_MS) return { result: "tier1", points: TIER1_POINTS };
    return { result: "miss", points: 0 };
  };

  const tryHit = (note: Note, songMs: number): void => {
    if (note.state !== "pending") return;

    const segment = latestPointerSegment();
    if (!segment) return;
    const { prev, curr } = segment;
    const moveDx = curr.x - prev.x;
    const moveDy = curr.y - prev.y;
    const lenSq  = moveDx * moveDx + moveDy * moveDy;
    if (lenSq < 0.5) return;

    let impactSongMs: number;

    if (note.kind === "lyric") {
      const t = clamp(
        ((note.x - prev.x) * moveDx + (note.y - prev.y) * moveDy) / lenSq,
        0, 1,
      );
      const closestX = prev.x + t * moveDx;
      const closestY = prev.y + t * moveDy;
      if ((closestX - note.x) ** 2 + (closestY - note.y) ** 2 > LYRIC_RADIUS * LYRIC_RADIUS) return;
      impactSongMs = interpolateSongMs(prev, curr, t);
    } else {
      if (NOTE_STYLE[note.kind].requiresHold && !actionHeld()) return;
      const dx = Math.cos(note.direction);
      const dy = Math.sin(note.direction);
      const pPrev = (prev.x - note.x) * dx + (prev.y - note.y) * dy;
      const pCurr = (curr.x - note.x) * dx + (curr.y - note.y) * dy;
      if (pPrev >= 0 || pCurr < 0) return;
      const perpPrev = -(prev.x - note.x) * dy + (prev.y - note.y) * dx;
      const perpCurr = -(curr.x - note.x) * dy + (curr.y - note.y) * dx;
      const t = -pPrev / (pCurr - pPrev);
      const perpAtCross = perpPrev + (perpCurr - perpPrev) * t;
      if (Math.abs(perpAtCross) > NOTE_RADIUS) return;
      const moveAngle = Math.atan2(moveDy, moveDx);
      if (Math.abs(angleDiff(moveAngle, note.direction)) > ANGULAR_MARGIN) return;
      impactSongMs = interpolateSongMs(prev, curr, t);
    }

    const offsetMs = impactSongMs - note.time;
    if (Math.abs(offsetMs) > TIER1_MS) return;
    const { result, points } = scoreFor(offsetMs);
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
      timing: timingFor(offsetMs),
      x: note.x,
      y: note.y,
    });
    onFeedback(result, note.x, note.y);
    playHitSound();
  };

  const expireMisses = (songMs: number): void => {
    // Notes are time-sorted: break as soon as a pending note is within the hit window
    for (let i = pendingStart; i < notes.length; i++) {
      const n = notes[i];
      if (n.state !== "pending") continue;
      if (songMs - n.time <= TIER1_MS) break;
      n.state = "missed";
      n.hitResult = "miss";
      missCount++;
      comboCount = 0;
      onComboChange(0);
      hitDetails.push({
        result: "miss",
        kind: n.kind,
        offsetMs: songMs - n.time,
        timing: "late",
        x: n.x,
        y: n.y,
        missReason: "timing",
      });
      onFeedback("miss", n.x, n.y);
    }
  };

  const draw = (songMs: number): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = getScale();
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
      window.removeEventListener("mouseup",    onMouseUp);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend",   onTouchEnd);
      window.removeEventListener("keydown",    onKeyDown);
      window.removeEventListener("keyup",      onKeyUp);
      window.removeEventListener("resize",     resize);
      cursor.destroy();
      unsubHitsound();
      unsubHiddenMod();
      audioLoadCleanup?.();
    },
  };
}
