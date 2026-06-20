import type { Note } from "./engine";
import type { TrailShape } from "../core/settings";

export const NOTE_RADIUS  = 52;
export const LYRIC_RADIUS = 34;

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

// Gameplay arrow glyph (Inkscape export, path7.svg) normalized into its own viewBox.
// Points along +x; drawArrow transforms it onto each note instead of rebuilding the
// polygon every frame. Coordinates have the source SVG's group translate folded in.
const ARROW_VB_W = 80.620979;
const ARROW_VB_H = 59.231922;
const ARROW_PATH = new Path2D(
  "M 46.206037,0.999876 V 15.646527 H 1.000008 v 27.93886 h 45.206029 v 14.64665 l 33.41501,-28.61582 z",
);

// appearProgress: 0 = faint outline just appearing, 1 = fully filled at hit time
// scale: canvas pixels per logical unit (canvas.width / LOGICAL_W)
export function drawArrow(
  ctx: CanvasRenderingContext2D,
  note: Note,
  appearProgress: number,
  scale: number,
  hidden = false,
): void {
  const cx = note.x * scale;
  const cy = note.y * scale;
  const r  = NOTE_RADIUS * scale;

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

  // Outline snaps to full opacity quickly; fill grows from center after FILL_START
  const OUTLINE_SNAP = 0.12;
  const FILL_START   = 0.62;
  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);
  const fillProgress = Math.max(0, (appearProgress - FILL_START) / (1 - FILL_START));

  // Place the SVG arrow: center its viewBox on the note, rotate to `direction`, and
  // scale so the arrow spans one note radius (matching the old hand-built footprint).
  // Build once; reuse for both clip and stroke.
  const s = r / ARROW_VB_W;
  const matrix = new DOMMatrix()
    .translateSelf(cx, cy)
    .rotateSelf((note.direction * 180) / Math.PI)
    .scaleSelf(s)
    .translateSelf(-ARROW_VB_W / 2, -ARROW_VB_H / 2);
  const path = new Path2D();
  path.addPath(ARROW_PATH, matrix);

  // Radial fill clipped to arrow shape (skipped in hidden mod)
  if (!hidden) {
    ctx.save();
    ctx.clip(path);
    const fillMaxR = (Math.hypot(ARROW_VB_W, ARROW_VB_H) / 2) * s;
    ctx.beginPath();
    ctx.arc(cx, cy, fillProgress * fillMaxR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base}, 1.0)`;
    ctx.fill();
    ctx.restore();
  }

  // Stroke outline (clip no longer active)
  ctx.save();
  ctx.strokeStyle = `rgba(${darkBase}, ${0.9 * outlineAlpha})`;
  ctx.lineWidth = 2.5 * scale;
  ctx.lineJoin  = "round";
  ctx.stroke(path);
  ctx.restore();
}

// appearProgress: 0 = faint outline just appearing, 1 = fully visible at hit time
// hidden: suppresses the lyric char (circle outline remains)
export function drawLyricNote(
  ctx: CanvasRenderingContext2D,
  note: Note,
  appearProgress: number,
  scale: number,
  hidden = false,
): void {
  if (!note.lyricChar) return;

  const cx = note.x * scale;
  const cy = note.y * scale;
  const r  = LYRIC_RADIUS * scale;

  const OUTLINE_SNAP = 0.12;
  const FILL_START   = 0.62;
  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);
  const fillProgress = Math.max(0, (appearProgress - FILL_START) / (1 - FILL_START));

  const { base, darkBase } = NOTE_STYLE.lyric.colors;

  const dotR = r * 0.62;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
  ctx.setLineDash([3 * scale, 4 * scale]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.font = `bold ${(r * 0.9).toFixed(1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (!hidden && fillProgress > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, fillProgress * r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = `rgba(${base}, 1.0)`;
    ctx.fillText(note.lyricChar, cx, cy);
    ctx.restore();
  }

  ctx.strokeStyle = `rgba(${darkBase}, ${0.9 * outlineAlpha})`;
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeText(note.lyricChar, cx, cy);

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

  // Cubic Hermite from `from` to `to` using each anchor's ribbon tangent, so the
  // drawn ribbon matches the curve the anchors trace. Missing tangents (e.g. a lone
  // link) fall back to the straight chord.
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
