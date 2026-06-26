import type { Note } from "./engine";
import type { TrailShape } from "../core/settings";
import { withPath } from "../core/sitePath";

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

  ensureArrowGlyph();
  if (!arrowGlyph) {
    if (!arrowGlyphWarningShown) {
      arrowGlyphWarningShown = true;
      console.warn("[mimi] arrow glyph is not ready; skipping arrow draw until the SVG loads");
    }
    return;
  }

  // Place the SVG arrow: center its viewBox on the note, rotate to `direction`, and
  // scale so the arrow spans one note radius (matching the old hand-built footprint).
  // Build once; reuse for both clip and stroke.
  const s = r / arrowGlyph.viewBoxW;
  const matrix = new DOMMatrix()
    .translateSelf(cx, cy)
    .rotateSelf((note.direction * 180) / Math.PI)
    .scaleSelf(s)
    .translateSelf(-arrowGlyph.viewBoxW / 2, -arrowGlyph.viewBoxH / 2);
  const path = new Path2D();
  path.addPath(arrowGlyph.path, matrix);

  // Radial fill clipped to arrow shape (skipped in hidden mod)
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

  // Stroke outline (clip no longer active)
  ctx.save();
  ctx.strokeStyle = `rgba(${darkBase}, ${0.9 * outlineAlpha})`;
  ctx.lineWidth = 2.5 * scale;
  ctx.lineJoin  = "round";
  ctx.stroke(path);
  ctx.restore();
}

// appearProgress: 0 = faint outline just appearing, 1 = fully visible at hit time.
// The lyric character itself is delivered by the storyboard's DOM funnel (it flies
// from the source lyric onto the note); the canvas draws only the dashed target
// circle and the glyph's stroke outline so the note's position and text are legible.
export function drawLyricNote(
  ctx: CanvasRenderingContext2D,
  note: Note,
  appearProgress: number,
  scale: number,
): void {
  if (!note.lyricChar) return;

  const cx = note.x * scale;
  const cy = note.y * scale;
  const r  = LYRIC_RADIUS * scale;

  const OUTLINE_SNAP = 0.12;
  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);

  const { darkBase } = NOTE_STYLE.lyric.colors;

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
  const baseSize = r * 0.9;
  ctx.font = `bold ${baseSize.toFixed(1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Multi-char lyrics (e.g. a whole word or 自分) must fit inside the circle; shrink
  // the font when the measured width exceeds the dot's usable span.
  const maxWidth = dotR * 1.9;
  const measured = ctx.measureText(note.lyricChar).width;
  if (measured > maxWidth) {
    ctx.font = `bold ${(baseSize * (maxWidth / measured)).toFixed(1)}px sans-serif`;
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
