import { useState, useEffect } from "react";
import {
  loadAr, saveAr, subscribeAr,
  loadVolume, saveVolume, subscribeVolume,
  loadHitsoundVolume, saveHitsoundVolume, subscribeHitsoundVolume,
  loadUiVolume, saveUiVolume, subscribeUiVolume,
  loadHiddenMod, saveHiddenMod, subscribeHiddenMod,
  loadCursorSize, saveCursorSize, subscribeCursorSize,
  loadCursorR, saveCursorR, subscribeCursorR,
  loadCursorG, saveCursorG, subscribeCursorG,
  loadCursorB, saveCursorB, subscribeCursorB,
  loadTrailFadeSpeed, saveTrailFadeSpeed, subscribeTrailFadeSpeed,
  loadTrailShape, saveTrailShape, subscribeTrailShape,
  loadTrailDecay, saveTrailDecay, subscribeTrailDecay,
  loadMusicOffset, saveMusicOffset, subscribeMusicOffset,
  type TrailShape, type TrailDecay,
} from "../../core/settings";

function useNumericSetting(
  load: () => number,
  save: (v: number) => void,
  subscribe: (cb: (v: number) => void) => () => void,
): [number, (v: number) => void] {
  const [value, setValue] = useState(load);
  useEffect(() => subscribe(setValue), [subscribe]);
  return [value, save];
}

export function useApproachRate(): [number, (ar: number) => void] {
  return useNumericSetting(loadAr, saveAr, subscribeAr);
}

export function useVolume(): [number, (v: number) => void] {
  return useNumericSetting(loadVolume, saveVolume, subscribeVolume);
}

export function useHitsoundVolume(): [number, (v: number) => void] {
  return useNumericSetting(loadHitsoundVolume, saveHitsoundVolume, subscribeHitsoundVolume);
}

export function useUiVolume(): [number, (v: number) => void] {
  return useNumericSetting(loadUiVolume, saveUiVolume, subscribeUiVolume);
}

export function useHiddenMod(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(loadHiddenMod);
  useEffect(() => subscribeHiddenMod(setValue), []);
  return [value, saveHiddenMod];
}

export function useCursorSize(): [number, (v: number) => void] {
  return useNumericSetting(loadCursorSize, saveCursorSize, subscribeCursorSize);
}

export function useCursorR(): [number, (v: number) => void] {
  return useNumericSetting(loadCursorR, saveCursorR, subscribeCursorR);
}

export function useCursorG(): [number, (v: number) => void] {
  return useNumericSetting(loadCursorG, saveCursorG, subscribeCursorG);
}

export function useCursorB(): [number, (v: number) => void] {
  return useNumericSetting(loadCursorB, saveCursorB, subscribeCursorB);
}

export function useTrailFadeSpeed(): [number, (v: number) => void] {
  return useNumericSetting(loadTrailFadeSpeed, saveTrailFadeSpeed, subscribeTrailFadeSpeed);
}

export function useMusicOffset(): [number, (v: number) => void] {
  return useNumericSetting(loadMusicOffset, saveMusicOffset, subscribeMusicOffset);
}

function useStringSetting<T>(
  load: () => T,
  save: (v: T) => void,
  subscribe: (cb: (v: T) => void) => () => void,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(load);
  useEffect(() => subscribe(setValue), [subscribe]);
  return [value, save];
}

export function useTrailShape(): [TrailShape, (v: TrailShape) => void] {
  return useStringSetting(loadTrailShape, saveTrailShape, subscribeTrailShape);
}

export function useTrailDecay(): [TrailDecay, (v: TrailDecay) => void] {
  return useStringSetting(loadTrailDecay, saveTrailDecay, subscribeTrailDecay);
}