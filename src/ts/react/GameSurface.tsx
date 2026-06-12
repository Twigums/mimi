import { useEffect, useRef, useState } from "react";
import { createGame, LOGICAL_W, LOGICAL_H } from "../game/engine";
import type { GameHandle, HitResult, GameStats } from "../game/engine";
import type { BreakSkipKind } from "../song/controller";
import { arToMs } from "../core/settings";
import { useLang } from "./hooks/useLang";
import { useApproachRate } from "./hooks/useSettings";
import { ResultsOverlay } from "./ResultsOverlay";
import { OptionsPanel } from "./OptionsPanel";

let _toastId = 0;

// cloud border puff pattern, cycled along each edge: [radius, centre offset
// across the frame line] (negative = outward). drawn as one SVG instead of
// tiled CSS backgrounds, which show seams and gaps when their tiles stretch
const FRAME_PUFFS: ReadonlyArray<readonly [number, number]> = [[24, -2], [18, -8], [21, 1], [18, -6]];
const FRAME_STEP = 31; // target spacing between puff centres

function frameCircles(w: number, h: number): Array<{ cx: number; cy: number; r: number }> {
  const circles: Array<{ cx: number; cy: number; r: number }> = [];
  const edge = (len: number, place: (along: number, rel: number) => [number, number]): void => {
    const n = Math.max(4, Math.round(len / FRAME_STEP));
    for (let i = 0; i <= n; i++) {
      const [r, rel] = FRAME_PUFFS[i % FRAME_PUFFS.length];
      const [cx, cy] = place((i * len) / n, rel);
      circles.push({ cx, cy, r });
    }
  };
  edge(w, (a, rel) => [a, rel]);     // top
  edge(w, (a, rel) => [a, h - rel]); // bottom
  edge(h, (a, rel) => [rel, a]);     // left
  edge(h, (a, rel) => [w - rel, a]); // right
  // corner clusters: a big blob on each corner plus a small puff diagonally
  // inward, bridging the edge rows
  for (const cx of [6, w - 6]) for (const cy of [6, h - 6]) circles.push({ cx, cy, r: 26 });
  for (const cx of [28, w - 28]) for (const cy of [28, h - 28]) circles.push({ cx, cy, r: 13 });
  return circles;
}

// four-point sparkle for the night frame (unit radius 10, scaled per star);
// generated alongside the circles so star rows skip a corner margin — tiled
// strips doubled stars wherever a horizontal and a vertical row met
const STAR_PATH = "M0 -10 Q1.8 -1.8 10 0 Q1.8 1.8 0 10 Q-1.8 1.8 -10 0 Q-1.8 -1.8 0 -10 Z";
const STAR_STEP = 72;          // target spacing between stars along an edge
const STAR_CORNER_MARGIN = 64; // edge zone left bare around each corner

function frameStars(w: number, h: number): Array<{ x: number; y: number; scale: number }> {
  const stars: Array<{ x: number; y: number; scale: number }> = [];
  const edge = (len: number, place: (along: number, rel: number) => [number, number]): void => {
    const usable = len - 2 * STAR_CORNER_MARGIN;
    if (usable <= 0) return;
    const n = Math.max(1, Math.round(usable / STAR_STEP));
    for (let i = 0; i <= n; i++) {
      const big = i % 2 === 0;
      // stars stay on the band's outer half: past the frame line they'd sit
      // behind the glass blur and smear
      const [x, y] = place(STAR_CORNER_MARGIN + (i * usable) / n, big ? -10 : -15);
      stars.push({ x, y, scale: big ? 0.9 : 0.55 });
    }
  };
  edge(w, (a, rel) => [a, rel]);     // top
  edge(w, (a, rel) => [a, h - rel]); // bottom
  edge(h, (a, rel) => [rel, a]);     // left
  edge(h, (a, rel) => [w - rel, a]); // right
  // a deliberate pair per corner (the margin keeps the edge rows out): a big
  // sparkle on the corner blob's outer diagonal and a small one tucked
  // between it and the first edge star, mirrored so every corner matches
  const corners: ReadonlyArray<[number, number, 1 | -1, 1 | -1]> = [
    [0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    stars.push({ x: x - 4 * dx, y: y - 4 * dy, scale: 0.9 });
    stars.push({ x: x + 24 * dx, y: y - 14 * dy, scale: 0.55 });
  }
  return stars;
}

interface FeedbackToast {
  id: number;
  result: HitResult;
  x: number;
  y: number;
}

interface SongInfo {
  name: string;
  nameJp: string;
  author: string;
  authorJp: string;
  mapper: string;
}

interface Props {
  onReady: (
    handle: GameHandle,
    showResult: (stats: GameStats) => void,
    hideResult: () => void,
    setSongInfoJp: (nameJp: string, authorJp: string) => void,
    registerStart: (fn: () => void) => void,
    registerSkipBreak: (fn: () => void) => void,
    setPlayerReady: () => void,
    setBreakSkipKind: (kind: BreakSkipKind | null) => void,
  ) => void;
  returnHref: string;
  onTryAgain: () => void;
}

export function GameSurface({ onReady, returnHref, onTryAgain }: Props) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const gameAreaRef     = useRef<HTMLDivElement>(null);
  const gameRef         = useRef<GameHandle | null>(null);
  const comboRef        = useRef<HTMLSpanElement>(null);
  const startButtonRef  = useRef<HTMLButtonElement>(null);
  const fadeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef        = useRef<(() => void) | null>(null);
  const skipBreakRef    = useRef<(() => void) | null>(null);

  const [score, setScore]             = useState(0);
  const [combo, setCombo]             = useState(0);
  const [playing, setPlaying]         = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [infoFaded, setInfoFaded]     = useState(false);
  const [breakSkipKind, setBreakSkipKind] = useState<BreakSkipKind | null>(null);
  const [feedbacks, setFeedbacks]     = useState<FeedbackToast[]>([]);
  const [result, setResult]           = useState<GameStats | null>(null);
  const [songInfo, setSongInfo]       = useState<SongInfo>(() => {
    const b = document.body.dataset;
    return {
      name:     b.songName     ?? "",
      nameJp:   b.songNameJp   ?? "",
      author:   b.songAuthor   ?? "",
      authorJp: b.songAuthorJp ?? "",
      mapper:   b.songMapper   ?? "",
    };
  });

  const lang   = useLang();
  const [ar]   = useApproachRate();
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);

  // the cloud border redraws from the area's real pixel size, so resizing
  // can never stretch it apart
  useEffect(() => {
    const area = gameAreaRef.current;
    if (!area) return;
    const observer = new ResizeObserver(() => {
      const rect = area.getBoundingClientRect();
      setFrameSize(rect.width > 0 ? { w: rect.width, h: rect.height } : null);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (playing) {
      fadeTimerRef.current = setTimeout(() => setInfoFaded(true), 2000);
    } else {
      if (fadeTimerRef.current !== null) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
      setInfoFaded(false);
    }
    return () => {
      if (fadeTimerRef.current !== null) clearTimeout(fadeTimerRef.current);
    };
  }, [playing]);

  useEffect(() => {
    const canvas   = canvasRef.current;
    const gameArea = gameAreaRef.current;
    if (!canvas || !gameArea) return;

    const hitSoundUrl = document.body.dataset.hitSoundUrl;
    const game = createGame({
      canvas,
      gameArea,
      hitSoundUrl,
      onScore: setScore,
      onComboChange: setCombo,
      onPlayingChange: setPlaying,
      onFeedback: (res, x, y) => {
        const id = ++_toastId;
        setFeedbacks(prev => [...prev, { id, result: res, x, y }]);
        setTimeout(() => setFeedbacks(prev => prev.filter(f => f.id !== id)), 700);
      },
    });

    gameRef.current = game;
    onReady(
      game,
      setResult,
      () => setResult(null),
      (nameJp, authorJp) => setSongInfo(prev => ({ ...prev, nameJp, authorJp })),
      (fn) => { startRef.current = fn; },
      (fn) => { skipBreakRef.current = fn; },
      () => setPlayerReady(true),
      setBreakSkipKind,
    );
    return () => game.destroy();
  }, []);

  useEffect(() => {
    gameRef.current?.setApproachMs(arToMs(ar));
  }, [ar]);

  useEffect(() => {
    if (comboRef.current) {
      comboRef.current.classList.remove("combo-pop");
      void comboRef.current.offsetWidth;
      comboRef.current.classList.add("combo-pop");
    }
  }, [combo]);

  const displayName   = lang === "jp" && songInfo.nameJp   ? songInfo.nameJp   : songInfo.name;
  const displayAuthor = lang === "jp" && songInfo.authorJp ? songInfo.authorJp : songInfo.author;
  const showStartPrompt = playerReady && !playing && !result;
  const showBreakSkip = playing && !result && breakSkipKind !== null;
  const breakSkipLabel = breakSkipKind === "finish"
    ? (lang === "jp" ? "完了" : "Finish")
    : (lang === "jp" ? "スキップ" : "Skip");

  const handleTryAgain = (): void => {
    setResult(null);
    onTryAgain();
  };

  const requestStart = (): void => {
    if (!showStartPrompt) return;
    startRef.current?.();
  };

  useEffect(() => {
    if (!showStartPrompt) return;
    startButtonRef.current?.focus();
  }, [showStartPrompt]);

  return (
    <>
      <OptionsPanel isSongPage={true} />

      {frameSize && (
        <svg className="game-frame" viewBox={`0 0 ${frameSize.w} ${frameSize.h}`} aria-hidden="true">
          {frameCircles(frameSize.w, frameSize.h).map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={c.r} />
          ))}
          {frameStars(frameSize.w, frameSize.h).map((s, i) => (
            <path
              key={i}
              className="frame-star"
              d={STAR_PATH}
              transform={`translate(${s.x} ${s.y}) scale(${s.scale})`}
            />
          ))}
        </svg>
      )}

      <div className={`game-area${playing ? " playing" : ""}`} ref={gameAreaRef}>
        <div id="song-storyboard" className="song-storyboard" />
        <canvas className="game-canvas" ref={canvasRef} />

        {showStartPrompt && (
          <button
            ref={startButtonRef}
            className="game-start-surface"
            type="button"
            onPointerDown={requestStart}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              requestStart();
            }}
            aria-label={lang === "jp" ? "開始" : "Start"}
          >
            <span className="game-start-label">{lang === "jp" ? "開始" : "Start"}</span>
          </button>
        )}

        {showBreakSkip && (
          <button
            className="game-break-skip"
            type="button"
            onClick={() => skipBreakRef.current?.()}
          >
            {breakSkipLabel}
          </button>
        )}

        <div className={`game-song-info${infoFaded ? " faded" : ""}`}>
          <span className="game-song-name">{displayName}</span>
          <span className="game-song-author">{displayAuthor}</span>
          {songInfo.mapper && <span className="game-song-mapper">{songInfo.mapper}</span>}
        </div>

        <div className="score-display">
          <span className="score-label">{lang === "jp" ? "スコア" : "Score"}</span>
          <span className="score-value">{score}</span>
        </div>

        <div className="combo-display">
          <span className="combo-value" ref={comboRef}>{combo}x</span>
          <span className="combo-label">{lang === "jp" ? "コンボ" : "Combo"}</span>
        </div>

        {feedbacks.map(f => (
          <div
            key={f.id}
            className={`hit-feedback hit-${f.result}`}
            style={{
              left: `${(f.x / LOGICAL_W) * 100}%`,
              top:  `${(f.y / LOGICAL_H) * 100}%`,
            }}
          >
            {f.result.toUpperCase()}
          </div>
        ))}

        {result && (
          <ResultsOverlay
            stats={result}
            returnHref={returnHref}
            onTryAgain={handleTryAgain}
            songName={displayName}
            artist={displayAuthor}
          />
        )}
      </div>
    </>
  );
}
