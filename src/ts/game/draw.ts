import type { Note } from "./engine";
import type { TrailShape } from "../core/settings";

export const NOTE_RADIUS  = 42;
export const LYRIC_RADIUS = 28;

interface NoteColors {
  base: string;
  darkBase: string;
}

interface NoteStyle {
  colors: NoteColors;
}

export const NOTE_STYLE: Record<Note["kind"], NoteStyle> = {
  cut:   { colors: { base: "255, 82, 82",   darkBase: "191, 62, 62"   } },
  flow:  { colors: { base: "82, 162, 255",  darkBase: "62, 122, 191"  } },
  lyric: { colors: { base: "255, 255, 255", darkBase: "200, 200, 200" } },
};

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

  const { base, darkBase } = NOTE_STYLE[note.kind].colors;

  const len     = r;         // total arrow length
  const headLen = r * 0.4;  // arrowhead length
  const hw      = r * 0.4;  // arrowhead half-width (flare)
  const shw     = r * 0.17; // shaft half-width

  const cosA = Math.cos(note.direction);
  const sinA = Math.sin(note.direction);

  // Rotate local (lx, ly) into canvas space around (cx, cy)
  const tx = (lx: number, ly: number): number => cx + cosA * lx - sinA * ly;
  const ty = (lx: number, ly: number): number => cy + sinA * lx + cosA * ly;

  const x0 = -len / 2;           // tail
  const x1 =  len / 2 - headLen; // shaft/head junction
  const x2 =  len / 2;           // tip

  // Outline snaps to full opacity quickly; fill grows from center after FILL_START
  const OUTLINE_SNAP = 0.12;
  const FILL_START   = 0.62;
  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);
  const fillProgress = Math.max(0, (appearProgress - FILL_START) / (1 - FILL_START));

  // Build path once; reuse for both clip and stroke
  const path = new Path2D();
  path.moveTo(tx(x2,    0), ty(x2,    0));
  path.lineTo(tx(x1,  -hw), ty(x1,  -hw));
  path.lineTo(tx(x1, -shw), ty(x1, -shw));
  path.lineTo(tx(x0, -shw), ty(x0, -shw));
  path.lineTo(tx(x0,  shw), ty(x0,  shw));
  path.lineTo(tx(x1,  shw), ty(x1,  shw));
  path.lineTo(tx(x1,   hw), ty(x1,   hw));
  path.closePath();

  // Radial fill clipped to arrow shape (skipped in hidden mod)
  if (!hidden) {
    ctx.save();
    ctx.clip(path);
    const fillMaxR = Math.sqrt((len / 2) ** 2 + shw ** 2);
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
  ctx.lineJoin  = "miter";
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

  const color = NOTE_STYLE[kind].colors.base;
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
