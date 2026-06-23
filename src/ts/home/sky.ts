import { withPath } from "../core/sitePath";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 1920;
const VIEW_H = 1080;
const MAX_ELEMENTS = 40;
const INITIAL_CLOUDS = 6;
const INITIAL_NOTES = 4;
const CLOUD_SPAWN_MS = 2400;
const NOTE_SPAWN_MS = 4200;
const SHOOTING_STAR_SPAWN_MS = 9000;
const SPAWN_JITTER = 0.5; // spawn intervals vary ±50% around the base frequency
const NOTE_BASE_H = 60;   // nominal glyph height before scaling
// note physics (units: SVG user units, ms)
const GRAVITY = 0.00003;        // downward accel, keeps the gentle "fall" feel
const NOTE_RESTITUTION = 0.7;   // bounciness of note-on-note hits
const COLLISION_ITERS = 2;      // relaxation passes per frame for stable stacks
const MAX_THROW_SPEED = 2.5;    // cap a flick so a note can't teleport off
const MAX_STEP_MS = 32;         // clamp dt after a tab-switch so nothing tunnels
const STAR_COUNT = 26;
// hub of the celestial dial, far below the horizon; must match the
// .sky-dial transform-origin in _home.scss
const DIAL_CX = VIEW_W / 2;
const DIAL_CY = 3000;

type NoteKind = "quarter" | "eighth" | "beamed" | "half" | "whole";

interface NoteAsset {
  viewBoxW: number;
  viewBoxH: number;
  shapes: SVGElement[];
}

// quarter notes make up half the sky; the rest split the remainder evenly
const NOTE_KINDS: ReadonlyArray<{ kind: NoteKind; weight: number }> = [
  { kind: "quarter", weight: 0.5 },
  { kind: "eighth", weight: 0.125 },
  { kind: "beamed", weight: 0.125 },
  { kind: "half", weight: 0.125 },
  { kind: "whole", weight: 0.125 },
];

const NOTE_ASSET_SRC: Record<NoteKind, string> = {
  quarter: "/images/music_notes/quarter_note.svg",
  eighth: "/images/music_notes/eighth_note.svg",
  beamed: "/images/music_notes/2_eighth_notes.svg",
  half: "/images/music_notes/half_note.svg",
  whole: "/images/music_notes/whole_note.svg",
};

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function pickNoteKind(): NoteKind {
  let roll = Math.random();
  for (const { kind, weight } of NOTE_KINDS) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return "quarter";
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function parseNumberList(raw: string): number[] {
  return raw.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
}

// twinkling stars; rendered behind everything and faded in/out by CSS
// (html.theme-dark .night-layer) so theme switches stay seamless
function buildNightLayer(): SVGGElement {
  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("class", "night-layer");

  for (let i = 0; i < STAR_COUNT; i++) {
    const star = el("circle", {
      class: "star",
      cx: rand(20, VIEW_W - 20).toFixed(0),
      cy: rand(20, VIEW_H * 0.75).toFixed(0),
      r: rand(1.2, 3).toFixed(1),
    });
    star.style.animationDuration = `${rand(1.8, 4.5).toFixed(1)}s`;
    star.style.animationDelay = `-${rand(0, 4).toFixed(1)}s`;
    layer.appendChild(star);
  }
  return layer;
}

// the moon's "craters" are the simple-miku.svg drawing, fetched at runtime and
// inlined onto the moon so it always matches the asset (no path data is copied
// into this file)
const MIKU_SRC = "/images/simple-miku.svg";
// adjustment knobs — tweak these to fit the drawing on the moon:
const MIKU_FILL = 1.32;    // size: art's larger side ÷ moon diameter; >1 overflows the rim and clips
const MIKU_ROTATE = 25;     // spin in place, degrees clockwise
const MIKU_NUDGE_X = 0.09;    // shift across the moon, in moon radii (+ = right, e.g. 0.1 = 10% of the radius)
const MIKU_NUDGE_Y = 0.4;    // shift up/down the moon, in moon radii (+ = down)

// fetch simple-miku.svg and drop its drawing elements into the moon-face group;
// the asset's own black stroke is stripped so _home.scss can recolour the lines
// to the old crater tone, and the group is scaled/centred by reposition()
async function loadMoonFace(moonFace: SVGGElement, reposition: () => void): Promise<void> {
  try {
    const res = await fetch(withPath(MIKU_SRC));
    if (!res.ok) return;
    const root = new DOMParser().parseFromString(await res.text(), "image/svg+xml").documentElement;
    if (root.tagName.toLowerCase() !== "svg") return; // parse error markup
    for (const node of Array.from(root.children)) {
      if (node.tagName.toLowerCase() === "defs") continue;
      const shape = document.importNode(node, true) as SVGElement;
      for (const attr of ["style", "fill", "stroke"]) shape.removeAttribute(attr);
      moonFace.appendChild(shape);
    }
    reposition(); // the art now has a measurable bbox to scale against
  } catch {
    /* decorative: a missing or blocked asset just leaves a plain moon */
  }
}

// sun and moon sit on opposite ends of a wheel hubbed at (DIAL_CX, DIAL_CY);
// CSS rotates the .sky-dial group half a turn per theme, so the moon sets on
// the right while the sun rises from the left horizon (and vice versa)
function buildSkyDial(): SVGGElement {
  const dial = document.createElementNS(SVG_NS, "g");
  dial.setAttribute("class", "sky-dial");

  // halos are brightest at the body and fade outwards
  const defs = document.createElementNS(SVG_NS, "defs");
  const gradients: ReadonlyArray<[string, string]> = [
    ["moon-glow-gradient", "#f6f3cd"],
    ["sun-glow-gradient", "#ffe27a"],
  ];
  for (const [id, color] of gradients) {
    const gradient = el("radialGradient", { id });
    gradient.appendChild(el("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.62" }));
    gradient.appendChild(el("stop", { offset: "45%", "stop-color": color, "stop-opacity": "0.32" }));
    gradient.appendChild(el("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0" }));
    defs.appendChild(gradient);
  }
  dial.appendChild(defs);

  const my = rand(130, 260);
  const mr = rand(55, 75);
  const moonGlow = el("circle", { class: "moon-glow", cy: my.toFixed(0), r: (mr * 2.2).toFixed(0) });
  const moonBody = el("circle", { class: "moon-body", cy: my.toFixed(0), r: mr.toFixed(0) });
  dial.appendChild(moonGlow);
  dial.appendChild(moonBody);

  // the moon circle doubles as a clip so Miku's hair/twintails that spill past
  // the rim are cut away; the clip circle tracks the moon body in dial space
  const clipCircle = el("circle", { cy: my.toFixed(0), r: mr.toFixed(0) });
  const faceClipPath = el("clipPath", { id: "moon-face-clip", clipPathUnits: "userSpaceOnUse" });
  faceClipPath.appendChild(clipCircle);
  defs.appendChild(faceClipPath);

  // the inner group holds the (later-fetched) line art and carries the
  // placement transform; the outer group carries the clip, so the clip is
  // evaluated in dial space and lines up with the moon body's coordinates
  const moonFace = el("g", { class: "moon-face" });
  const faceClip = el("g", { "clip-path": "url(#moon-face-clip)" });
  faceClip.appendChild(moonFace);
  dial.appendChild(faceClip);

  // the sun starts diametrically opposite the moon, below the horizon;
  // rotating the dial 180° lands it exactly on the moon's sky slot
  const sy = 2 * DIAL_CY - my;
  const sr = mr + 6;
  const sunGlow = el("circle", { class: "sun-glow", cy: sy.toFixed(0), r: (sr * 2.2).toFixed(0) });
  const sunBody = el("circle", { class: "sun-body", cy: sy.toFixed(0), r: sr.toFixed(0) });
  dial.appendChild(sunGlow);
  dial.appendChild(sunBody);

  // the svg's `slice` fit crops the viewBox sides on narrow screens: only a
  // centred window of width VIEW_H * viewport-aspect stays visible, so the
  // moon's horizontal slot must be clamped into it (phones and tablets would
  // otherwise crop the dial away); re-clamped on resize/orientation change.
  // the sun mirrors through the hub, so it stays visible whenever the moon is
  const slot = Math.random();
  const place = (): void => {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    const visibleHalf = Math.min(VIEW_W, VIEW_H * aspect) / 2;
    const maxX = Math.min(VIEW_W * 0.88, DIAL_CX + visibleHalf - mr * 1.4);
    const minX = Math.min(VIEW_W * 0.72, maxX - VIEW_W * 0.05);
    const mx = minX + (maxX - minX) * slot;
    moonGlow.setAttribute("cx", mx.toFixed(0));
    moonBody.setAttribute("cx", mx.toFixed(0));
    clipCircle.setAttribute("cx", mx.toFixed(0));
    // scale the fetched art to fill the moon and centre it on the body; getBBox
    // reads the raw art bounds (ignoring this group's own transform), so it
    // stays stable across calls and is empty until the asset loads
    const bb = moonFace.getBBox();
    if (bb.width > 0 && bb.height > 0) {
      const faceScale = (2 * mr * MIKU_FILL) / Math.max(bb.width, bb.height);
      const fcx = bb.x + bb.width / 2;
      const fcy = bb.y + bb.height / 2;
      // applied right-to-left: centre the art on the origin, scale it, rotate it
      // in place, then move it to the moon centre plus the nudge offset
      const px = (mx + MIKU_NUDGE_X * mr).toFixed(1);
      const py = (my + MIKU_NUDGE_Y * mr).toFixed(1);
      moonFace.setAttribute(
        "transform",
        `translate(${px} ${py}) rotate(${MIKU_ROTATE}) scale(${faceScale.toFixed(4)}) translate(${(-fcx).toFixed(2)} ${(-fcy).toFixed(2)})`,
      );
    }
    const sx = (2 * DIAL_CX - mx).toFixed(0);
    sunGlow.setAttribute("cx", sx);
    sunBody.setAttribute("cx", sx);
  };
  place();
  window.addEventListener("resize", place);
  void loadMoonFace(moonFace, place); // populates the moon and re-places once loaded

  return dial;
}

// a streak aligned with its travel direction, animated by the shooting-star
// keyframe; only spawned while night mode is active
function spawnShootingStar(layer: SVGGElement): void {
  if (!document.documentElement.classList.contains("theme-dark")) return;
  const x = rand(VIEW_W * 0.2, VIEW_W * 0.95);
  const y = rand(40, VIEW_H * 0.4);
  const dx = -rand(320, 560);
  const dy = rand(150, 280);
  const mag = Math.hypot(dx, dy);
  const len = rand(80, 140);
  const star = el("path", {
    class: "shooting-star",
    d: `M${x.toFixed(0)} ${y.toFixed(0)} L${(x - (dx / mag) * len).toFixed(0)} ${(y - (dy / mag) * len).toFixed(0)}`,
  });
  star.style.setProperty("--ss-dx", `${dx.toFixed(0)}px`);
  star.style.setProperty("--ss-dy", `${dy.toFixed(0)}px`);
  star.style.animationDuration = `${rand(0.9, 1.6).toFixed(2)}s`;
  star.addEventListener("animationend", () => star.remove());
  layer.appendChild(star);
}

// a cloud is a wide base ellipse plus 3–5 random puffs along its top; parts
// are solid white and the group carries the opacity, so overlaps never seam
function buildCloudShape(w: number, h: number): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.appendChild(el("ellipse", {
    class: "cloud-part",
    cx: "0",
    cy: "0",
    rx: (w / 2).toFixed(0),
    ry: (h / 2).toFixed(0),
  }));
  const puffs = 3 + Math.floor(rand(0, 3));
  for (let i = 0; i < puffs; i++) {
    g.appendChild(el("circle", {
      class: "cloud-part",
      cx: rand(-w * 0.35, w * 0.35).toFixed(0),
      cy: (-rand(h * 0.2, h * 0.55)).toFixed(0),
      r: rand(h * 0.45, h * 0.85).toFixed(0),
    }));
  }
  return g;
}

function parseNoteAsset(text: string): NoteAsset | null {
  const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
  if (root.tagName.toLowerCase() !== "svg") return null;

  const [, , viewBoxW, viewBoxH] = parseNumberList(root.getAttribute("viewBox") ?? "");
  if (!viewBoxW || !viewBoxH) return null;

  const shapes = Array.from(root.children).filter((node): node is SVGElement => {
    const tag = node.tagName.toLowerCase();
    return tag !== "defs" && tag !== "metadata" && tag !== "title" && tag !== "desc";
  });

  return shapes.length > 0 ? { viewBoxW, viewBoxH, shapes } : null;
}

async function loadNoteAsset(kind: NoteKind): Promise<NoteAsset | null> {
  try {
    const res = await fetch(withPath(NOTE_ASSET_SRC[kind]));
    if (!res.ok) return null;
    return parseNoteAsset(await res.text());
  } catch {
    return null;
  }
}

async function loadNoteAssets(): Promise<Map<NoteKind, NoteAsset>> {
  const entries = await Promise.all(
    NOTE_KINDS.map(async ({ kind }) => [kind, await loadNoteAsset(kind)] as const),
  );
  const assets = new Map<NoteKind, NoteAsset>();
  for (const [kind, asset] of entries) {
    if (asset) assets.set(kind, asset);
  }
  return assets;
}

function buildNoteGlyph(asset: NoteAsset): SVGGElement {
  const g = el("g", { class: "note-glyph" });

  for (const shape of asset.shapes) {
    g.appendChild(document.importNode(shape, true));
  }

  // invisible grab area covering every glyph kind — Chrome lacks
  // pointer-events: bounding-box, so the gaps in notes need this
  g.appendChild(el("rect", {
    class: "note-hit",
    x: "0",
    y: "0",
    width: asset.viewBoxW.toFixed(3),
    height: asset.viewBoxH.toFixed(3),
  }));
  return g;
}

function spawnCloud(layer: SVGGElement, initial: boolean, staticField: boolean): void {
  if (layer.childElementCount >= MAX_ELEMENTS) return;
  const w = rand(70, 220);
  const h = w * rand(0.35, 0.5);
  const fullH = h * 1.8; // base ellipse plus the tallest possible puff
  const x = rand(80, VIEW_W - 80);
  const y = staticField ? rand(fullH, VIEW_H - fullH) : VIEW_H + fullH;

  // outer <g> carries the CSS rise animation; the inner <g> holds the static
  // placement transform so the two never fight over the transform property
  const cloud = document.createElementNS(SVG_NS, "g");
  cloud.setAttribute("class", "cloud");
  const shape = buildCloudShape(w, h);
  shape.setAttribute("transform", `translate(${x.toFixed(0)} ${y.toFixed(0)})`);
  cloud.appendChild(shape);
  cloud.style.opacity = rand(0.4, 0.85).toFixed(2);

  if (!staticField) {
    cloud.style.setProperty("--rise-y", `${(-(VIEW_H + 2 * fullH + 16)).toFixed(0)}px`);
    cloud.style.setProperty("--sway-x", `${rand(-40, 40).toFixed(0)}px`);
    const duration = rand(18, 32);
    cloud.style.animationDuration = `${duration.toFixed(1)}s`;
    if (initial) cloud.style.animationDelay = `-${rand(0, duration * 0.9).toFixed(1)}s`;
    cloud.addEventListener("animationend", () => cloud.remove());
  }

  layer.appendChild(cloud);
}

// a physics-driven note: an axis-aligned body (box = the glyph's scaled SVG
// dims, per the brief — loose, rotation-ignoring) carrying linear + angular
// velocity. cx/cy is the body centre; the glyph is rendered about it
interface PhysNote {
  el: SVGGElement;
  glyph: SVGGElement;
  s: number;            // glyph scale (NOTE_BASE_H/viewBoxH × random size)
  vbW: number;
  vbH: number;
  hw: number;           // half-width / half-height of the collision box
  hh: number;
  mass: number;
  invMass: number;      // 0 while dragged (immovable, but still shoves others)
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  rot: number;          // degrees
  vrot: number;         // degrees / ms
  dragging: boolean;
}

// the glyph rotates about the body centre and is offset so the asset is
// centred, so cx/cy is the true pivot (clean tumbling, simple collisions)
function renderNote(n: PhysNote): void {
  n.glyph.setAttribute(
    "transform",
    `translate(${n.cx.toFixed(1)} ${n.cy.toFixed(1)}) rotate(${n.rot.toFixed(1)}) scale(${n.s.toFixed(4)}) translate(${(-n.vbW / 2).toFixed(1)} ${(-n.vbH / 2).toFixed(1)})`,
  );
}

// gone once fully past an edge (with slack so spawns just above the top and
// near-misses aren't culled mid-flight)
function offscreen(n: PhysNote): boolean {
  return (
    n.cy - n.hh > VIEW_H + 60 ||
    n.cy + n.hh < -600 ||
    n.cx + n.hw < -200 ||
    n.cx - n.hw > VIEW_W + 200
  );
}

// AABB collision: separate along the least-penetration axis and exchange
// momentum there (1D impulse with restitution, weighted by inverse mass)
function collide(a: PhysNote, b: PhysNote): void {
  const dx = b.cx - a.cx;
  const ox = a.hw + b.hw - Math.abs(dx);
  if (ox <= 0) return;
  const dy = b.cy - a.cy;
  const oy = a.hh + b.hh - Math.abs(dy);
  if (oy <= 0) return;
  const invSum = a.invMass + b.invMass;
  if (invSum === 0) return; // two dragged notes: both immovable

  let nx = 0;
  let ny = 0;
  let pen = 0;
  if (ox < oy) {
    nx = dx < 0 ? -1 : 1; // contact normal points from a to b
    pen = ox;
  } else {
    ny = dy < 0 ? -1 : 1;
    pen = oy;
  }

  // push the pair apart, share by inverse mass
  const corr = pen / invSum;
  a.cx -= nx * corr * a.invMass;
  a.cy -= ny * corr * a.invMass;
  b.cx += nx * corr * b.invMass;
  b.cy += ny * corr * b.invMass;

  const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rvn > 0) return; // already separating
  const j = (-(1 + NOTE_RESTITUTION) * rvn) / invSum;
  a.vx -= j * a.invMass * nx;
  a.vy -= j * a.invMass * ny;
  b.vx += j * b.invMass * nx;
  b.vy += j * b.invMass * ny;

  // tangential slip becomes a little spin so hits read as tumbles
  const slip = nx !== 0 ? b.vy - a.vy : b.vx - a.vx;
  a.vrot -= slip * 0.04;
  b.vrot += slip * 0.04;
}

interface NoteWorld {
  svg: SVGSVGElement;
  add: (n: PhysNote) => void;
  count: () => number;
}

// one rAF loop integrating + colliding + culling every live note; idles when
// the field empties and restarts on the next add (static field never starts)
function createNoteWorld(svg: SVGSVGElement, staticField: boolean): NoteWorld {
  let notes: PhysNote[] = [];
  let running = false;
  let last = 0;

  const frame = (now: number): void => {
    const dt = Math.min(now - last, MAX_STEP_MS);
    last = now;

    for (const n of notes) {
      if (n.dragging) continue;
      n.vy += GRAVITY * dt;
      n.cx += n.vx * dt;
      n.cy += n.vy * dt;
      n.rot += n.vrot * dt;
    }

    for (let it = 0; it < COLLISION_ITERS; it++) {
      for (let i = 0; i < notes.length; i++) {
        for (let j = i + 1; j < notes.length; j++) collide(notes[i], notes[j]);
      }
    }

    const alive: PhysNote[] = [];
    for (const n of notes) {
      if (!n.dragging && offscreen(n)) {
        n.el.remove();
        continue;
      }
      renderNote(n);
      alive.push(n);
    }
    notes = alive;

    if (notes.length > 0) requestAnimationFrame(frame);
    else running = false;
  };

  const start = (): void => {
    if (running || staticField) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  };

  return {
    svg,
    add: (n) => {
      svg.appendChild(n.el);
      notes.push(n);
      start();
    },
    count: () => notes.length,
  };
}

function spawnNote(world: NoteWorld, assets: Map<NoteKind, NoteAsset>, initial: boolean, staticField: boolean): void {
  if (world.count() >= MAX_ELEMENTS) return;
  const asset = assets.get(pickNoteKind()) ?? assets.get("quarter");
  if (!asset) return;

  const s = (NOTE_BASE_H / asset.viewBoxH) * rand(0.8, 1.9);
  const hw = (asset.viewBoxW * s) / 2;
  const hh = (asset.viewBoxH * s) / 2;

  const note = document.createElementNS(SVG_NS, "g");
  note.setAttribute("class", "floating-note");
  const glyph = buildNoteGlyph(asset);
  note.appendChild(glyph);
  // parts are solid teal; the group alone carries the translucency so
  // head/stem/flag overlaps composite evenly (same trick as the clouds)
  note.style.opacity = rand(0.2, 0.4).toFixed(2);

  const mass = hw * hh; // ∝ area, so big notes shove little ones convincingly
  const n: PhysNote = {
    el: note,
    glyph,
    s,
    vbW: asset.viewBoxW,
    vbH: asset.viewBoxH,
    hw,
    hh,
    mass,
    invMass: 1 / mass,
    cx: rand(hw + 20, VIEW_W - hw - 20),
    // static: scattered in view; initial: spread down the field so it starts
    // populated; otherwise drop in from just above the top edge
    cy: staticField ? rand(hh, VIEW_H - hh) : initial ? rand(-hh, VIEW_H * 0.7) : -(hh + 10),
    vx: staticField ? 0 : rand(-0.02, 0.02),
    vy: staticField ? 0 : rand(0.01, 0.03),
    rot: rand(-20, 20),
    vrot: staticField ? 0 : rand(-0.015, 0.015),
    dragging: false,
  };
  renderNote(n);
  makeNoteDraggable(world.svg, n);
  world.add(n);
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): DOMPoint {
  const ctm = svg.getScreenCTM();
  const point = new DOMPoint(clientX, clientY);
  return ctm === null ? point : point.matrixTransform(ctm.inverse());
}

// drag a note and release it to throw it: dragging pins the body to the cursor
// (immovable, infinite mass) and release hands the sampled velocity back to the
// physics loop, so a flick carries momentum and a slow drop just keeps falling
function makeNoteDraggable(svg: SVGSVGElement, n: PhysNote): void {
  let drag: { offX: number; offY: number; samples: { t: number; x: number; y: number }[] } | null = null;

  n.el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    n.dragging = true;
    n.invMass = 0; // immovable while held, but still shoves what it bumps
    n.vx = 0;
    n.vy = 0;
    n.vrot = 0;
    svg.appendChild(n.el); // raise above the other notes while held

    const p = svgPoint(svg, e.clientX, e.clientY);
    drag = { offX: p.x - n.cx, offY: p.y - n.cy, samples: [{ t: e.timeStamp, x: p.x, y: p.y }] };
    n.el.classList.add("dragging");
    n.el.setPointerCapture(e.pointerId);
  });

  n.el.addEventListener("pointermove", (e) => {
    if (drag === null) return;
    const p = svgPoint(svg, e.clientX, e.clientY);
    n.cx = p.x - drag.offX;
    n.cy = p.y - drag.offY;
    renderNote(n); // immediate, so it tracks even when the loop is idle (static)
    // velocity window: keep only the last ~100 ms of movement
    drag.samples.push({ t: e.timeStamp, x: p.x, y: p.y });
    while (drag.samples.length > 1 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
  });

  const release = (e: PointerEvent): void => {
    if (drag === null) return;
    const first = drag.samples[0];
    const dt = Math.max(e.timeStamp - first.t, 1);
    const last = drag.samples[drag.samples.length - 1];
    // a pointer that rested before release means a still drop, not a throw
    const rested = e.timeStamp - last.t > 120;
    let vx = rested ? 0 : (last.x - first.x) / dt;
    let vy = rested ? 0 : (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_THROW_SPEED) {
      vx *= MAX_THROW_SPEED / speed;
      vy *= MAX_THROW_SPEED / speed;
    }
    n.vx = vx;
    n.vy = vy;
    n.vrot = Math.max(-0.05, Math.min(0.05, vx * 0.03)); // horizontal flick → tumble
    n.dragging = false;
    n.invMass = 1 / n.mass;
    n.el.classList.remove("dragging");
    drag = null;
  };
  n.el.addEventListener("pointerup", release);
  n.el.addEventListener("pointercancel", release);
}

function scheduleSpawns(spawn: () => void, baseMs: number): void {
  const tick = (): void => {
    spawn();
    window.setTimeout(tick, baseMs * rand(1 - SPAWN_JITTER, 1 + SPAWN_JITTER));
  };
  window.setTimeout(tick, baseMs * rand(0.2, 1));
}

export function initBgSky(): void {
  const svg = document.querySelector<SVGSVGElement>(".bg-sky");
  if (svg === null) return;

  // without animation the spawn positions sit off-screen, so reduced motion
  // gets a static in-view field instead of the rising/falling loop
  const staticField = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const nightLayer = buildNightLayer();
  svg.appendChild(nightLayer); // appended first so it stays behind clouds/notes

  // the dial angle only ever grows (+180° per theme switch) so the wheel
  // always turns clockwise: both bodies set on the right and rise from the
  // left; CSS owns the transition, this observer owns the angle
  const dial = buildSkyDial();
  const root = document.documentElement;
  let dark = root.classList.contains("theme-dark");
  let dialAngle = dark ? 0 : 180;
  dial.style.transform = `rotate(${dialAngle}deg)`;
  svg.appendChild(dial);
  new MutationObserver(() => {
    const nowDark = root.classList.contains("theme-dark");
    if (nowDark === dark) return; // ignore unrelated class flips (e.g. lang-jp)
    dark = nowDark;
    dialAngle += 180;
    dial.style.transform = `rotate(${dialAngle}deg)`;
  }).observe(root, { attributes: true, attributeFilter: ["class"] });

  // clouds live in their own group so CSS can fade them all out at night;
  // they keep spawning while hidden, so switching back to day is populated
  const cloudLayer = document.createElementNS(SVG_NS, "g");
  cloudLayer.setAttribute("class", "cloud-layer");
  svg.appendChild(cloudLayer);

  for (let i = 0; i < INITIAL_CLOUDS; i++) spawnCloud(cloudLayer, true, staticField);
  const noteWorld = createNoteWorld(svg, staticField);
  void loadNoteAssets().then(noteAssets => {
    for (let i = 0; i < INITIAL_NOTES; i++) spawnNote(noteWorld, noteAssets, true, staticField);
    if (!staticField) scheduleSpawns(() => spawnNote(noteWorld, noteAssets, false, false), NOTE_SPAWN_MS);
  });
  if (staticField) return;

  scheduleSpawns(() => spawnCloud(cloudLayer, false, false), CLOUD_SPAWN_MS);
  scheduleSpawns(() => spawnShootingStar(nightLayer), SHOOTING_STAR_SPAWN_MS);
}
