import { drawCursorOrb, drawCursorParticle } from "./draw";
import {
  loadCursorSize, subscribeCursorSize,
  loadCursorR, subscribeCursorR,
  loadCursorG, subscribeCursorG,
  loadCursorB, subscribeCursorB,
  loadTrailFadeSpeed, subscribeTrailFadeSpeed,
  loadTrailShape, subscribeTrailShape,
  loadTrailDecay, subscribeTrailDecay,
  trailFadeToLifetimeMs,
  type TrailShape, type TrailDecay,
} from "../core/settings";

interface TrailParticle {
  x: number;
  y: number;
  bornAt: number;
  alive: boolean;
  angle: number;
  vx: number;
  vy: number;
}

const MAX_PARTICLES      = 150;
const SPAWN_INTERVAL_MS  = 8;
const MAX_SCATTER_SPEED  = 0.15; // canvas px / ms

export interface CursorRenderer {
  render(now: number): void;
  destroy(): void;
}

export function createCursorRenderer(canvas: HTMLCanvasElement): CursorRenderer {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const particles: TrailParticle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    x: 0, y: 0, bornAt: 0, alive: false, angle: 0, vx: 0, vy: 0,
  }));
  let nextSlot    = 0;
  let lastSpawnAt = 0;
  let visible     = false;
  let canvasX     = 0;
  let canvasY     = 0;

  let cursorSize = loadCursorSize();
  let cursorR    = loadCursorR();
  let cursorG    = loadCursorG();
  let cursorB    = loadCursorB();
  let fadeSpeed  = loadTrailFadeSpeed();
  let trailShape: TrailShape = loadTrailShape();
  let trailDecay: TrailDecay = loadTrailDecay();

  const toCanvasCoords = (clientX: number, clientY: number): [number, number] => {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
  };

  const activeSlots = (): number =>
    Math.max(1, Math.ceil(trailFadeToLifetimeMs(fadeSpeed) / SPAWN_INTERVAL_MS));

  const spawnParticle = (x: number, y: number, now: number): void => {
    if (now - lastSpawnAt < SPAWN_INTERVAL_MS) return;
    lastSpawnAt = now;
    const angle = Math.random() * Math.PI * 2;
    let vx = 0, vy = 0;
    if (trailDecay === "scatter") {
      const speed = Math.random() * MAX_SCATTER_SPEED;
      const dir   = Math.random() * Math.PI * 2;
      vx = Math.cos(dir) * speed;
      vy = Math.sin(dir) * speed;
    }
    particles[nextSlot] = { x, y, bornAt: now, alive: true, angle, vx, vy };
    nextSlot = (nextSlot + 1) % activeSlots();
  };

  const onPointerMove  = (e: PointerEvent): void => {
    const [cx, cy] = toCanvasCoords(e.clientX, e.clientY);
    spawnParticle(cx, cy, performance.now());
    canvasX = cx;
    canvasY = cy;
  };
  const onPointerEnter = (e: PointerEvent): void => {
    [canvasX, canvasY] = toCanvasCoords(e.clientX, e.clientY);
    visible = true;
  };
  const onPointerLeave = (): void => { visible = false; };

  canvas.addEventListener("pointermove",  onPointerMove);
  canvas.addEventListener("pointerenter", onPointerEnter);
  canvas.addEventListener("pointerleave", onPointerLeave);

  const unsubSize  = subscribeCursorSize(v     => { cursorSize  = v; });
  const unsubR     = subscribeCursorR(v        => { cursorR     = v; });
  const unsubG     = subscribeCursorG(v        => { cursorG     = v; });
  const unsubB     = subscribeCursorB(v        => { cursorB     = v; });
  const unsubFade  = subscribeTrailFadeSpeed(v => { fadeSpeed   = v; });
  const unsubShape = subscribeTrailShape(v     => { trailShape  = v; });
  const unsubDecay = subscribeTrailDecay(v     => { trailDecay  = v; });

  return {
    render(now: number): void {
      const rgb      = `${cursorR}, ${cursorG}, ${cursorB}`;
      const lifetime = trailFadeToLifetimeMs(fadeSpeed);
      const rect     = canvas.getBoundingClientRect();
      const dpr      = rect.width > 0 ? canvas.width / rect.width : 1;
      const orbR     = cursorSize * dpr;

      ctx.save();
      for (let i = 0; i < activeSlots(); i++) {
        const p = particles[i];
        if (!p.alive) continue;
        const age = now - p.bornAt;
        if (age >= lifetime) { p.alive = false; continue; }
        const t     = age / lifetime;
        const alpha = (1 - t) * (1 - t);
        const px    = p.x + p.vx * age;
        const py    = p.y + p.vy * age;
        drawCursorParticle(ctx, px, py, orbR * 0.45 * (1 - t * 0.5), alpha, rgb, trailShape, p.angle);
      }
      if (visible) {
        drawCursorOrb(ctx, canvasX, canvasY, orbR, rgb);
      }
      ctx.restore();
    },

    destroy(): void {
      canvas.removeEventListener("pointermove",  onPointerMove);
      canvas.removeEventListener("pointerenter", onPointerEnter);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      unsubSize();
      unsubR();
      unsubG();
      unsubB();
      unsubFade();
      unsubShape();
      unsubDecay();
    },
  };
}
