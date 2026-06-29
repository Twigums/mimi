import { useEffect, useRef, useState } from "react";
import { createGame, LOGICAL_W, LOGICAL_H } from "../game/engine";
import type { GameHandle, HitResult, GameStats } from "../game/engine";
import type { BreakSkipKind } from "../song/controller";
import { arToMs } from "../core/settings";
import { JUDGEMENT_LABEL } from "../game/grade";
import { useLang } from "./hooks/useLang";
import { useApproachRate } from "./hooks/useSettings";
import { ResultsOverlay } from "./ResultsOverlay";
import { OptionsPanel } from "./OptionsPanel";
import { GameFrame, useElementSize } from "./GameFrame";

let _toastId = 0;

// Re-trigger a one-shot CSS pop animation by removing the class, forcing reflow, re-adding.
const retriggerPop = (el: HTMLElement | null, cls: string): void => {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

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
    setPreparing: () => void,
    setPaused: () => void,
    registerLyricOutcome: (fn: (result: HitResult, x: number, y: number) => void) => void,
  ) => void;
  returnHref: string;
  onTryAgain: () => void;
}

export function GameSurface({ onReady, returnHref, onTryAgain }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameHandle | null>(null);
  const comboRef = useRef<HTMLSpanElement>(null);
  const accuracyRef = useRef<HTMLSpanElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<(() => void) | null>(null);
  const skipBreakRef = useRef<(() => void) | null>(null);
  const lyricOutcomeRef = useRef<((result: HitResult, x: number, y: number) => void) | null>(null);

  const [accuracy, setAccuracy] = useState(0);
  const [combo, setCombo] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [infoFaded, setInfoFaded] = useState(false);
  const [breakSkipKind, setBreakSkipKind] = useState<BreakSkipKind | null>(null);
  const [feedbacks, setFeedbacks] = useState<FeedbackToast[]>([]);
  const [result, setResult] = useState<GameStats | null>(null);
  const [songInfo, setSongInfo] = useState<SongInfo>(() => {
    const b = document.body.dataset;
    const diff = new URL(window.location.href).searchParams.get("d") ?? "expert";
    let mapper = "";
    try {
      const mappers = JSON.parse(b.songMappers ?? "{}") as Record<string, string>;
      mapper = mappers[diff] ?? "";
    } catch { mapper = ""; }
    return {
      name: b.songName ?? "",
      nameJp: b.songNameJp ?? "",
      author: b.songAuthor ?? "",
      authorJp: b.songAuthorJp ?? "",
      mapper,
    };
  });

  const lang = useLang();
  const [ar] = useApproachRate();
  const frameSize = useElementSize(gameAreaRef);

  // Chart metadata for the results screen
  const difficulty = new URL(window.location.href).searchParams.get("d") ?? "expert";
  const bpmRaw = document.body.dataset.songBpm;
  const bpm = bpmRaw ? Number(bpmRaw) : null;
  const level = (() => {
    try {
      const levels = JSON.parse(document.body.dataset.songLevels ?? "{}") as Record<string, number>;
      return levels[difficulty] ?? null;
    } catch { return null; }
  })();

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
    const canvas = canvasRef.current;
    const gameArea = gameAreaRef.current;
    if (!canvas || !gameArea) return;

    const hitSoundUrl = document.body.dataset.hitSoundUrl;
    const game = createGame({
      canvas,
      gameArea,
      hitSoundUrl,
      onAccuracy: setAccuracy,
      onComboChange: setCombo,
      onPlayingChange: setPlaying,
      onFeedback: (res, x, y) => {
        const id = ++_toastId;
        setFeedbacks(prev => [...prev, { id, result: res, x, y }]);
        setTimeout(() => setFeedbacks(prev => prev.filter(f => f.id !== id)), 700);
        lyricOutcomeRef.current?.(res, x, y);
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
      () => setPreparing(true),
      () => setPaused(true),
      (fn) => { lyricOutcomeRef.current = fn; },
    );
    return () => game.destroy();
  }, []);

  useEffect(() => {
    gameRef.current?.setApproachMs(arToMs(ar));
  }, [ar]);

  useEffect(() => {
    retriggerPop(comboRef.current, "combo-pop");
  }, [combo]);

  useEffect(() => {
    retriggerPop(accuracyRef.current, "accuracy-pop");
  }, [accuracy]);

  const displayName = lang === "jp" && songInfo.nameJp ? songInfo.nameJp : songInfo.name;
  const displayAuthor = lang === "jp" && songInfo.authorJp ? songInfo.authorJp : songInfo.author;
  const showStartPrompt = playerReady && !playing && !result && !paused;
  const showPreparing = preparing && !playerReady && !playing && !result;
  const showPaused = paused && !playing && !result;
  const showBreakSkip = playing && !result && breakSkipKind !== null;
  const breakSkipLabel = breakSkipKind === "finish"
    ? (lang === "jp" ? "完了" : "Finish")
    : (lang === "jp" ? "スキップ" : "Skip");

  const handleTryAgain = (): void => {
    setResult(null);
    setPaused(false);
    onTryAgain();
  };

  const requestStart = (): void => {
    if (!showStartPrompt && !showPaused) return;
    setPaused(false);
    startRef.current?.();
  };

  useEffect(() => {
    if (!showStartPrompt && !showPaused) return;
    startButtonRef.current?.focus();
  }, [showStartPrompt, showPaused]);

  return (
    <>
      <OptionsPanel isSongPage={true} />

      {frameSize && <GameFrame w={frameSize.w} h={frameSize.h} />}

      <div className={`game-area${playing ? " playing" : ""}${paused ? " paused" : ""}`} ref={gameAreaRef}>
        <div id="song-storyboard" className="song-storyboard" />
        <canvas className="game-canvas" ref={canvasRef} />
        <div id="song-funnel" className="song-funnel" />

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

        {showPreparing && (
          <div className="game-start-surface is-preparing" aria-live="polite">
            <span className="game-start-label">{lang === "jp" ? "準備中…" : "Preparing…"}</span>
          </div>
        )}

        {showPaused && (
          <button
            className="game-start-surface is-paused"
            type="button"
            onPointerDown={requestStart}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              requestStart();
            }}
            aria-label={lang === "jp" ? "続ける" : "Continue"}
            autoFocus
          >
            <span className="game-start-label">{lang === "jp" ? "続ける" : "Continue"}</span>
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

        <div className={`game-song-info${infoFaded || result ? " faded" : ""}`}>
          <span className="game-song-name">{displayName}</span>
          <span className="game-song-author">{displayAuthor}</span>
          {songInfo.mapper && <span className="game-song-mapper">{songInfo.mapper}</span>}
        </div>

        <div className="accuracy-display">
          <span className="accuracy-value" ref={accuracyRef}>{(accuracy * 100).toFixed(2)}%</span>
          <span className="accuracy-label">{lang === "jp" ? "精度" : "Accuracy"}</span>
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
              top: `${(f.y / LOGICAL_H) * 100}%`,
            }}
          >
            {JUDGEMENT_LABEL[f.result]}
          </div>
        ))}

        {result && (
          <ResultsOverlay
            stats={result}
            returnHref={returnHref}
            onTryAgain={handleTryAgain}
            songName={displayName}
            songId={songInfo.name}
            artist={displayAuthor}
            difficulty={difficulty}
            level={level}
            bpm={bpm}
          />
        )}
      </div>
    </>
  );
}