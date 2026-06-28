// Lyric notes are held targets, drawn as a larger circle than the old brush dot.
export const LYRIC_RADIUS = 48;

export const LYRIC_FUNNEL_BLEND_MS = 180;

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
  const dotR = r * 0.62;
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
