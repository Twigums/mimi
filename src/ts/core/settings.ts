function loadNumericSetting(key: string, clamp: (n: number) => number, def: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return def;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clamp(parsed) : def;
}

function saveNumericSetting(key: string, event: string, clamp: (n: number) => number, value: number): void {
  const clamped = clamp(value);
  localStorage.setItem(key, String(clamped));
  window.dispatchEvent(new CustomEvent<number>(event, { detail: clamped }));
}

function subscribeNumericSetting(event: string, cb: (n: number) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<number>).detail);
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}

function createNumericSetting(key: string, event: string, clamp: (n: number) => number, def: number) {
  return {
    load: () => loadNumericSetting(key, clamp, def),
    save: (v: number) => saveNumericSetting(key, event, clamp, v),
    subscribe: (cb: (n: number) => void) => subscribeNumericSetting(event, cb),
  };
}

function loadBoolSetting(key: string, def: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return def;
  return raw === "true";
}

function saveBoolSetting(key: string, event: string, value: boolean): void {
  localStorage.setItem(key, String(value));
  window.dispatchEvent(new CustomEvent<boolean>(event, { detail: value }));
}

function subscribeBoolSetting(event: string, cb: (v: boolean) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}

export const AR_MIN     = 1;
export const AR_MAX     = 20;
const AR_DEFAULT = 10;

// [1, 10] → 2000ms–1000ms; (10, 20] → 1000ms–300ms
export function arToMs(ar: number): number {
  if (ar <= 10) {
    return 2000 - (ar - 1) * (1000 / 9);
  }
  return 1000 - (ar - 10) * (700 / 10);
}

function clampAr(n: number): number {
  return Math.max(AR_MIN, Math.min(AR_MAX, Math.round(n)));
}

const arSetting = createNumericSetting("approachRate", "approachRateChange", clampAr, AR_DEFAULT);
export const loadAr        = arSetting.load;
export const saveAr        = arSetting.save;
export const subscribeAr   = arSetting.subscribe;

export const VOLUME_MIN     = 0;
export const VOLUME_MAX     = 100;
const VOLUME_DEFAULT = 100;
export const VOLUME_STEP    = 1;

function clampVolume(n: number): number {
  return Math.max(VOLUME_MIN, Math.min(VOLUME_MAX, Math.round(n)));
}

export function volToFactor(v: number): number { return clampVolume(v) / VOLUME_MAX; }

const volSetting = createNumericSetting("songVolume", "songVolumeChange", clampVolume, VOLUME_DEFAULT);
export const loadVolume      = volSetting.load;
export const saveVolume      = volSetting.save;
export const subscribeVolume = volSetting.subscribe;

const hitsoundSetting = createNumericSetting("hitsoundVolume", "hitsoundVolumeChange", clampVolume, VOLUME_DEFAULT);
export const loadHitsoundVolume      = hitsoundSetting.load;
export const saveHitsoundVolume      = hitsoundSetting.save;
export const subscribeHitsoundVolume = hitsoundSetting.subscribe;

export const loadHiddenMod      = (): boolean => loadBoolSetting("modHidden", false);
export const saveHiddenMod      = (v: boolean): void => saveBoolSetting("modHidden", "modHiddenChange", v);
export const subscribeHiddenMod = (cb: (v: boolean) => void): (() => void) => subscribeBoolSetting("modHiddenChange", cb);

export const CURSOR_SIZE_MIN = 4;
export const CURSOR_SIZE_MAX = 20;
const CURSOR_SIZE_DEFAULT    = 8;
export const TRAIL_FADE_MIN  = 1;
export const TRAIL_FADE_MAX  = 10;
const TRAIL_FADE_DEFAULT     = 5;

function clampCursorSize(n: number): number {
  return Math.max(CURSOR_SIZE_MIN, Math.min(CURSOR_SIZE_MAX, Math.round(n)));
}

function clampTrailFade(n: number): number {
  return Math.max(TRAIL_FADE_MIN, Math.min(TRAIL_FADE_MAX, Math.round(n)));
}

function clampRgb(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

const cursorSizeSetting = createNumericSetting("cursorSize", "cursorSizeChange", clampCursorSize, CURSOR_SIZE_DEFAULT);
export const loadCursorSize      = cursorSizeSetting.load;
export const saveCursorSize      = cursorSizeSetting.save;
export const subscribeCursorSize = cursorSizeSetting.subscribe;

const trailFadeSetting = createNumericSetting("trailFadeSpeed", "trailFadeSpeedChange", clampTrailFade, TRAIL_FADE_DEFAULT);
export const loadTrailFadeSpeed      = trailFadeSetting.load;
export const saveTrailFadeSpeed      = trailFadeSetting.save;
export const subscribeTrailFadeSpeed = trailFadeSetting.subscribe;

// 1 = longest trail (1200ms), 10 = no trail (0ms)
const TRAIL_MAX_LIFETIME_MS = 1200;
export function trailFadeToLifetimeMs(fadeSpeed: number): number {
  return Math.max(0, (TRAIL_FADE_MAX - fadeSpeed) * (TRAIL_MAX_LIFETIME_MS / (TRAIL_FADE_MAX - TRAIL_FADE_MIN)));
}

// Default: cyan (0, 255, 255)
const cursorRSetting = createNumericSetting("cursorR", "cursorRChange", clampRgb, 0);
export const loadCursorR      = cursorRSetting.load;
export const saveCursorR      = cursorRSetting.save;
export const subscribeCursorR = cursorRSetting.subscribe;

const cursorGSetting = createNumericSetting("cursorG", "cursorGChange", clampRgb, 255);
export const loadCursorG      = cursorGSetting.load;
export const saveCursorG      = cursorGSetting.save;
export const subscribeCursorG = cursorGSetting.subscribe;

const cursorBSetting = createNumericSetting("cursorB", "cursorBChange", clampRgb, 255);
export const loadCursorB      = cursorBSetting.load;
export const saveCursorB      = cursorBSetting.save;
export const subscribeCursorB = cursorBSetting.subscribe;

export const OFFSET_MIN  = -5000;
export const OFFSET_MAX  =  5000;
export const OFFSET_STEP =    10;
export const TIMING_OFFSET_MIN = -200;
export const TIMING_OFFSET_MAX =  200;

function clampOffset(n: number): number {
  return Math.max(OFFSET_MIN, Math.min(OFFSET_MAX, Math.round(n / OFFSET_STEP) * OFFSET_STEP));
}

const musicOffsetSetting = createNumericSetting("musicOffset", "musicOffsetChange", clampOffset, 0);
export const loadMusicOffset      = musicOffsetSetting.load;
export const saveMusicOffset      = musicOffsetSetting.save;
export const subscribeMusicOffset = musicOffsetSetting.subscribe;

export type TrailShape = "circle" | "star" | "square";
export type TrailDecay = "fade" | "scatter";

const TRAIL_SHAPES: readonly TrailShape[] = ["circle", "star", "square"];
const TRAIL_DECAYS: readonly TrailDecay[] = ["fade", "scatter"];

function loadStringSetting<T extends string>(key: string, valid: readonly T[], def: T): T {
  const raw = localStorage.getItem(key);
  if (raw !== null && (valid as readonly string[]).includes(raw)) return raw as T;
  return def;
}

function saveStringSetting<T extends string>(key: string, event: string, value: T): void {
  localStorage.setItem(key, value);
  window.dispatchEvent(new CustomEvent<T>(event, { detail: value }));
}

function subscribeStringSetting<T>(event: string, cb: (v: T) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<T>).detail);
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}

export const loadTrailShape      = (): TrailShape => loadStringSetting("trailShape", TRAIL_SHAPES, "circle");
export const saveTrailShape      = (v: TrailShape): void => saveStringSetting("trailShape", "trailShapeChange", v);
export const subscribeTrailShape = (cb: (v: TrailShape) => void): (() => void) => subscribeStringSetting<TrailShape>("trailShapeChange", cb);

export const loadTrailDecay      = (): TrailDecay => loadStringSetting("trailDecay", TRAIL_DECAYS, "fade");
export const saveTrailDecay      = (v: TrailDecay): void => saveStringSetting("trailDecay", "trailDecayChange", v);
export const subscribeTrailDecay = (cb: (v: TrailDecay) => void): (() => void) => subscribeStringSetting<TrailDecay>("trailDecayChange", cb);

// Restore every persisted setting to its default; each save dispatches its
// change event, so subscribed renderers (engine, cursor, options hooks) update.
export function resetSettings(): void {
  saveAr(AR_DEFAULT);
  saveVolume(VOLUME_DEFAULT);
  saveHitsoundVolume(VOLUME_DEFAULT);
  saveHiddenMod(false);
  saveCursorSize(CURSOR_SIZE_DEFAULT);
  saveTrailFadeSpeed(TRAIL_FADE_DEFAULT);
  saveCursorR(0);
  saveCursorG(255);
  saveCursorB(255);
  saveMusicOffset(0);
  saveTrailShape("circle");
  saveTrailDecay("fade");
}
