import { angleDiff, clamp } from "../core/utils";
import { drawArrow, drawLyricNote, drawFireworks, NOTE_RADIUS, LYRIC_RADIUS, NOTE_STYLE } from "./draw";
import { arToMs, loadAr, loadHitsoundVolume, subscribeHitsoundVolume, volToFactor, loadHiddenMod, subscribeHiddenMod } from "../core/settings";
import { createCursorRenderer, type CursorRenderer } from "./cursor";

const PERFECT_MS             = 32;
const GOOD_MS                = 100;
const LYRIC_CHAR_MAX_DIST_MS = 80;
export const PERFECT_POINTS  = 5;
export const GOOD_POINTS     = 2;

export const LOGICAL_W = 800;
export const LOGICAL_H = 600;

const ANGULAR_MARGIN = Math.PI / 6;

type NoteKind          = "flick" | "stream" | "lyric";
export type HitResult  = "perfect" | "good" | "miss";
type NoteState         = "pending" | "hit" | "missed";

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

interface HitAnimation {
  x: number;
  y: number;
  kind: NoteKind;
  startMs: number;
  seed: number;
}

export interface GameStats {
  score: number;
  perfect: number;
  good: number;
  miss: number;
  total: number;
  combo: number;
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
  let clickedThisFrame = false;
  const keysHeld = new Set<string>();
  const actionHeld = (): boolean => pointer.held || keysHeld.size > 0;

  const setPointer = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (clientX - rect.left) * (LOGICAL_W / rect.width);
    pointer.y = (clientY - rect.top)  * (LOGICAL_H / rect.height);
  };

  const onMouseMove  = (e: MouseEvent): void => setPointer(e.clientX, e.clientY);
  const onMouseDown  = (e: MouseEvent): void => { setPointer(e.clientX, e.clientY); pointer.held = true; clickedThisFrame = true; };
  const onMouseUp    = (): void => { pointer.held = false; };
  const onTouchMove  = (e: TouchEvent): void => {
    const t = e.touches[0]; if (t) setPointer(t.clientX, t.clientY); e.preventDefault();
  };
  const onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0]; if (t) { setPointer(t.clientX, t.clientY); pointer.held = true; clickedThisFrame = true; } e.preventDefault();
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
  let perfectCount = 0;
  let goodCount = 0;
  let missCount = 0;
  let comboCount = 0;

  let lyricCharLookup: ((timeMs: number) => { text: string; distMs: number } | null) | null = null;

  // After reset(), skip expiry until the song confirms it has rewound to the lead-in window,
  // preventing stale mid-song positions from triggering immediate misses.
  let skipExpiry = false;

  const setScore = (v: number): void => { score = v; onScore(v); };

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

  const scoreFor = (deltaMs: number): { result: HitResult; points: number } => {
    const d = Math.abs(deltaMs);
    if (d <= PERFECT_MS) return { result: "perfect", points: PERFECT_POINTS };
    if (d <= GOOD_MS)    return { result: "good",    points: GOOD_POINTS    };
    return { result: "miss", points: 0 };
  };

  const tryHit = (note: Note, songMs: number): void => {
    if (note.state !== "pending") return;
    if (Math.abs(songMs - note.time) > GOOD_MS) return;

    if (note.kind === "lyric") {
      if (!clickedThisFrame) return;
      if ((pointer.x - note.x) ** 2 + (pointer.y - note.y) ** 2 > LYRIC_RADIUS * LYRIC_RADIUS) return;
    } else {
      if (NOTE_STYLE[note.kind].requiresHold && !actionHeld()) return;
      const dx = Math.cos(note.direction);
      const dy = Math.sin(note.direction);
      const pPrev = (pointer.prevX - note.x) * dx + (pointer.prevY - note.y) * dy;
      const pCurr = (pointer.x     - note.x) * dx + (pointer.y     - note.y) * dy;
      if (pPrev >= 0 || pCurr < 0) return;
      const perpPrev = -(pointer.prevX - note.x) * dy + (pointer.prevY - note.y) * dx;
      const perpCurr = -(pointer.x     - note.x) * dy + (pointer.y     - note.y) * dx;
      const t = -pPrev / (pCurr - pPrev);
      const perpAtCross = perpPrev + (perpCurr - perpPrev) * t;
      if (Math.abs(perpAtCross) > NOTE_RADIUS) return;
      const moveDx = pointer.x - pointer.prevX;
      const moveDy = pointer.y - pointer.prevY;
      if (moveDx * moveDx + moveDy * moveDy < 0.5) return;
      const moveAngle = Math.atan2(moveDy, moveDx);
      if (Math.abs(angleDiff(moveAngle, note.direction)) > ANGULAR_MARGIN) return;
    }

    const { result, points } = scoreFor(songMs - note.time);
    note.state = "hit";
    note.hitResult = result;
    if (result === "perfect") perfectCount++;
    else if (result === "good") goodCount++;
    if (points > 0) {
      setScore(score + points);
      comboCount++;
      onComboChange(comboCount);
      animations.push({
        x: note.x, y: note.y, kind: note.kind, startMs: songMs,
        seed: Math.floor(note.x * 7919 + note.y * 6271),
      });
    }
    onFeedback(result, note.x, note.y);
    playHitSound();
  };

  const expireMisses = (songMs: number): void => {
    // Notes are time-sorted: break as soon as a pending note is within the hit window
    for (let i = pendingStart; i < notes.length; i++) {
      const n = notes[i];
      if (n.state !== "pending") continue;
      if (songMs - n.time <= GOOD_MS) break;
      n.state = "missed";
      n.hitResult = "miss";
      missCount++;
      comboCount = 0;
      onComboChange(0);
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
      if (dt < -GOOD_MS) continue;
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
      perfectCount = 0;
      goodCount    = 0;
      missCount    = 0;
      comboCount   = 0;
      onComboChange(0);
      onPlayingChange(false);
    },

    start(): void {
      onPlayingChange(true);
    },

    getStats(): GameStats {
      return {
        score,
        perfect: perfectCount,
        good:    goodCount,
        miss:    missCount,
        total:   perfectCount + goodCount + missCount,
        combo:   comboCount,
      };
    },

    setApproachMs(ms: number): void {
      approachMs = ms;
    },

    tick(songMs: number): void {
      // Only check notes within the hit window; notes are time-sorted so break early
      for (let i = pendingStart; i < notes.length; i++) {
        const n = notes[i];
        if (n.time > songMs + GOOD_MS) break;
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
      clickedThisFrame = false;
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
