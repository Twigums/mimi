import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createGame } from "../game/engine";
import type { GameHandle, NoteKind, HitResult } from "../game/engine";
import { NOTE_RADIUS } from "../game/draw";
import { JUDGEMENT_LABEL } from "../game/grade";
import { clamp } from "../core/utils";
import { arToMs } from "../core/settings";
import { withPath } from "../core/sitePath";
import { useApproachRate } from "./hooks/useSettings";
import { GameFrame, useElementSize } from "./GameFrame";

export interface TestPlayHandle {
  spawnNote(kind: NoteKind): void;
}

interface Props {
  loop?: boolean;
  variant?: "tutorial" | "panel";
  frameScale?: number;
  logicalW?: number;
  logicalH?: number;
  arOverride?: number;
}

interface Toast {
  id: number;
  result: HitResult;
  x: number;
  y: number;
}

const DEMO_CHAR  = "か";
const LOOP_KINDS: NoteKind[] = ["cut", "flow", "lyric"];
const LOOP_GAP   = 900;            // pause after a note's approach before the next spawns
const DEMO_HOLD  = 700;            // preview hold length for a spawned lyric (no chart to bound it)
const MARGIN     = NOTE_RADIUS * 2; // keep notes (and flow offsets) inside the play-field
// the demo flow pair is spaced in time relative to the approach pace: 150 ms
// reads well at AR 14, so scale that gap by approachMs / arToMs(14)
const FLOW_GAP_RATIO = 150 / arToMs(14);

let _toastId = 0;

export const TestPlay = forwardRef<TestPlayHandle, Props>(
  ({ loop = false, variant = "panel", frameScale = 0.75, logicalW = 400, logicalH = 300, arOverride }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef   = useRef<HTMLDivElement>(null);
    const gameRef   = useRef<GameHandle | null>(null);
    const clockRef  = useRef(0);
    const leadRef   = useRef(arToMs(1));
    const spawnRef  = useRef<(kind: NoteKind) => void>(() => {});
    const frameSize = useElementSize(canvasRef);

    const [liveAr] = useApproachRate();
    const ar = arOverride ?? liveAr;
    const [toasts, setToasts] = useState<Toast[]>([]);

    leadRef.current = arToMs(ar);

    useImperativeHandle(ref, () => ({
      spawnNote: (kind) => spawnRef.current(kind),
    }));

    useEffect(() => {
      gameRef.current?.setApproachMs(arToMs(ar));
    }, [ar]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const wrap   = wrapRef.current;
      if (!canvas || !wrap) return;

      const game = createGame({
        canvas,
        gameArea: wrap,
        logicalW,
        logicalH,
        lyricDemoFunnel: true,
        hitSoundUrl: withPath("/audio/snare.mp3"),
        onAccuracy:      () => {},
        onComboChange:   () => {},
        onPlayingChange: () => {},
        onFeedback: (result, x, y) => {
          const id = ++_toastId;
          setToasts(prev => [...prev, { id, result, x, y }]);
          setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 700);
        },
      });
      gameRef.current = game;
      game.setApproachMs(leadRef.current);

      const spawn = (kind: NoteKind, cx: number, cy: number): void => {
        const base      = clockRef.current + leadRef.current;
        const direction = Math.random() * Math.PI * 2;
        if (kind === "flow") {
          const spacing = NOTE_RADIUS * 1.4;
          const ox = Math.cos(direction) * spacing;
          const oy = Math.sin(direction) * spacing;
          const gap = leadRef.current * FLOW_GAP_RATIO;
          const first = game.spawnNote({ kind, time: base,       x: cx - ox, y: cy - oy, direction });
          game.spawnNote({ kind, time: base + gap, x: cx + ox, y: cy + oy, direction, flowPrevIndex: first });
        } else {
          game.spawnNote({
            kind, time: base, x: cx, y: cy, direction,
            lyricChar: kind === "lyric" ? DEMO_CHAR : undefined,
            holdMs: kind === "lyric" ? DEMO_HOLD : undefined,
          });
        }
      };

      spawnRef.current = (kind) => spawn(kind, logicalW / 2, logicalH / 2);

      let start = 0;
      let kindIndex = 0;
      let nextSpawnAt = 0;
      let rafId = 0;

      const loopFn = (now: number): void => {
        if (start === 0) start = now;
        const clock = now - start;
        clockRef.current = clock;

        if (loop && clock >= nextSpawnAt) {
          const kind = LOOP_KINDS[kindIndex % LOOP_KINDS.length];
          kindIndex++;
          spawn(
            kind,
            clamp(MARGIN + Math.random() * (logicalW - 2 * MARGIN), MARGIN, logicalW - MARGIN),
            clamp(MARGIN + Math.random() * (logicalH - 2 * MARGIN), MARGIN, logicalH - MARGIN),
          );
          nextSpawnAt = clock + leadRef.current + LOOP_GAP;
        }

        game.tick(clock);
        rafId = requestAnimationFrame(loopFn);
      };
      rafId = requestAnimationFrame(loopFn);

      return () => {
        cancelAnimationFrame(rafId);
        spawnRef.current = () => {};
        gameRef.current = null;
        game.destroy();
      };
    }, [loop, logicalW, logicalH]);

    return (
      <div ref={wrapRef} className={`testplay-wrap testplay-wrap--${variant}`}>
        {frameSize && <GameFrame w={frameSize.w} h={frameSize.h} scale={frameScale} />}
        <canvas ref={canvasRef} className="testplay-canvas" />
        {toasts.map(t => (
          <div
            key={t.id}
            className={`hit-feedback hit-${t.result}`}
            style={{ left: `${(t.x / logicalW) * 100}%`, top: `${(t.y / logicalH) * 100}%` }}
          >
            {JUDGEMENT_LABEL[t.result]}
          </div>
        ))}
      </div>
    );
  },
);

TestPlay.displayName = "TestPlay";
