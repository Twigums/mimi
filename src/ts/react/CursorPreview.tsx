import { useEffect, useRef } from "react";
import { drawCursorOrb, drawCursorParticle } from "../game/draw";
import { trailFadeToLifetimeMs, type TrailShape, type TrailDecay } from "../core/settings";

const PREVIEW_W         = 400;
const PREVIEW_H         = 300;
const MAX_PARTICLES     = 150;
const SPAWN_INTERVAL    = 8;
const MAX_SCATTER_SPEED = 0.15; // canvas px / ms

interface Particle {
  x: number;
  y: number;
  bornAt: number;
  alive: boolean;
  angle: number;
  vx: number;
  vy: number;
}

interface Props {
  r: number;
  g: number;
  b: number;
  cursorSize: number;
  trailFadeSpeed: number;
  trailShape: TrailShape;
  trailDecay: TrailDecay;
}

export function CursorPreview({ r, g, b, cursorSize, trailFadeSpeed, trailShape, trailDecay }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rRef         = useRef(r);
  const gRef         = useRef(g);
  const bRef         = useRef(b);
  const sizeRef      = useRef(cursorSize);
  const fadeRef      = useRef(trailFadeSpeed);
  const shapeRef     = useRef(trailShape);
  const decayRef     = useRef(trailDecay);

  rRef.current     = r;
  gRef.current     = g;
  bRef.current     = b;
  sizeRef.current  = cursorSize;
  fadeRef.current  = trailFadeSpeed;
  shapeRef.current = trailShape;
  decayRef.current = trailDecay;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
      x: 0, y: 0, bornAt: 0, alive: false, angle: 0, vx: 0, vy: 0,
    }));
    let nextSlot    = 0;
    let lastSpawnAt = 0;
    let rafId: number;

    const loop = (now: number): void => {
      // Lissajous path: infinity symbol
      const cx = PREVIEW_W / 2;
      const cy = PREVIEW_H / 2;
      const t  = now * 0.0008;
      const x  = cx + PREVIEW_W * 0.33 * Math.sin(t);
      const y  = cy + PREVIEW_H * 0.28 * Math.sin(2 * t + Math.PI / 2);

      const lifetime    = trailFadeToLifetimeMs(fadeRef.current);
      const activeSlots = Math.max(1, Math.ceil(lifetime / SPAWN_INTERVAL));

      if (now - lastSpawnAt >= SPAWN_INTERVAL) {
        const angle = Math.random() * Math.PI * 2;
        let vx = 0, vy = 0;
        if (decayRef.current === "scatter") {
          const speed = Math.random() * MAX_SCATTER_SPEED;
          const dir   = Math.random() * Math.PI * 2;
          vx = Math.cos(dir) * speed;
          vy = Math.sin(dir) * speed;
        }
        particles[nextSlot] = { x, y, bornAt: now, alive: true, angle, vx, vy };
        nextSlot = (nextSlot + 1) % activeSlots;
        lastSpawnAt = now;
      }

      ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

      const rgb  = `${rRef.current}, ${gRef.current}, ${bRef.current}`;
      const orbR = sizeRef.current;

      ctx.save();
      for (let i = 0; i < activeSlots; i++) {
        const p = particles[i];
        if (!p.alive) continue;
        const age = now - p.bornAt;
        if (age >= lifetime) { p.alive = false; continue; }
        const ta    = age / lifetime;
        const alpha = (1 - ta) * (1 - ta);
        const px    = p.x + p.vx * age;
        const py    = p.y + p.vy * age;
        drawCursorParticle(ctx, px, py, orbR * 0.45 * (1 - ta * 0.5), alpha, rgb, shapeRef.current, p.angle);
      }
      drawCursorOrb(ctx, x, y, orbR, rgb);
      ctx.restore();

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="cursor-preview"
      width={PREVIEW_W}
      height={PREVIEW_H}
    />
  );
}
