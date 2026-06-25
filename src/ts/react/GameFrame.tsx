import { memo, useEffect, useState } from "react";
import type { RefObject } from "react";

// cloud border drawn as one generated SVG: tiled CSS backgrounds rasterize
// per tile, leaving seam hairlines that open into gaps when the tiles
// stretch on resize. shared by the song page's game area and the home
// tutorial canvas (at a smaller scale).

// runs `draw` once per edge with that edge's length and a mapper from
// (distance along the edge, offset across the frame line — negative =
// outward) to frame coordinates
function forEachEdge(
  w: number,
  h: number,
  draw: (len: number, place: (along: number, rel: number) => [number, number]) => void,
): void {
  draw(w, (a, rel) => [a, rel]);     // top
  draw(w, (a, rel) => [a, h - rel]); // bottom
  draw(h, (a, rel) => [rel, a]);     // left
  draw(h, (a, rel) => [w - rel, a]); // right
}

// puff pattern cycled along each edge: [radius, centre offset across the
// frame line]
const FRAME_PUFFS: ReadonlyArray<readonly [number, number]> = [[24, -2], [18, -8], [21, 1], [18, -6]];
const FRAME_STEP = 31; // target spacing between puff centres

// `stepScale` widens the gap between puffs without changing their size, so a
// frame can read less busy (fewer, more separated puffs) while keeping or
// growing the circle radius via `s`. Defaults to 1 (unchanged for the game area).
function frameCircles(w: number, h: number, s: number, stepScale = 1): Array<{ cx: number; cy: number; r: number }> {
  const circles: Array<{ cx: number; cy: number; r: number }> = [];
  forEachEdge(w, h, (len, place) => {
    const n = Math.max(4, Math.round(len / (FRAME_STEP * s * stepScale)));
    for (let i = 0; i <= n; i++) {
      const [r, rel] = FRAME_PUFFS[i % FRAME_PUFFS.length];
      const [cx, cy] = place((i * len) / n, rel * s);
      circles.push({ cx, cy, r: r * s });
    }
  });
  // corner clusters: a big blob on each corner plus a small puff diagonally
  // inward, bridging the edge rows
  for (const cx of [6 * s, w - 6 * s]) for (const cy of [6 * s, h - 6 * s]) circles.push({ cx, cy, r: 26 * s });
  for (const cx of [28 * s, w - 28 * s]) for (const cy of [28 * s, h - 28 * s]) circles.push({ cx, cy, r: 13 * s });
  return circles;
}

// four-point sparkle for the night frame (unit radius 10, scaled per star)
const STAR_PATH = "M0 -10 Q1.8 -1.8 10 0 Q1.8 1.8 0 10 Q-1.8 1.8 -10 0 Q-1.8 -1.8 0 -10 Z";
const STAR_STEP = 72;          // target spacing between stars along an edge
const STAR_CORNER_MARGIN = 64; // edge zone reserved for the corner pairs

function frameStars(w: number, h: number, s: number): Array<{ x: number; y: number; scale: number }> {
  const stars: Array<{ x: number; y: number; scale: number }> = [];
  forEachEdge(w, h, (len, place) => {
    const margin = STAR_CORNER_MARGIN * s;
    const usable = len - 2 * margin;
    if (usable <= 0) return;
    const n = Math.max(1, Math.round(usable / (STAR_STEP * s)));
    for (let i = 0; i <= n; i++) {
      const big = i % 2 === 0;
      // stars keep to the band's outer half: past the frame line they'd sit
      // behind the game area's glass blur and smear
      const [x, y] = place(margin + (i * usable) / n, (big ? -10 : -15) * s);
      stars.push({ x, y, scale: (big ? 0.9 : 0.55) * s });
    }
  });
  // one big sparkle on each corner blob's outer diagonal and a small one
  // tucked between it and the first edge star, mirrored so corners match
  const corners: ReadonlyArray<[number, number, 1 | -1, 1 | -1]> = [
    [0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    stars.push({ x: x - 4 * s * dx, y: y - 4 * s * dy, scale: 0.9 * s });
    stars.push({ x: x + 24 * s * dx, y: y - 14 * s * dy, scale: 0.55 * s });
  }
  return stars;
}

// observes an element's rendered size so the frame redraws from real pixels.
// `resetKey` lets a caller re-attach the observer when its target element is
// remounted (e.g. a conditionally-rendered host) — the ref identity is stable
// across remounts, so without it the observer would stay bound to the old,
// detached node and the size would go stale/null.
export function useElementSize(ref: RefObject<HTMLElement>, resetKey?: unknown): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize(rect.width > 0 ? { w: rect.width, h: rect.height } : null);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, resetKey]);
  return size;
}

interface Props {
  w: number;
  h: number;
  scale?: number;
  stepScale?: number;
}

// memoised: hosts re-render every score tick, but the frame only changes
// when the observed size does
export const GameFrame = memo(function GameFrame({ w, h, scale = 1, stepScale = 1 }: Props) {
  return (
    <svg className="game-frame" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {frameCircles(w, h, scale, stepScale).map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
      {frameStars(w, h, scale).map((s, i) => (
        <path
          key={i}
          className="frame-star"
          d={STAR_PATH}
          transform={`translate(${s.x} ${s.y}) scale(${s.scale})`}
        />
      ))}
    </svg>
  );
});
