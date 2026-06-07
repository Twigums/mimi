import { useEffect, useRef } from "react";
import { drawArrow } from "../game/draw";
import { arToMs } from "../core/settings";
import { clamp } from "../core/utils";
import type { Note } from "../game/engine";

// 4:3 canvas that matches the game's logical aspect ratio; CSS scales it down
const PREVIEW_W = 400;
const PREVIEW_H = 300;

// Static arrow at canvas centre, pointing right — only the fill animation changes
const PREVIEW_NOTE: Note = {
  kind:      "cut",
  time:      0,
  x:         PREVIEW_W / 2,
  y:         PREVIEW_H / 2,
  direction: 0,
  state:     "pending",
};

interface Props {
  ar: number;
  hidden?: boolean;
}

export function ApproachPreview({ ar, hidden = false }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  // Refs keep the rAF loop reading latest values without restarting the loop
  const arRef        = useRef(ar);
  const hiddenRef    = useRef(hidden);
  const startTimeRef = useRef<number | null>(null);

  // written during render, read only inside rAF
  arRef.current     = ar;
  hiddenRef.current = hidden;

  useEffect(() => {
    startTimeRef.current = null;
  }, [ar]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId: number;

    const loop = (timestamp: number): void => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;

      const ms           = arToMs(arRef.current);

      // Cycle = fill duration + 400ms pause so the completed arrow is briefly visible
      const cycleDuration = ms + 400;
      const elapsed       = (timestamp - startTimeRef.current) % cycleDuration;
      const appearProgress = clamp(elapsed / ms, 0, 1);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // scale=1: the preview canvas uses logical coords directly
      drawArrow(ctx, PREVIEW_NOTE, appearProgress, 1, hiddenRef.current);

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []); // AR is read via arRef

  return (
    <canvas
      ref={canvasRef}
      className="approach-preview"
      width={PREVIEW_W}
      height={PREVIEW_H}
    />
  );
}
