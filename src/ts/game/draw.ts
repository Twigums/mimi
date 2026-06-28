import type { Note } from "./engine";
import type { TrailShape } from "../core/settings";
import { withPath } from "../core/sitePath";
import { LYRIC_HOLD_RADIUS } from "./judgement";
import {
  layoutLyricGlyphs,
  LYRIC_APPROACH_FILL_START,
  LYRIC_FUNNEL_BLEND_MS,
  LYRIC_RADIUS,
  LYRIC_ZONE_GHOST_ALPHA,
  lyricCharLandTime,
  lyricFunnelDestOffsetYPx,
} from "./lyricLayout";

export { LYRIC_RADIUS };

export const NOTE_RADIUS  = 52;

// Notes give a brief size swell centered on their hit time as a timing cue.
const PULSE_WINDOW_MS = 110;
const PULSE_AMOUNT    = 0.14;

// Size multiplier for a note `dt` ms from its hit time (dt = note.time - songMs):
// peaks at (1 + PULSE_AMOUNT) when dt = 0 and eases back to 1 outside the window.
export function notePulseScale(dt: number): number {
  const t = 1 - Math.min(Math.abs(dt), PULSE_WINDOW_MS) / PULSE_WINDOW_MS;
  // Smoothstep for a soft swell rather than a linear spike.
  const eased = t * t * (3 - 2 * t);
  return 1 + PULSE_AMOUNT * eased;
}

interface NoteColors {
  base: string;
  darkBase: string;
}

interface NoteStyle {
  colors: NoteColors;
}

const CUT_STYLE: NoteStyle   = { colors: { base: "255, 82, 82",   darkBase: "191, 62, 62"   } };
const FLOW_STYLE: NoteStyle  = { colors: { base: "82, 162, 255",  darkBase: "62, 122, 191"  } };
const LYRIC_STYLE: NoteStyle = { colors: { base: "255, 255, 255", darkBase: "200, 200, 200" } };

export const NOTE_STYLE: Record<string, NoteStyle> = {
  cut:    CUT_STYLE,
  click:  CUT_STYLE,
  flick:  CUT_STYLE,
  flow:   FLOW_STYLE,
  stream: FLOW_STYLE,
  lyric:  LYRIC_STYLE,
};

interface ArrowGlyph {
  viewBoxW: number;
  viewBoxH: number;
  path: Path2D;
}

const ARROW_SRC = "/images/arrow.svg";

let arrowGlyph: ArrowGlyph | null = null;
let arrowGlyphLoad: Promise<void> | null = null;
let arrowGlyphWarningShown = false;

function parseNumbers(raw: string): number[] {
  return raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

function matrixFromTransform(transform: string): DOMMatrix {
  const matrix = new DOMMatrix();
  const commands = transform.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g);

  for (const [, rawName, rawArgs] of commands) {
    const name = rawName.toLowerCase();
    const args = parseNumbers(rawArgs);

    switch (name) {
      case "matrix":
        if (args.length >= 6) matrix.multiplySelf(new DOMMatrix(args.slice(0, 6)));
        break;
      case "translate":
        if (args.length >= 1) matrix.translateSelf(args[0], args[1] ?? 0);
        break;
      case "scale":
        if (args.length >= 1) matrix.scaleSelf(args[0], args[1] ?? args[0]);
        break;
      case "rotate":
        if (args.length >= 3) {
          matrix.translateSelf(args[1], args[2]).rotateSelf(args[0]).translateSelf(-args[1], -args[2]);
        } else if (args.length >= 1) {
          matrix.rotateSelf(args[0]);
        }
        break;
      case "skewx":
        if (args.length >= 1) {
          const skew = new DOMMatrix();
          skew.c = Math.tan((args[0] * Math.PI) / 180);
          matrix.multiplySelf(skew);
        }
        break;
      case "skewy":
        if (args.length >= 1) {
          const skew = new DOMMatrix();
          skew.b = Math.tan((args[0] * Math.PI) / 180);
          matrix.multiplySelf(skew);
        }
        break;
    }
  }

  return matrix;
}

function elementTransformMatrix(pathEl: SVGPathElement, svg: SVGSVGElement): DOMMatrix {
  const transforms: string[] = [];
  let el: Element | null = pathEl;

  while (el) {
    const transform = el.getAttribute("transform");
    if (transform) transforms.push(transform);
    if (el === svg) break;
    el = el.parentElement;
  }

  const matrix = new DOMMatrix();
  for (const transform of transforms.reverse()) {
    matrix.multiplySelf(matrixFromTransform(transform));
  }
  return matrix;
}

function parseArrowSvg(text: string): ArrowGlyph | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.tagName.toLowerCase() !== "svg") return null;

  const [minX = 0, minY = 0, viewBoxW, viewBoxH] = parseNumbers(svg.getAttribute("viewBox") ?? "");
  if (!viewBoxW || !viewBoxH) return null;

  const pathEl = svg.querySelector<SVGPathElement>("path#path7, path");
  const pathData = pathEl?.getAttribute("d");
  if (!pathEl || !pathData) return null;

  const path = new Path2D();
  const matrix = new DOMMatrix()
    .translateSelf(-minX, -minY)
    .multiplySelf(elementTransformMatrix(pathEl, svg));
  path.addPath(new Path2D(pathData), matrix);

  return { viewBoxW, viewBoxH, path };
}

function ensureArrowGlyph(): void {
  if (arrowGlyph || arrowGlyphLoad) return;
  if (typeof document === "undefined" || typeof fetch === "undefined" || typeof Path2D === "undefined") return;

  arrowGlyphLoad = fetch(withPath(ARROW_SRC))
    .then(res => res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`)))
    .then(text => {
      const glyph = parseArrowSvg(text);
      if (!glyph) throw new Error("invalid arrow SVG");
      arrowGlyph = glyph;
    })
    .catch(err => {
      console.error("[mimi] arrow SVG load failed:", err);
    });
}

ensureArrowGlyph();

// appearProgress: 0 = faint outline just appearing, 1 = fully filled at hit time
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  note: Note,
  appearProgress: number,
  scale: number,
  hidden = false,
  pulse = 1,
): void {
  const cx = note.x * scale;
  const cy = note.y * scale;
  const r  = NOTE_RADIUS * scale * pulse;

  if (!note.kind) {
    console.error("[mimi] drawArrow: note has no kind", { note, appearProgress });
    return;
  }

  const style = NOTE_STYLE[note.kind];
  if (!style) {
    console.error("[mimi] drawArrow: unknown note kind", { kind: note.kind, note });
    return;
  }

  const { base, darkBase } = style.colors;

  const OUTLINE_SNAP = 0.12;
  const FILL_START   = 0.62;
  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);
  const fillProgress = Math.max(0, (appearProgress - FILL_START) / (1 - FILL_START));

  ensureArrowGlyph();
  if (!arrowGlyph) {
    if (!arrowGlyphWarningShown) {
      arrowGlyphWarningShown = true;
      console.warn("[mimi] arrow glyph is not ready; skipping arrow draw until the SVG loads");
    }
    return;
  }

  const s = r / arrowGlyph.viewBoxW;
  const matrix = new DOMMatrix()
    .translateSelf(cx, cy)
    .rotateSelf((note.direction * 180) / Math.PI)
    .scaleSelf(s)
    .translateSelf(-arrowGlyph.viewBoxW / 2, -arrowGlyph.viewBoxH / 2);
  const path = new Path2D();
  path.addPath(arrowGlyph.path, matrix);

  if (!hidden) {
    ctx.save();
    ctx.clip(path);
    const fillMaxR = (Math.hypot(arrowGlyph.viewBoxW, arrowGlyph.viewBoxH) / 2) * s;
    ctx.beginPath();
    ctx.arc(cx, cy, fillProgress * fillMaxR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base}, 1.0)`;
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = `rgba(${darkBase}, ${0.9 * outlineAlpha})`;
  ctx.lineWidth = 2.5 * scale;
  ctx.lineJoin  = "round";
  ctx.stroke(path);
  ctx.restore();
}

const LYRIC_TEAL = "57, 197, 187";
const LYRIC_HOLD_RELEASE_START = 0.88;
const LYRIC_HOLD_HALO_SHRINK = 0.14;

function lyricReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// appearProgress: 0 = faint outline just appearing, 1 = fully visible at hit time
// hidden: suppresses the lyric char (disc/halo remain)
// holdProgress: 0..1 fraction of the hold elapsed (drives sustain halo)
// holding: whether the cursor is currently inside the hold radius
// fillProgress: 0 = hollow stroke only; 1 = funnel landed and the note glyph is filled
// songMs: clock time for a subtle sustain breath pulse while holding
export function drawLyricNote(
  ctx: CanvasRenderingContext2D,
  note: Note,
  appearProgress: number,
  scale: number,
  hidden = false,
  holdProgress = 0,
  holding = false,
  pulse = 1,
  fillProgress = 0,
  songMs = 0,
): void {
  if (note.lyricChar == null) return;

  const cx = note.x * scale;
  const cy = note.y * scale;
  const r  = LYRIC_RADIUS * scale * pulse;
  const discR = r * 0.92;

  const OUTLINE_SNAP = 0.12;
  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);

  const { darkBase } = NOTE_STYLE.lyric.colors;

  const zoneR = r * (LYRIC_HOLD_RADIUS / LYRIC_RADIUS);
  if (outlineAlpha > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, zoneR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${LYRIC_ZONE_GHOST_ALPHA * outlineAlpha})`;
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    ctx.restore();
  }

  if (holdProgress > 0) {
    const releaseT = holdProgress > LYRIC_HOLD_RELEASE_START
      ? (holdProgress - LYRIC_HOLD_RELEASE_START) / (1 - LYRIC_HOLD_RELEASE_START)
      : 0;
    const haloR = discR * (1 - releaseT * LYRIC_HOLD_HALO_SHRINK);
    const breath = !lyricReducedMotion() && holding ? 1 + 0.035 * Math.sin(songMs * 0.014) : 1;
    const warmth = holdProgress;

    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR * breath);
    const innerA = 0.12 + warmth * 0.22;
    grad.addColorStop(0, holding
      ? `rgba(${LYRIC_TEAL}, ${innerA})`
      : `rgba(255, 255, 255, ${innerA * 0.55})`);
    grad.addColorStop(0.65, `rgba(255, 255, 255, ${warmth * 0.08})`);
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, haloR * breath, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
    ctx.strokeStyle = holding
      ? `rgba(${LYRIC_TEAL}, ${0.35 + warmth * 0.25})`
      : `rgba(255, 255, 255, ${0.2 + warmth * 0.15})`;
    ctx.lineWidth = (2 + warmth * 1.5) * scale;
    ctx.stroke();
    ctx.restore();
  } else {
    const discFill = Math.max(
      0,
      (appearProgress - LYRIC_APPROACH_FILL_START) / (1 - LYRIC_APPROACH_FILL_START),
    );
    ctx.save();
    if (discFill > 0) {
      const fillR = discR * discFill;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, fillR);
      grad.addColorStop(0, `rgba(255, 255, 255, ${0.18 * discFill * outlineAlpha})`);
      grad.addColorStop(0.7, `rgba(${LYRIC_TEAL}, ${0.08 * discFill * outlineAlpha})`);
      grad.addColorStop(1, `rgba(255, 255, 255, ${0.04 * discFill * outlineAlpha})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, fillR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, discR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 * outlineAlpha})`;
    ctx.lineWidth = 1.5 * scale;
    ctx.stroke();
    ctx.restore();
  }

  const { fontPx } = layoutLyricGlyphs(note.lyricChar, scale, pulse);
  const fill = Math.max(0, Math.min(1, fillProgress));

  ctx.save();
  ctx.font = `bold ${fontPx.toFixed(1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (!hidden) {
    if (fill > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * fill * outlineAlpha})`;
      ctx.fillText(note.lyricChar, cx, cy);
    }
    const strokeAlpha = 0.9 * outlineAlpha * (1 - fill * 0.85);
    if (strokeAlpha > 0.01) {
      ctx.strokeStyle = `rgba(${darkBase}, ${strokeAlpha})`;
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeText(note.lyricChar, cx, cy);
    }
  }

  ctx.restore();
}

/** Canvas-only lyric funnel for TestPlay/tutorial (no storyboard DOM). */
export function drawLyricDemoFunnel(
  ctx: CanvasRenderingContext2D,
  note: Note,
  songMs: number,
  approachMs: number,
  scale: number,
  originX: number,
  originY: number,
  pulse = 1,
): void {
  const text = note.lyricChar;
  if (!text) return;

  const chars = [...text];
  const n = chars.length;
  const layout = layoutLyricGlyphs(text, scale, pulse);
  const cx = note.x * scale;
  const cy = note.y * scale + lyricFunnelDestOffsetYPx(layout.fontPx);
  const ox = originX * scale;
  const oy = originY * scale;
  const flightStart = note.time - approachMs;

  ctx.save();
  ctx.font = `bold ${layout.fontPx.toFixed(1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < n; i++) {
    const landTime = lyricCharLandTime(note.time, i, n, approachMs);
    if (songMs < flightStart || songMs >= landTime + LYRIC_FUNNEL_BLEND_MS) continue;

    const landBlend = Math.min(1, Math.max(0, (songMs - landTime) / LYRIC_FUNNEL_BLEND_MS));
    if (landBlend >= 1) continue;

    const t = Math.max(0, Math.min(1, (songMs - flightStart) / Math.max(1, landTime - flightStart)));
    const ease = 1 - (1 - t) * (1 - t);
    const grow = t < 0.5 ? 0.5 : 0.5 + ((t - 0.5) / 0.5) * 0.5;
    const dx = cx + layout.charOffsets[i];
    const fx = ox + (dx - ox) * ease;
    const fy = oy + (cy - oy) * ease;
    const approachOpacity = Math.min(1, t * 3) * (1 - landBlend);
    if (approachOpacity < 0.01) continue;

    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(grow, grow);
    ctx.fillStyle = `rgba(234, 255, 251, ${approachOpacity})`;
    ctx.shadowBlur = 8 * scale;
    ctx.shadowColor = `rgba(${LYRIC_TEAL}, 0.7)`;
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

export function drawFlowRibbon(
  ctx: CanvasRenderingContext2D,
  from: Note,
  to: Note,
  scale: number,
  alpha: number,
): void {
  const { base } = NOTE_STYLE.flow.colors;

  const ax = from.x, ay = from.y, bx = to.x, by = to.y;
  const chordX = bx - ax, chordY = by - ay;
  const tax = from.flowTanX ?? chordX, tay = from.flowTanY ?? chordY;
  const tbx = to.flowTanX   ?? chordX, tby = to.flowTanY   ?? chordY;
  const STEPS = 14;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const s  = i / STEPS;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const px = (h00 * ax + h10 * tax + h01 * bx + h11 * tbx) * scale;
    const py = (h00 * ay + h10 * tay + h01 * by + h11 * tby) * scale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = `rgba(${base}, ${0.22 * alpha})`;
  ctx.lineWidth = 10 * scale;
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.18 * alpha})`;
  ctx.lineWidth = 2 * scale;
  ctx.stroke();
  ctx.restore();
}

export function drawCursorOrb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rgb: string,
): void {
  ctx.save();
  ctx.shadowBlur = radius * 2.5;
  ctx.shadowColor = `rgba(${rgb}, 0.9)`;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${rgb}, 1.0)`;
  ctx.fill();
  ctx.restore();
}

function drawStar5(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, angle: number): void {
  const inner = r * 0.4;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a   = angle + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : inner;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    else         ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

function drawSquare(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, angle: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const s = Math.max(0.5, r);
  ctx.beginPath();
  ctx.rect(-s, -s, s * 2, s * 2);
  ctx.fill();
  ctx.restore();
}

export function drawCursorParticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  rgb: string,
  shape: TrailShape = "circle",
  angle = 0,
): void {
  ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
  if (shape === "star") {
    drawStar5(ctx, x, y, Math.max(0.5, radius), angle);
  } else if (shape === "square") {
    drawSquare(ctx, x, y, Math.max(0.5, radius), angle);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, radius), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawFireworks(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  kind: Note["kind"],
  progress: number,
  scale: number,
  seed: number,
): void {
  const maxLen = NOTE_RADIUS * 1.8 * scale;
  const alpha = 1 - progress;
  const len = maxLen * (1 - Math.pow(1 - progress, 2));
  const lw = 2.5 * scale * (1 - progress);

  if (!kind) {
    console.error("[mimi] drawFireworks: animation has no kind", { x, y, kind, progress });
    return;
  }

  const style = NOTE_STYLE[kind];
  if (!style) {
    console.error("[mimi] drawFireworks: unknown animation kind", { kind });
    return;
  }

  const color = style.colors.base;
  const cx = x * scale;
  const cy = y * scale;

  ctx.save();
  ctx.strokeStyle = `rgba(${color}, ${alpha})`;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";

  for (let i = 0; i < 4; i++) {
    const angle = ((seed + i * 1031) % 10007) * Math.PI * 2 / 10007;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();
  }

  ctx.restore();
}
