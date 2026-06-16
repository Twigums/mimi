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
const STAR_COUNT = 26;
// hub of the celestial dial, far below the horizon; must match the
// .sky-dial transform-origin in _home.scss
const DIAL_CX = VIEW_W / 2;
const DIAL_CY = 3000;

type NoteKind = "quarter" | "eighth" | "beamed" | "half" | "whole";

// quarter notes make up half the sky; the rest split the remainder evenly
const NOTE_KINDS: ReadonlyArray<{ kind: NoteKind; weight: number }> = [
  { kind: "quarter", weight: 0.5 },
  { kind: "eighth", weight: 0.125 },
  { kind: "beamed", weight: 0.125 },
  { kind: "half", weight: 0.125 },
  { kind: "whole", weight: 0.125 },
];

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

// glyphs are drawn from primitives (styled in _home.scss) so every note kind
// renders identically across platforms — musical Unicode glyphs often don't
function buildNoteGlyph(kind: NoteKind): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  const head = (cx: number, cy: number, open: boolean): SVGEllipseElement =>
    el("ellipse", {
      class: open ? "note-open" : "note-fill",
      cx: String(cx),
      cy: String(cy),
      rx: "10",
      ry: "7",
      transform: `rotate(-20 ${cx} ${cy})`,
    });
  const stem = (x: number, yTop: number, yBottom: number): SVGPathElement =>
    el("path", { class: "note-stem", d: `M${x} ${yBottom} V${yTop}` });

  switch (kind) {
    case "whole":
      g.appendChild(head(14, 28, true));
      break;
    case "half":
      g.appendChild(head(10, 48, true));
      g.appendChild(stem(19, 4, 46));
      break;
    case "quarter":
      g.appendChild(head(10, 48, false));
      g.appendChild(stem(19, 4, 46));
      break;
    case "eighth":
      g.appendChild(head(10, 48, false));
      g.appendChild(stem(19, 4, 46));
      // flag is a filled shape whose edges meet at the tip, tapering the end
      g.appendChild(el("path", { class: "note-fill", d: "M19 4 C 28 8, 32 16, 29 26 C 29 18, 26 10, 19 10 Z" }));
      break;
    case "beamed":
      g.appendChild(head(10, 50, false));
      g.appendChild(head(32, 45, false));
      g.appendChild(stem(19, 8, 48));
      g.appendChild(stem(41, 3, 43));
      // beam is a filled quad running flush from stem edge to stem edge,
      // thick enough to swallow the stems' round caps underneath
      g.appendChild(el("path", { class: "note-fill", d: "M17.5 4.8 L42.5 -0.8 L42.5 6.2 L17.5 11.8 Z" }));
      break;
  }
  // invisible grab area covering every glyph kind — Chrome lacks
  // pointer-events: bounding-box, so the gaps between head/stem need this
  g.appendChild(el("rect", { class: "note-hit", x: "-8", y: "-8", width: "64", height: "72" }));
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

function spawnNote(svg: SVGSVGElement, initial: boolean, staticField: boolean): void {
  if (svg.childElementCount >= MAX_ELEMENTS) return;
  const scale = rand(0.8, 1.9);
  const height = NOTE_BASE_H * scale;
  const pos = {
    x: rand(60, VIEW_W - 60),
    y: staticField ? rand(height, VIEW_H - height) : -(height + 10),
  };
  const tilt = rand(-20, 20);

  const note = document.createElementNS(SVG_NS, "g");
  note.setAttribute("class", "floating-note");
  const glyph = buildNoteGlyph(pickNoteKind());
  const applyPos = (): void => {
    glyph.setAttribute(
      "transform",
      `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)}) scale(${scale.toFixed(2)}) rotate(${tilt.toFixed(0)})`,
    );
  };
  applyPos();
  note.appendChild(glyph);
  // parts are solid teal; the group alone carries the translucency so
  // head/stem/flag overlaps composite evenly (same trick as the clouds)
  note.style.opacity = rand(0.2, 0.4).toFixed(2);

  if (!staticField) {
    note.style.setProperty("--fall-y", `${(VIEW_H + 2 * height + 20).toFixed(0)}px`);
    note.style.setProperty("--sway-x", `${rand(-120, 120).toFixed(0)}px`);
    note.style.setProperty("--spin", `${rand(-25, 25).toFixed(0)}deg`);
    const duration = rand(20, 36);
    note.style.animationDuration = `${duration.toFixed(1)}s`;
    if (initial) note.style.animationDelay = `-${rand(0, duration * 0.9).toFixed(1)}s`;
    note.addEventListener("animationend", () => note.remove());
  }

  makeNoteDraggable(svg, note, pos, applyPos);
  svg.appendChild(note);
}

function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): DOMPoint {
  const ctm = svg.getScreenCTM();
  const point = new DOMPoint(clientX, clientY);
  return ctm === null ? point : point.matrixTransform(ctm.inverse());
}

// drag a note and release it to throw it along the drag direction, replacing
// the random fall trajectory it would otherwise have taken
function makeNoteDraggable(
  svg: SVGSVGElement,
  note: SVGGElement,
  pos: { x: number; y: number },
  applyPos: () => void,
): void {
  let drag: { offX: number; offY: number; samples: { t: number; x: number; y: number }[] } | null = null;

  note.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // bake the current animated offset into the glyph position by comparing
    // rendered centers before/after dropping all motion (exact even
    // mid-rotation); the grabbed note straightens in your hand
    const before = note.getBoundingClientRect();
    note.style.animation = "none"; // detaches the CSS fall
    // a re-grabbed note may still be on a WAAPI throw flight — cancel it,
    // or it keeps offsetting the note and its finish handler removes it
    for (const a of note.getAnimations()) a.cancel();
    note.style.transform = "none";
    const after = note.getBoundingClientRect();
    const ctm = svg.getScreenCTM();
    pos.x += ((before.x + before.width / 2) - (after.x + after.width / 2)) / (ctm === null ? 1 : ctm.a);
    pos.y += ((before.y + before.height / 2) - (after.y + after.height / 2)) / (ctm === null ? 1 : ctm.d);
    applyPos();
    svg.appendChild(note); // raise above the other notes while held

    const p = svgPoint(svg, e.clientX, e.clientY);
    drag = { offX: p.x - pos.x, offY: p.y - pos.y, samples: [{ t: e.timeStamp, x: p.x, y: p.y }] };
    note.classList.add("dragging");
    note.setPointerCapture(e.pointerId);
  });

  note.addEventListener("pointermove", (e) => {
    if (drag === null) return;
    const p = svgPoint(svg, e.clientX, e.clientY);
    pos.x = p.x - drag.offX;
    pos.y = p.y - drag.offY;
    applyPos();
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
    throwNote(note, rested ? 0 : (last.x - first.x) / dt, rested ? 0 : (last.y - first.y) / dt);
    note.classList.remove("dragging");
    drag = null;
  };
  note.addEventListener("pointerup", release);
  note.addEventListener("pointercancel", release);
}

// launch along the release velocity (SVG units/ms) far enough to exit the
// viewBox from anywhere, spinning as it flies
function throwNote(note: SVGGElement, vx: number, vy: number): void {
  const speed = Math.hypot(vx, vy);
  // direction of flight; a still release simply resumes falling
  const still = speed < 0.05;
  const ux = still ? 0 : vx / speed;
  const uy = still ? 1 : vy / speed;
  // pace: a still or slow release drifts at natural fall speed, and violent
  // flicks are capped so they read as a visible streak instead of vanishing
  const pace = Math.min(Math.max(speed, 0.055), 1.6);
  const distance = 2400;
  const flight = note.animate(
    [
      { transform: "translate(0, 0) rotate(0deg)" },
      { transform: `translate(${(ux * distance).toFixed(0)}px, ${(uy * distance).toFixed(0)}px) rotate(${rand(-360, 360).toFixed(0)}deg)` },
    ],
    { duration: distance / pace, easing: "linear", fill: "forwards" },
  );
  flight.addEventListener("finish", () => note.remove());
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
  for (let i = 0; i < INITIAL_NOTES; i++) spawnNote(svg, true, staticField);
  if (staticField) return;

  scheduleSpawns(() => spawnCloud(cloudLayer, false, false), CLOUD_SPAWN_MS);
  scheduleSpawns(() => spawnNote(svg, false, false), NOTE_SPAWN_MS);
  scheduleSpawns(() => spawnShootingStar(nightLayer), SHOOTING_STAR_SPAWN_MS);
}
