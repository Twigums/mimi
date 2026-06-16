import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { LOGICAL_W, LOGICAL_H } from "../game/engine";
import type { Note } from "../game/engine";
import { drawArrow, drawLyricNote, drawFireworks, NOTE_RADIUS, LYRIC_RADIUS } from "../game/draw";
import { createCursorRenderer } from "../game/cursor";
import { angleDiff, clamp } from "../core/utils";
import { GameFrame, useElementSize } from "./GameFrame";

export interface TutorialCanvasHandle {
  spawnNote(kind: Note["kind"]): void;
}

interface ActiveNote {
  note: Note;
  startMs: number;
}

interface HitAnim {
  note: Note;
  startMs: number;
}

interface JudgeAnim {
  text:    string;
  color:   string;
  x:       number;
  y:       number;
  startMs: number;
}

const JUDGE_COLORS: Record<string, string> = {
  PERFECT: "#ffd94a",
  GOOD:    "#8cf0ff",
  MISS:    "#ff6b6b",
};
const JUDGE_DURATION = 700;

const DURATION_MS    = 2500;
const NOTE_SCALE     = 3.0;
// progress=0.6 is when the note is fully filled — ideal hit moment
const HIT_PROGRESS   = 0.6;
const PERFECT_WINDOW = 0.08;  // ±200 ms at DURATION_MS=2500
const GOOD_WINDOW    = 0.18;  // ±450 ms — generous for tutorial
const DEMO_CHAR      = "か";
const ANGULAR_MARGIN = Math.PI / 6;
const CX             = LOGICAL_W / (2 * NOTE_SCALE);
const CY             = LOGICAL_H / (2 * NOTE_SCALE);

export const TutorialCanvas = forwardRef<TutorialCanvasHandle, {}>((_, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spawnRef  = useRef<(kind: Note["kind"]) => void>(() => {});
  const frameSize = useElementSize(canvasRef);

  useImperativeHandle(ref, () => ({
    spawnNote: (kind) => spawnRef.current(kind),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const setSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr  = window.devicePixelRatio || 1;
      canvas.width  = rect.width  * dpr;
      canvas.height = rect.height * dpr;
    };
    setSize();
    window.addEventListener("resize", setSize);

    const cursor      = createCursorRenderer(canvas);
    const activeNotes: ActiveNote[]  = [];
    const hitAnims:    HitAnim[]     = [];
    const judgeAnims:  JudgeAnim[]   = [];
    let rafId: number;

    const pushJudge = (text: string, x: number, y: number, now: number): void => {
      judgeAnims.push({ text, color: JUDGE_COLORS[text] ?? "#fff", x, y, startMs: now });
    };

    const pointer = { x: 0, y: 0, prevX: 0, prevY: 0, held: false };

    const toLogical = (clientX: number, clientY: number): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [
        (clientX - rect.left) * (LOGICAL_W / rect.width)  / NOTE_SCALE,
        (clientY - rect.top)  * (LOGICAL_H / rect.height) / NOTE_SCALE,
      ];
    };

    const onMouseMove  = (e: MouseEvent): void => { [pointer.x, pointer.y] = toLogical(e.clientX, e.clientY); };
    const onMouseDown  = (e: MouseEvent): void => { [pointer.x, pointer.y] = toLogical(e.clientX, e.clientY); pointer.held = true; };
    const onMouseUp    = (): void => { pointer.held = false; };
    const onTouchMove  = (e: TouchEvent): void => { const t = e.touches[0]; if (t) [pointer.x, pointer.y] = toLogical(t.clientX, t.clientY); e.preventDefault(); };
    const onTouchStart = (e: TouchEvent): void => { const t = e.touches[0]; if (t) { [pointer.x, pointer.y] = toLogical(t.clientX, t.clientY); pointer.held = true; } e.preventDefault(); };
    const onTouchEnd   = (): void => { pointer.held = false; };

    canvas.addEventListener("mousemove",  onMouseMove);
    canvas.addEventListener("mousedown",  onMouseDown);
    window.addEventListener("mouseup",    onMouseUp);
    canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchend",   onTouchEnd);

    const tryHit = (note: Note, progress: number): "PERFECT" | "GOOD" | null => {
      const delta = progress - HIT_PROGRESS;
      if (Math.abs(delta) > GOOD_WINDOW) return null;

      if (note.kind === "lyric") {
        const moveDx = pointer.x - pointer.prevX;
        const moveDy = pointer.y - pointer.prevY;
        const lenSq  = moveDx * moveDx + moveDy * moveDy;
        if (lenSq < 0.5) return null;
        const t = clamp(
          ((note.x - pointer.prevX) * moveDx + (note.y - pointer.prevY) * moveDy) / lenSq,
          0, 1,
        );
        const closestX = pointer.prevX + t * moveDx;
        const closestY = pointer.prevY + t * moveDy;
        if ((closestX - note.x) ** 2 + (closestY - note.y) ** 2 > LYRIC_RADIUS * LYRIC_RADIUS) return null;
      } else {
        const dx    = Math.cos(note.direction);
        const dy    = Math.sin(note.direction);
        const pPrev = (pointer.prevX - note.x) * dx + (pointer.prevY - note.y) * dy;
        const pCurr = (pointer.x     - note.x) * dx + (pointer.y     - note.y) * dy;
        if (pPrev >= 0 || pCurr < 0) return null;
        const perpPrev = -(pointer.prevX - note.x) * dy + (pointer.prevY - note.y) * dx;
        const perpCurr = -(pointer.x     - note.x) * dy + (pointer.y     - note.y) * dx;
        const perpAtCross = perpPrev + (perpCurr - perpPrev) * (-pPrev / (pCurr - pPrev));
        if (Math.abs(perpAtCross) > NOTE_RADIUS) return null;
        const moveDx = pointer.x - pointer.prevX;
        const moveDy = pointer.y - pointer.prevY;
        if (moveDx * moveDx + moveDy * moveDy < 0.5) return null;
        if (Math.abs(angleDiff(Math.atan2(moveDy, moveDx), note.direction)) > ANGULAR_MARGIN) return null;
      }

      return Math.abs(delta) <= PERFECT_WINDOW ? "PERFECT" : "GOOD";
    };

    const loop = () => {
      const now   = performance.now();
      const scale = (canvas.width / LOGICAL_W) * NOTE_SCALE;

      for (let i = activeNotes.length - 1; i >= 0; i--) {
        const { note, startMs } = activeNotes[i];
        const progress = (now - startMs) / DURATION_MS;
        if (progress > HIT_PROGRESS + GOOD_WINDOW) {
          pushJudge("MISS", note.x, note.y, now);
          activeNotes.splice(i, 1);
          continue;
        }
        const result = tryHit(note, progress);
        if (result !== null) {
          hitAnims.push({ note: { ...note }, startMs: now });
          pushJudge(result, note.x, note.y, now);
          activeNotes.splice(i, 1);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = activeNotes.length - 1; i >= 0; i--) {
        const { note, startMs } = activeNotes[i];
        const progress = (now - startMs) / DURATION_MS;
        const appearProgress = Math.min(progress / 0.6, 1);
        const alpha = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        if (note.kind === "lyric") {
          drawLyricNote(ctx, note, appearProgress, scale, false);
        } else {
          drawArrow(ctx, note, appearProgress, scale, false);
        }
        ctx.restore();
      }

      for (let i = hitAnims.length - 1; i >= 0; i--) {
        const { note, startMs } = hitAnims[i];
        const dt = now - startMs;
        if (dt >= 300) { hitAnims.splice(i, 1); continue; }
        drawFireworks(ctx, note.x, note.y, note.kind, dt / 300, scale, Math.floor(note.x * 7919 + note.y * 6271));
      }

      for (let i = judgeAnims.length - 1; i >= 0; i--) {
        const { text, color, x, y, startMs } = judgeAnims[i];
        const t = (now - startMs) / JUDGE_DURATION;
        if (t >= 1) { judgeAnims.splice(i, 1); continue; }
        const alpha = 1 - t * t;
        const rise  = t * 28 * scale;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle    = color;
        ctx.font         = `bold ${Math.round(13 * scale)}px sans-serif`;
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, x * scale, y * scale - rise);
        ctx.restore();
      }

      cursor.render(now);
      pointer.prevX = pointer.x;
      pointer.prevY = pointer.y;
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    spawnRef.current = (kind: Note["kind"]) => {
      const direction = Math.random() * Math.PI * 2;
      const now       = performance.now();
      if (kind === "flow") {
        const spacing = NOTE_RADIUS * 1.4;
        const offX    = Math.cos(direction) * spacing;
        const offY    = Math.sin(direction) * spacing;
        const offsets: [number, number, number][] = [[-offX, -offY, 0], [offX, offY, 75]];
        for (const [ox, oy, delay] of offsets) {
          activeNotes.push({
            note: { kind, time: 0, x: CX + ox, y: CY + oy, direction, state: "pending" },
            startMs: now + delay,
          });
        }
      } else {
        const note: Note = { kind, time: 0, x: CX, y: CY, direction, state: "pending" };
        if (kind === "lyric") note.lyricChar = DEMO_CHAR;
        activeNotes.push({ note, startMs: now });
      }
    };

    return () => {
      cancelAnimationFrame(rafId);
      cursor.destroy();
      window.removeEventListener("resize", setSize);
      window.removeEventListener("mouseup",   onMouseUp);
      window.removeEventListener("touchend",  onTouchEnd);
      canvas.removeEventListener("mousemove",  onMouseMove);
      canvas.removeEventListener("mousedown",  onMouseDown);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchstart", onTouchStart);
      spawnRef.current = () => {};
    };
  }, []);

  // the wrap hosts the cloud frame, which must sit outside the canvas box
  return (
    <div className="tutorial-canvas-wrap">
      {frameSize && <GameFrame w={frameSize.w} h={frameSize.h} scale={0.75} />}
      <canvas ref={canvasRef} className="tutorial-canvas" />
    </div>
  );
});

TutorialCanvas.displayName = "TutorialCanvas";
