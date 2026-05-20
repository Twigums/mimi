import { useEffect, useRef, useState } from "react";
import { createGame, LOGICAL_W, LOGICAL_H } from "../game/engine";
import type { GameHandle, HitResult, GameStats } from "../game/engine";
import { arToMs } from "../core/settings";
import { withPath } from "../core/sitePath";
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
    registerToggle: (fn: () => void) => void,
    setPlayerReady: () => void,
  ) => void;
  returnHref: string;
  onTryAgain: () => void;
}

export function GameSurface({ onReady, returnHref, onTryAgain }: Props) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const gameAreaRef     = useRef<HTMLDivElement>(null);
  const gameRef         = useRef<GameHandle | null>(null);
  const comboRef        = useRef<HTMLSpanElement>(null);
  const fadeTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const togglePlayRef   = useRef<(() => void) | null>(null);

  const [score, setScore]             = useState(0);
  const [combo, setCombo]             = useState(0);
  const [playing, setPlaying]         = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [infoFaded, setInfoFaded]     = useState(false);
  const [btnFaded, setBtnFaded]       = useState(false);
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
      fadeTimerRef.current    = setTimeout(() => setInfoFaded(true), 2000);
      btnFadeTimerRef.current = setTimeout(() => setBtnFaded(true), 2000);
    } else {
      if (fadeTimerRef.current    !== null) { clearTimeout(fadeTimerRef.current);    fadeTimerRef.current    = null; }
      if (btnFadeTimerRef.current !== null) { clearTimeout(btnFadeTimerRef.current); btnFadeTimerRef.current = null; }
      setInfoFaded(false);
      setBtnFaded(false);
    }
    return () => {
      if (fadeTimerRef.current    !== null) clearTimeout(fadeTimerRef.current);
      if (btnFadeTimerRef.current !== null) clearTimeout(btnFadeTimerRef.current);
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
      (fn) => { togglePlayRef.current = fn; },
      () => setPlayerReady(true),
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

  const handleTryAgain = (): void => {
    setResult(null);
    onTryAgain();
  };

  return (
    <>
      <OptionsPanel isSongPage={true} />

      <div className={`game-area${playing ? " playing" : ""}`} ref={gameAreaRef}>
        <div id="song-storyboard" className="song-storyboard" />
        <canvas className="game-canvas" ref={canvasRef} />

        <button
          className={`btn-play-stop${btnFaded ? " faded" : ""}`}
          onClick={() => togglePlayRef.current?.()}
          disabled={!playerReady || !!result}
          onMouseEnter={() => {
            if (btnFadeTimerRef.current !== null) { clearTimeout(btnFadeTimerRef.current); btnFadeTimerRef.current = null; }
            setBtnFaded(false);
          }}
          onMouseLeave={() => {
            if (playing) btnFadeTimerRef.current = setTimeout(() => setBtnFaded(true), 2000);
          }}
        >
          <img className="icon-play" src={withPath("/images/start-button.svg")} alt="Play" />
          <img className="icon-stop" src={withPath("/images/stop-button.svg")} alt="Stop" />
        </button>

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