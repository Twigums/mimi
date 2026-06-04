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
