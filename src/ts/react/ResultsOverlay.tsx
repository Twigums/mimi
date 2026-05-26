import { useState } from "react";
import { useLang } from "./hooks/useLang";
import { computeGrade, computeAccuracy } from "../game/grade";
import { shareResult } from "../song/share";
import type { GameStats } from "../game/engine";

const LABELS_EN = { title: "Results", score: "Score", accuracy: "Accuracy", perfect: "Perfect", good: "Good", miss: "Miss", share: "Share", copied: "Copied!", failed: "Failed", tryAgain: "Try Again", back: "Back" };
const LABELS_JP = { title: "リザルト", score: "スコア", accuracy: "精度", perfect: "パーフェクト", good: "グッド", miss: "ミス", share: "シェア", copied: "コピー済み！", failed: "失敗", tryAgain: "やり直す", back: "戻る" };

interface Props {
  stats: GameStats;
  returnHref: string;
  onTryAgain: () => void;
  songName: string;
  artist: string;
}

export function ResultsOverlay({ stats, returnHref, onTryAgain, songName, artist }: Props) {
  const lang = useLang();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");

  const grade = computeGrade(stats);
  const accuracy = computeAccuracy(stats);
  const pct = (accuracy * 100).toFixed(2);

  const labels = lang === "jp" ? LABELS_JP : LABELS_EN;

  const handleShare = (): void => {
    shareResult({ accuracy: `${pct}%`, grade, songName, artist, lang })
      .then(ok => {
        setShareStatus(ok ? "copied" : "failed");
        setTimeout(() => setShareStatus("idle"), 2000);
      });
  };

  const shareLabel = shareStatus === "copied" ? labels.copied
    : shareStatus === "failed" ? labels.failed
    : labels.share;

  return (
    <div className="results-overlay">
      <div className="results-panel">
        <h2 className="results-title">{labels.title}</h2>
        <div className={`results-grade results-grade--${grade.toLowerCase()}`}>{grade}</div>
        <div className="results-stats">
          <div className="results-stat">
            <span className="results-stat__label">{labels.score}</span>
            <span className="results-stat__value">{stats.score}</span>
          </div>
          <div className="results-stat">
            <span className="results-stat__label">{labels.accuracy}</span>
            <span className="results-stat__value">{pct}%</span>
          </div>
          <div className="results-breakdown">
            <span className="results-breakdown__perfect">{labels.perfect}: {stats.perfect}</span>
            <span className="results-breakdown__good">{labels.good}: {stats.good}</span>
            <span className="results-breakdown__miss">{labels.miss}: {stats.miss}</span>
          </div>
        </div>
        <div className="results-actions">
          <button
            className={`results-btn results-btn--share results-btn--share-${shareStatus}`}
            onClick={handleShare}
          >
            {shareLabel}
          </button>
          <button className="results-btn results-btn--try-again" onClick={onTryAgain}>{labels.tryAgain}</button>
          <a className="results-btn results-btn--back" href={returnHref}>{labels.back}</a>
        </div>
      </div>
    </div>
  );
}
