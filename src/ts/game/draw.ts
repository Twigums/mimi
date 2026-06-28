import type { Note } from "./engine";
import type { TrailShape } from "../core/settings";
import { withPath } from "../core/sitePath";
import {
  layoutLyricGlyphs,
  LYRIC_AURA_EXTEND_PX,
  LYRIC_END_BURST_MS,
  LYRIC_FUNNEL_BLEND_MS,
  LYRIC_HOLD_GREY_SETTLE_MS,
  LYRIC_RADIUS,
  LYRIC_RELEASE_CUE_MS,
  LYRIC_SOLID_RING_RATIO,
  lyricBoundApproachAlpha,
  lyricBoundApproachRotation,
  lyricBoundRadiusRatio,
  lyricCharLandTime,
  lyricGlyphOffsetYPx,
  lyricHoldBlueBlend,
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

// Approach-fill tuning shared by the cut arrow and the flow anchor so they can't drift:
// the outline snaps in over the first OUTLINE_SNAP of the approach, then a center-out
// radial fill grows from FILL_START to hit time.
const OUTLINE_SNAP = 0.12;
const FILL_START   = 0.62;

interface GlyphGlow {
  rgb: string;
  alpha: number;
  blur: number;
}

// Shared render for the directional notes: a center-out radial fill clipped to the glyph
// outline (Hidden = outline only) plus the outline stroke, with an optional soft glow on
// the stroke. `fillMaxR` is the radius that fully covers the glyph (half its bounding
// diagonal). Cut passes no glow (crisp); flow passes its blue glow (personality split).
function drawApproachGlyph(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  cx: number,
  cy: number,
  fillMaxR: number,
  base: string,
  darkBase: string,
  appearProgress: number,
  scale: number,
  hidden: boolean,
  glow?: GlyphGlow,
): void {
  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);
  const fillProgress = Math.max(0, (appearProgress - FILL_START) / (1 - FILL_START));

  if (!hidden) {
    ctx.save();
    ctx.clip(path);
    ctx.beginPath();
    ctx.arc(cx, cy, fillProgress * fillMaxR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${base}, 1.0)`;
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  if (glow) {
    ctx.shadowColor = `rgba(${glow.rgb}, ${glow.alpha})`;
    ctx.shadowBlur  = glow.blur;
  }
  ctx.strokeStyle = `rgba(${darkBase}, ${0.9 * outlineAlpha})`;
  ctx.lineWidth = 2.5 * scale;
  ctx.lineJoin  = "round";
  ctx.stroke(path);
  ctx.restore();
}

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

  const fillMaxR = (Math.hypot(arrowGlyph.viewBoxW, arrowGlyph.viewBoxH) / 2) * s;
  drawApproachGlyph(ctx, path, cx, cy, fillMaxR, base, darkBase, appearProgress, scale, hidden);
}

// Flow anchor: a smaller version of the cut arrowhead with the boxy shaft replaced by a
// tail tapering to a single back point, ~FLOW_SCALE the size, with a soft blue glow that
// sets flow apart from the crisp cut. Procedural (built from arrow.svg proportions) and
// rotated to note.direction; reuses the shared approach fill/outline.
const FLOW_SCALE      = 0.85;
const FLOW_GLOW_ALPHA = 0.5;
const FLOW_GLOW_BLUR  = 0.28; // × NOTE_RADIUS × scale

// Arrow aspect ratio (height / width) from arrow.svg's viewBox, so the normalized glyph
// keeps the arrowhead proportions instead of squashing toward a square.
const FLOW_ASPECT = 59.231922 / 80.620979;

// Flow glyph outline in a normalized viewBox (0..1, +x = note.direction). The head base
// line sits at x = FLOW_HEAD_BASE_X; the tail body meets it between the two junctions and
// tapers to a single back point at (0, 0.5). FLOW_HEAD_SCALE shrinks just the arrowhead
// (tip length + barb spread) about its base centre (FLOW_HEAD_BASE_X, 0.5) so the head
// reads lighter than the cut block arrow while the tail stays put; 1 = arrow.svg's head.
const FLOW_HEAD_BASE_X = 0.573;
const FLOW_HEAD_SCALE  = 0.85;
// Clockwise: top barb → tip → bottom barb → bottom junction → tail back point → top junction.
const FLOW_GLYPH: ReadonlyArray<readonly [number, number]> = [
  [FLOW_HEAD_BASE_X,                                      0.5 + (0.017 - 0.5) * FLOW_HEAD_SCALE],
  [FLOW_HEAD_BASE_X + (0.988 - FLOW_HEAD_BASE_X) * FLOW_HEAD_SCALE, 0.5],
  [FLOW_HEAD_BASE_X,                                      0.5 + (0.983 - 0.5) * FLOW_HEAD_SCALE],
  [FLOW_HEAD_BASE_X, 0.736],
  [0.000,            0.500],
  [FLOW_HEAD_BASE_X, 0.264],
];

export function drawFlowAnchor(
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
  const { base, darkBase } = FLOW_STYLE.colors;

  const w = r * FLOW_SCALE;
  const h = w * FLOW_ASPECT;

  const local = new Path2D();
  FLOW_GLYPH.forEach(([px, py], i) => {
    if (i === 0) local.moveTo(px, py);
    else local.lineTo(px, py);
  });
  local.closePath();

  const matrix = new DOMMatrix()
    .translateSelf(cx, cy)
    .rotateSelf((note.direction * 180) / Math.PI)
    .scaleSelf(w, h)
    .translateSelf(-0.5, -0.5);
  const path = new Path2D();
  path.addPath(local, matrix);

  const fillMaxR = Math.hypot(w, h) / 2;
  drawApproachGlyph(ctx, path, cx, cy, fillMaxR, base, darkBase, appearProgress, scale, hidden, {
    rgb: base,
    alpha: FLOW_GLOW_ALPHA,
    blur: FLOW_GLOW_BLUR * NOTE_RADIUS * scale,
  });
}

const LYRIC_FUNNEL_GLOW = "57, 197, 187";
const LYRIC_INVITE = "255, 252, 245";
const LYRIC_HOLD_GREY = "228, 232, 238";
const LYRIC_RELEASE_BLUE = "82, 162, 255";

function mixRgb(a: string, b: string, t: number): string {
  const pa = a.split(",").map(s => Number(s.trim()));
  const pb = b.split(",").map(s => Number(s.trim()));
  const u = Math.max(0, Math.min(1, t));
  return pa.map((v, i) => Math.round(v * (1 - u) + pb[i] * u)).join(", ");
}

function easeOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  const v = 1 - u;
  return 1 - v * v * v;
}

/** Soft wash inside the bound + a whisper of gradient just past the dashed edge. */
function drawLyricDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  boundR: number,
  scale: number,
  rgb: string,
  fillAlpha: number,
  whisperAlpha: number,
  breath = 1,
): void {
  if (fillAlpha <= 0.005 && whisperAlpha <= 0.005) return;

  ctx.save();
  if (fillAlpha > 0.005) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, boundR);
    grad.addColorStop(0, `rgba(${rgb}, ${fillAlpha})`);
    grad.addColorStop(0.72, `rgba(${rgb}, ${fillAlpha * 0.28})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, boundR, 0, Math.PI * 2);
    ctx.fill();
  }

  if (whisperAlpha > 0.005) {
    const auraR = boundR + LYRIC_AURA_EXTEND_PX * scale * breath;
    const grad = ctx.createRadialGradient(cx, cy, boundR * 0.92, cx, cy, auraR);
    grad.addColorStop(0, `rgba(${rgb}, ${whisperAlpha})`);
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLyricBound(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  boundR: number,
  scale: number,
  alpha: number,
  rgb = "255, 255, 255",
  dashed = true,
  rotation = 0,
): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.arc(0, 0, boundR, 0, Math.PI * 2);
  if (dashed) ctx.setLineDash([3 * scale, 4 * scale]);
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawLyricSolidRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ringR: number,
  scale: number,
  alpha: number,
  rgb = "255, 255, 255",
): void {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.restore();
}

// appearProgress: 0 = faint outline just appearing, 1 = fully visible at hit time
// hidden: suppresses the lyric char (disc/halo remain)
// holdProgress: 0..1 fraction of the hold elapsed (drives sustain halo)
// holding: whether the cursor is currently inside the hold radius
// visualScale: approach pulse or sustain shrink/burst from lyricHoldScale
// fillProgress: 0 = hollow stroke only; 1 = funnel landed and the note glyph is filled
// holdMs: full hold length (drives release-cue shading and end burst)
// elapsedSinceHitMs: ms after note time (drives dotted-bound shrink to steady state)
export function drawLyricNote(
  ctx: CanvasRenderingContext2D,
  note: Note,
  appearProgress: number,
  scale: number,
  hidden = false,
  holdProgress = 0,
  holding = false,
  visualScale = 1,
  fillProgress = 0,
  holdMs = 0,
  elapsedSinceHitMs = 0,
): void {
  if (note.lyricChar == null) return;

  const cx = note.x * scale;
  const r  = LYRIC_RADIUS * scale * visualScale;
  const solidR = r * LYRIC_SOLID_RING_RATIO;
  const boundR = r * lyricBoundRadiusRatio(appearProgress, elapsedSinceHitMs);

  const outlineAlpha = Math.min(appearProgress / OUTLINE_SNAP, 1);

  const { fontPx } = layoutLyricGlyphs(note.lyricChar, scale, visualScale);
  const noteCy = note.y * scale;
  const glyphY = noteCy + lyricGlyphOffsetYPx(fontPx);

  const { darkBase } = NOTE_STYLE.lyric.colors;

  const remainingMs = holdMs > 0 ? holdMs * (1 - holdProgress) : Infinity;
  const burstBlend = holdProgress > 0 && holdMs > 0 && remainingMs <= LYRIC_END_BURST_MS
    ? easeOutCubic(1 - remainingMs / LYRIC_END_BURST_MS)
    : 0;

  if (holdProgress > 0) {
    const holdBright = holding ? 1 : 0.55;
    const elapsedMs = holdMs > 0 ? holdProgress * holdMs : 0;
    const greyBlend = easeOutCubic(
      holdMs > 0 ? elapsedMs / LYRIC_HOLD_GREY_SETTLE_MS : holdProgress / 0.3,
    );
    const blueBlend = lyricHoldBlueBlend(holdProgress, remainingMs, holdMs);

    const sustainRgb = mixRgb(LYRIC_INVITE, LYRIC_HOLD_GREY, greyBlend);
    const auraRgb = mixRgb(sustainRgb, LYRIC_RELEASE_BLUE, blueBlend);
    const sustainCurve = Math.pow(holdProgress, 0.65);
    const fillAlpha = (0.1 + sustainCurve * 0.2) * holdBright * (1 + burstBlend * 0.35);
    const whisperAlpha = fillAlpha * (0.35 + blueBlend * 0.35);
    const boundAlpha = (0.32 + sustainCurve * 0.16) * holdBright * (1 + burstBlend * 0.25);
    const boundRgb = mixRgb("255, 255, 255", LYRIC_RELEASE_BLUE, blueBlend * 0.9);
    const solidAlpha = boundAlpha * 0.85;

    ctx.save();
    drawLyricDisc(ctx, cx, noteCy, boundR, scale, auraRgb, fillAlpha, whisperAlpha);
    drawLyricBound(ctx, cx, noteCy, boundR, scale, boundAlpha, boundRgb);
    drawLyricSolidRing(ctx, cx, noteCy, solidR, scale, solidAlpha, boundRgb);
    ctx.restore();
  } else {
    const ringAlpha = (0.28 + 0.22 * outlineAlpha) * outlineAlpha;
    const solidAlpha = ringAlpha * 0.75;
    const boundAlpha = lyricBoundApproachAlpha(appearProgress) * ringAlpha;
    const boundRotation = lyricBoundApproachRotation(appearProgress);

    ctx.save();
    drawLyricSolidRing(ctx, cx, noteCy, solidR, scale, solidAlpha);
    if (boundAlpha > 0.01) {
      drawLyricBound(ctx, cx, noteCy, boundR, scale, boundAlpha, "255, 255, 255", true, boundRotation);
    }
    ctx.restore();
  }

  const fill = Math.max(0, Math.min(1, fillProgress));
  const glyphBright = holdProgress > 0
    ? 0.95 * (holding ? 1 : 0.72) * (1 + burstBlend * 0.12)
    : 0.95;

  ctx.save();
  ctx.font = `bold ${fontPx.toFixed(1)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (!hidden) {
    if (fill > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${glyphBright * fill * outlineAlpha})`;
      ctx.fillText(note.lyricChar, cx, glyphY);
    }
    const strokeAlpha = 0.9 * outlineAlpha * (1 - fill * 0.85);
    if (strokeAlpha > 0.01) {
      ctx.strokeStyle = `rgba(${darkBase}, ${strokeAlpha})`;
      ctx.lineWidth = 1.5 * scale;
      ctx.strokeText(note.lyricChar, cx, glyphY);
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
  const glyphY = note.y * scale + lyricGlyphOffsetYPx(layout.fontPx);
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
    const fy = oy + (glyphY - oy) * ease;
    const approachOpacity = Math.min(1, t * 3) * (1 - landBlend);
    if (approachOpacity < 0.01) continue;

    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(grow, grow);
    ctx.fillStyle = `rgba(234, 255, 251, ${approachOpacity})`;
    ctx.shadowBlur = 8 * scale;
    ctx.shadowColor = `rgba(${LYRIC_FUNNEL_GLOW}, 0.7)`;
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

// Flow ribbon: a cubic-Hermite band between linked anchors. RIBBON_STEPS sets the polyline
// resolution used for both drawing and the arc-length table.
const RIBBON_STEPS      = 24;
const RIBBON_BAND_ALPHA = 0.22;
const RIBBON_CORE_ALPHA = 0.18;
// Reveal fraction over which a fresh segment fades up to full opacity (softens the entrance).
const RIBBON_FADE_IN    = 0.5;
// The leading edge glows: over the last RIBBON_TIP_FRAC of the revealed length an additive
// brightness ramps from 0 (seamless join into the body) up to these alphas at the tip.
const RIBBON_TIP_FRAC       = 0.15;
const RIBBON_TIP_BAND_ALPHA = 0.5;
const RIBBON_TIP_CORE_ALPHA = 0.55;

// revealFront: 0..1 fraction of the ribbon's arc length currently drawn, keyed to the
// destination anchor's approach. The band reveals from `from` toward `to` with a brighter
// leading tip, so it reads as drawing itself forward toward the upcoming anchor.
export function drawFlowRibbon(
  ctx: CanvasRenderingContext2D,
  from: Note,
  to: Note,
  scale: number,
  revealFront: number,
): void {
  const reveal = Math.max(0, Math.min(1, revealFront));
  if (reveal <= 0) return;

  // Fade a fresh segment up as it reveals (full by RIBBON_FADE_IN of the reveal) so it
  // materialises softly instead of popping in at full opacity.
  const ft   = Math.min(1, reveal / RIBBON_FADE_IN);
  const fade = ft * ft * (3 - 2 * ft);

  const { base } = NOTE_STYLE.flow.colors;
  const ax = from.x, ay = from.y, bx = to.x, by = to.y;
  const chordX = bx - ax, chordY = by - ay;
  const tax = from.flowTanX ?? chordX, tay = from.flowTanY ?? chordY;
  const tbx = to.flowTanX   ?? chordX, tby = to.flowTanY   ?? chordY;

  // Hermite polyline (canvas space) with a cumulative arc-length table.
  const xs: number[] = [], ys: number[] = [], cum: number[] = [];
  let total = 0;
  for (let i = 0; i <= RIBBON_STEPS; i++) {
    const s  = i / RIBBON_STEPS;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const x = (h00 * ax + h10 * tax + h01 * bx + h11 * tbx) * scale;
    const y = (h00 * ay + h10 * tay + h01 * by + h11 * tby) * scale;
    if (i > 0) total += Math.hypot(x - xs[i - 1], y - ys[i - 1]);
    xs.push(x); ys.push(y); cum.push(total);
  }
  if (total <= 0) return;

  // Point at a target arc length (interpolated within the crossing segment).
  const at = (target: number): [number, number] => {
    if (target <= 0) return [xs[0], ys[0]];
    if (target >= total) return [xs[xs.length - 1], ys[ys.length - 1]];
    let i = 1;
    while (i < cum.length && cum[i] < target) i++;
    const seg = cum[i] - cum[i - 1];
    const f = seg > 0 ? (target - cum[i - 1]) / seg : 0;
    return [xs[i - 1] + (xs[i] - xs[i - 1]) * f, ys[i - 1] + (ys[i] - ys[i - 1]) * f];
  };

  // Sub-path between two arc lengths, following the polyline vertices in between.
  const subPath = (fromLen: number, toLen: number): Path2D => {
    const path = new Path2D();
    const [sx, sy] = at(fromLen);
    path.moveTo(sx, sy);
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] <= fromLen) continue;
      if (cum[i] >= toLen) break;
      path.lineTo(xs[i], ys[i]);
    }
    const [ex, ey] = at(toLen);
    path.lineTo(ex, ey);
    return path;
  };

  const revealLen = reveal * total;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Revealed band, faded in over the start of the reveal.
  const body = subPath(0, revealLen);
  ctx.strokeStyle = `rgba(${base}, ${RIBBON_BAND_ALPHA * fade})`;
  ctx.lineWidth = 10 * scale;
  ctx.stroke(body);
  ctx.strokeStyle = `rgba(255, 255, 255, ${RIBBON_CORE_ALPHA * fade})`;
  ctx.lineWidth = 2 * scale;
  ctx.stroke(body);

  // Brightening ramp over the leading tip (additive; the gradient starts transparent so the
  // join into the body is seamless, and a soft glow blooms the front edge).
  const tipLen = revealLen * RIBBON_TIP_FRAC;
  if (tipLen > 0.5) {
    const [tsx, tsy] = at(revealLen - tipLen);
    const [tex, tey] = at(revealLen);
    const tip = subPath(revealLen - tipLen, revealLen);

    ctx.shadowColor = `rgba(${base}, ${0.6 * fade})`;
    ctx.shadowBlur  = 6 * scale;

    const bandGrad = ctx.createLinearGradient(tsx, tsy, tex, tey);
    bandGrad.addColorStop(0, `rgba(${base}, 0)`);
    bandGrad.addColorStop(1, `rgba(${base}, ${RIBBON_TIP_BAND_ALPHA * fade})`);
    ctx.strokeStyle = bandGrad;
    ctx.lineWidth = 10 * scale;
    ctx.stroke(tip);

    const coreGrad = ctx.createLinearGradient(tsx, tsy, tex, tey);
    coreGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
    coreGrad.addColorStop(1, `rgba(255, 255, 255, ${RIBBON_TIP_CORE_ALPHA * fade})`);
    ctx.strokeStyle = coreGrad;
    ctx.lineWidth = 2 * scale;
    ctx.stroke(tip);
  }

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

function drawLyricFireworks(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  progress: number,
  scale: number,
  color: string,
): void {
  const alpha = 1 - progress;
  const r = LYRIC_RADIUS * 1.35 * scale * (1 - Math.pow(1 - progress, 1.6));

  ctx.save();
  ctx.strokeStyle = `rgba(${color}, ${alpha})`;
  ctx.lineWidth = 3 * scale * (1 - progress);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.65})`;
  ctx.lineWidth = 1.5 * scale * (1 - progress);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
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

  if (kind === "lyric") {
    drawLyricFireworks(ctx, cx, cy, progress, scale, color);
    return;
  }

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
