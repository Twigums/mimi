import { clamp } from "../core/utils";

// Lyric notes are held targets, drawn as a larger circle than the old brush dot.
export const LYRIC_RADIUS = 48;

export const LYRIC_FUNNEL_BLEND_MS = 180;

/** Approach disc fill begins at this appearProgress (mirrors cut notes). */
export const LYRIC_APPROACH_FILL_START = 0.62;
/** Logical px the aura gradient extends past the visible disc edge. */
export const LYRIC_AURA_EXTEND_PX = 25;
/** Ms after hit time to ease the approach wash into hold greyscale. */
export const LYRIC_HOLD_GREY_SETTLE_MS = 0;
/** Hold window tail when the aura shifts greyscale → blue to cue release. */
export const LYRIC_RELEASE_CUE_MS = 500;
/** Ms at hold end for the release burst swell (inside the release-cue window). */
export const LYRIC_END_BURST_MS = 110;
/** Max blue tint reached by gradual hold fade (release cue spikes to full). */
export const LYRIC_HOLD_BLUE_CAP = 0.55;
/** Ms to decay the approach swell into sustain scale after hit. */
export const LYRIC_APPROACH_PULSE_DECAY_MS = 160;
/** Scale the disc eases down to over the main hold body (before release cue). */
export const LYRIC_HOLD_SUSTAIN_SHRINK = 0.94;
/** Minimum disc scale during the pre-burst release-cue shrink. */
export const LYRIC_PRE_RELEASE_SHRINK = 0.88;
/** Peak scale at the hold end burst. */
export const LYRIC_END_BURST_PEAK = 1.17;
/** Dashed inner bound as a fraction of LYRIC_RADIUS (matches glyph layout). */
export const LYRIC_BOUND_RATIO = 0.62;
/** Solid outer ring, slightly larger than the dashed bound. */
export const LYRIC_SOLID_RING_RATIO = 0.72;
/** Logical px inset from the right edge for the TestPlay demo funnel origin. */
export const LYRIC_FUNNEL_ORIGIN_INSET = 8;

export function lyricDemoFunnelOrigin(logicalW: number, logicalH: number): { x: number; y: number } {
  return { x: logicalW - LYRIC_FUNNEL_ORIGIN_INSET, y: logicalH / 4 };
}

/** Vertical nudge for storyboard funnel landing only (em of font size; positive = down). */
export const LYRIC_FUNNEL_DEST_Y_OFFSET_EM = -0.05;

/** Vertical nudge for the canvas lyric glyph (em of font size; positive = down). */
export const LYRIC_GLYPH_Y_OFFSET_EM = 0.05;

export function lyricGlyphOffsetYPx(fontPx: number): number {
  return LYRIC_GLYPH_Y_OFFSET_EM * fontPx;
}

/** Canvas-pixel offset for the storyboard funnel destination (song gameplay only). */
export function lyricFunnelDestOffsetYPx(fontPx: number, gameplay: boolean): number {
  return gameplay ? LYRIC_FUNNEL_DEST_Y_OFFSET_EM * fontPx : 0;
}

export function lyricFunnelStep(charCount: number, approachMs: number): number {
  return Math.min(140, approachMs / (charCount + 1));
}

export function lyricCharLandTime(
  noteTime: number,
  charIndex: number,
  charCount: number,
  approachMs: number,
): number {
  const step = lyricFunnelStep(charCount, approachMs);
  return noteTime - (charCount - 1 - charIndex) * step;
}

function lyricHoldSmoothstep(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

/** Sustain scale: breathe while held, ease-in shrink through release cue, burst at hold end. */
export function lyricHoldScale(
  holdMs: number,
  songMs: number,
  noteTime: number,
  holding: boolean,
): number {
  if (holdMs <= 0) return 1;
  const elapsed = songMs - noteTime;
  if (elapsed < 0) return 1;

  const remaining = holdMs - elapsed;
  const sustainBodyMs = Math.max(0, holdMs - LYRIC_RELEASE_CUE_MS);
  let phase = 1;

  if (remaining <= LYRIC_END_BURST_MS) {
    const t = lyricHoldSmoothstep(1 - remaining / LYRIC_END_BURST_MS);
    phase = LYRIC_PRE_RELEASE_SHRINK + (LYRIC_END_BURST_PEAK - LYRIC_PRE_RELEASE_SHRINK) * t;
  } else if (remaining < LYRIC_RELEASE_CUE_MS) {
    const shrinkSpan = LYRIC_RELEASE_CUE_MS - LYRIC_END_BURST_MS;
    const t = clamp(1 - (remaining - LYRIC_END_BURST_MS) / shrinkSpan, 0, 1);
    phase = LYRIC_HOLD_SUSTAIN_SHRINK
      - (LYRIC_HOLD_SUSTAIN_SHRINK - LYRIC_PRE_RELEASE_SHRINK) * (t * t);
  } else if (sustainBodyMs > 0) {
    const t = lyricHoldSmoothstep(Math.min(elapsed, sustainBodyMs) / sustainBodyMs);
    phase = 1 - (1 - LYRIC_HOLD_SUSTAIN_SHRINK) * t;
  }

  if (!holding) return phase;
  const animate = typeof window === "undefined"
    || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!animate) return phase;
  return phase * (1 + 0.035 * Math.sin(songMs * 0.014));
}

/** Approach swell decays into sustain scale so hit-time size carries through seamlessly. */
export function lyricVisualScale(
  holdMs: number,
  songMs: number,
  noteTime: number,
  holding: boolean,
  approachPulse: number,
): number {
  const elapsed = songMs - noteTime;
  if (elapsed < 0) return approachPulse;
  const holdScale = lyricHoldScale(holdMs, songMs, noteTime, holding);
  const decay = clamp(1 - elapsed / LYRIC_APPROACH_PULSE_DECAY_MS, 0, 1);
  return holdScale + (approachPulse - 1) * decay;
}

/** Blue builds through the hold, then spikes to full intensity in the release cue. */
export function lyricHoldBlueBlend(holdProgress: number, remainingMs: number, holdMs: number): number {
  if (holdMs <= 0 || holdProgress <= 0) return 0;
  const holdBlue = lyricHoldSmoothstep(holdProgress) * LYRIC_HOLD_BLUE_CAP;
  if (remainingMs >= LYRIC_RELEASE_CUE_MS) return holdBlue;
  const releaseT = (1 - remainingMs / LYRIC_RELEASE_CUE_MS) ** 2;
  return holdBlue + releaseT * (1 - holdBlue);
}

export function lyricFillProgress(
  text: string,
  noteTime: number,
  songMs: number,
  approachMs: number,
): number {
  const chars = [...text];
  if (chars.length === 0) return 0;
  let progress = 0;
  for (let i = 0; i < chars.length; i++) {
    const land = lyricCharLandTime(noteTime, i, chars.length, approachMs);
    progress = Math.max(progress, Math.min(1, (songMs - land) / LYRIC_FUNNEL_BLEND_MS));
  }
  return progress;
}

export interface LyricGlyphLayout {
  fontPx: number;
  /** Per-character horizontal offset from the note centre, in canvas pixels. */
  charOffsets: number[];
}

let measureCtx: CanvasRenderingContext2D | null = null;

const measureCtx_ = (): CanvasRenderingContext2D => {
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d")!;
  }
  return measureCtx;
};

export function layoutLyricGlyphs(text: string, scale: number, pulse = 1): LyricGlyphLayout {
  const chars = [...text];
  if (chars.length === 0) return { fontPx: 0, charOffsets: [] };

  const ctx = measureCtx_();
  const r = LYRIC_RADIUS * scale * pulse;
  const dotR = r * LYRIC_BOUND_RATIO;
  let fontPx = r * 0.9 * Math.min(1, 1.4 / chars.length);
  let font = `bold ${fontPx.toFixed(1)}px sans-serif`;

  const measureWidths = (size: number): number[] => {
    font = `bold ${size.toFixed(1)}px sans-serif`;
    ctx.font = font;
    return chars.map(ch => ctx.measureText(ch).width);
  };

  let widths = measureWidths(fontPx);
  const total = widths.reduce((a, b) => a + b, 0);
  const maxWidth = dotR * 1.9;
  if (total > maxWidth) fontPx *= maxWidth / total;

  widths = measureWidths(fontPx);
  const total2 = widths.reduce((a, b) => a + b, 0);
  let x = -total2 / 2;
  const charOffsets: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    charOffsets.push(x + widths[i] / 2);
    x += widths[i];
  }
  return { fontPx, charOffsets };
}
