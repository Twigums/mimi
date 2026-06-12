import { useEffect, useState } from "react";
import type { RefObject } from "react";

// cloud border drawn as one generated SVG instead of tiled CSS backgrounds,
// which show seams and gaps when their tiles stretch. shared by the song
// page's game area and the home tutorial canvas (at a smaller scale).

// puff pattern, cycled along each edge: [radius, centre offset across the
// frame line] (negative = outward)
const FRAME_PUFFS: ReadonlyArray<readonly [number, number]> = [[24, -2], [18, -8], [21, 1], [18, -6]];
const FRAME_STEP = 31; // target spacing between puff centres

function frameCircles(w: number, h: number, s: number): Array<{ cx: number; cy: number; r: number }> {
  const circles: Array<{ cx: number; cy: number; r: number }> = [];
  const edge = (len: number, place: (along: number, rel: number) => [number, number]): void => {
    const n = Math.max(4, Math.round(len / (FRAME_STEP * s)));
    for (let i = 0; i <= n; i++) {
      const [r, rel] = FRAME_PUFFS[i % FRAME_PUFFS.length];
      const [cx, cy] = place((i * len) / n, rel * s);
      circles.push({ cx, cy, r: r * s });
    }
  };
  edge(w, (a, rel) => [a, rel]);     // top
  edge(w, (a, rel) => [a, h - rel]); // bottom
  edge(h, (a, rel) => [rel, a]);     // left
  edge(h, (a, rel) => [w - rel, a]); // right
  // corner clusters: a big blob on each corner plus a small puff diagonally
  // inward, bridging the edge rows
  for (const cx of [6 * s, w - 6 * s]) for (const cy of [6 * s, h - 6 * s]) circles.push({ cx, cy, r: 26 * s });
  for (const cx of [28 * s, w - 28 * s]) for (const cy of [28 * s, h - 28 * s]) circles.push({ cx, cy, r: 13 * s });
  return circles;
}

// four-point sparkle for the night frame (unit radius 10, scaled per star);
// generated alongside the circles so star rows skip a corner margin — tiled
// strips doubled stars wherever a horizontal and a vertical row met
const STAR_PATH = "M0 -10 Q1.8 -1.8 10 0 Q1.8 1.8 0 10 Q-1.8 1.8 -10 0 Q-1.8 -1.8 0 -10 Z";
const STAR_STEP = 72;          // target spacing between stars along an edge
const STAR_CORNER_MARGIN = 64; // edge zone left to the corner pairs

function frameStars(w: number, h: number, s: number): Array<{ x: number; y: number; scale: number }> {
  const stars: Array<{ x: number; y: number; scale: number }> = [];
  const edge = (len: number, place: (along: number, rel: number) => [number, number]): void => {
    const margin = STAR_CORNER_MARGIN * s;
    const usable = len - 2 * margin;
    if (usable <= 0) return;
    const n = Math.max(1, Math.round(usable / (STAR_STEP * s)));
    for (let i = 0; i <= n; i++) {
      const big = i % 2 === 0;
      // stars stay on the band's outer half: past the frame line they'd sit
      // behind the glass blur and smear
      const [x, y] = place(margin + (i * usable) / n, (big ? -10 : -15) * s);
      stars.push({ x, y, scale: (big ? 0.9 : 0.55) * s });
    }
  };
  edge(w, (a, rel) => [a, rel]);     // top
  edge(w, (a, rel) => [a, h - rel]); // bottom
  edge(h, (a, rel) => [rel, a]);     // left
  edge(h, (a, rel) => [w - rel, a]); // right
  // a deliberate pair per corner: a big sparkle on the corner blob's outer
  // diagonal and a small one tucked between it and the first edge star,
  // mirrored so every corner matches
  const corners: ReadonlyArray<[number, number, 1 | -1, 1 | -1]> = [
    [0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    stars.push({ x: x - 4 * s * dx, y: y - 4 * s * dy, scale: 0.9 * s });
    stars.push({ x: x + 24 * s * dx, y: y - 14 * s * dy, scale: 0.55 * s });
  }
  return stars;
}

// observes an element's rendered size so the frame redraws from real pixels
// and resizing can never stretch it apart
export function useElementSize(ref: RefObject<HTMLElement>): { w: number; h: number } | null {
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
  }, [ref]);
  return size;
}

interface Props {
  w: number;
  h: number;
  scale?: number;
}

export function GameFrame({ w, h, scale = 1 }: Props) {
  return (
    <svg className="game-frame" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {frameCircles(w, h, scale).map((c, i) => (
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
}
