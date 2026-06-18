import { useState } from "react";
import { useLang } from "./hooks/useLang";
import { computeGrade, computeAccuracy, JUDGEMENT_LABEL } from "../game/grade";
import { shareResult } from "../song/share";
import type { GameStats, IssueReason } from "../game/engine";

const LABELS_EN = {
  title: "Results", score: "Score", accuracy: "Accuracy",
  maxCombo: "Max combo", avgOffset: "Avg offset", earlyLate: "Early / Late", issues: "Issues",
  clean: "clean", share: "Share", copied: "Copied!", failed: "Failed", tryAgain: "Try Again", back: "Back",
};
const LABELS_JP = {
  title: "リザルト", score: "スコア", accuracy: "精度",
  maxCombo: "最大コンボ", avgOffset: "平均ズレ", earlyLate: "早 / 遅", issues: "課題",
  clean: "クリーン", share: "シェア", copied: "コピー済み！", failed: "失敗", tryAgain: "やり直す", back: "戻る",
};

const ISSUE_LABELS: Record<IssueReason, string> = {
  timing: "timing",
  contact: "contact",
  direction: "direction",
  travel: "travel",
  continuity: "flow",
};
const ISSUE_ORDER: IssueReason[] = ["timing", "contact", "direction", "travel", "continuity"];

// Tiers that can carry an issue (Tier 3 is clean by definition).
type IssueTier = "tier2" | "tier1" | "miss";
const ISSUE_TIERS: IssueTier[] = ["tier2", "tier1", "miss"];

// Hovering a tier filters the issue row to that tier; hovering an issue
// re-counts the tier breakdown to that issue. Both directions stay linked.
type Focus =
  | { kind: "tier"; tier: IssueTier }
  | { kind: "issue"; issue: IssueReason }
  | null;

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
  const [focus, setFocus] = useState<Focus>(null);

  const grade = computeGrade(stats);
  const accuracy = computeAccuracy(stats);
  const pct = (accuracy * 100).toFixed(2);

  const labels = lang === "jp" ? LABELS_JP : LABELS_EN;
  const acceptedHits = stats.hits.filter(hit => hit.result !== "miss");
  const avgOffset = acceptedHits.length === 0
    ? 0
    : acceptedHits.reduce((sum, hit) => sum + hit.offsetMs, 0) / acceptedHits.length;
  const earlyCount = acceptedHits.filter(hit => hit.timing === "early").length;
  const lateCount = acceptedHits.filter(hit => hit.timing === "late").length;

  // issueByTier[tier][issue] = count; every non-Tier-3 hit carries one issue.
  const issueByTier: Record<IssueTier, Partial<Record<IssueReason, number>>> = {
    tier2: {}, tier1: {}, miss: {},
  };
  for (const hit of stats.hits) {
    if (hit.result === "tier3" || !hit.issue) continue;
    const tier = hit.result as IssueTier;
    issueByTier[tier][hit.issue] = (issueByTier[tier][hit.issue] ?? 0) + 1;
  }
  const issueTotals: Partial<Record<IssueReason, number>> = {};
  for (const tier of ISSUE_TIERS) {
    for (const issue of ISSUE_ORDER) {
      const n = issueByTier[tier][issue];
      if (n) issueTotals[issue] = (issueTotals[issue] ?? 0) + n;
    }
  }
  const presentIssues = ISSUE_ORDER.filter(issue => (issueTotals[issue] ?? 0) > 0);

  // Counts shown depend on focus: a focused tier scopes the issue row to that
  // tier, a focused issue scopes the tier breakdown to that issue.
  const issueCounts = focus?.kind === "tier" ? issueByTier[focus.tier] : issueTotals;
  const tierCount = (tier: IssueTier): number =>
    focus?.kind === "issue" ? (issueByTier[tier][focus.issue] ?? 0) : stats[tier];

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
            <span className={`results-breakdown__tier3${focus?.kind === "issue" ? " is-dim" : ""}`}>
              {JUDGEMENT_LABEL.tier3}: {stats.tier3}
            </span>
            {ISSUE_TIERS.map(tier => {
              const active = focus?.kind === "tier"
                ? focus.tier === tier
                : focus?.kind === "issue"
                  ? tierCount(tier) > 0
                  : false;
              const cls = `results-breakdown__${tier} results-tierbtn`
                + (active ? " is-active" : "")
                + (focus !== null && !active ? " is-dim" : "");
              return (
                <span
                  key={tier}
                  className={cls}
                  onPointerEnter={() => setFocus({ kind: "tier", tier })}
                  onPointerLeave={() => setFocus(null)}
                >
                  {JUDGEMENT_LABEL[tier]}: {tierCount(tier)}
                </span>
              );
            })}
          </div>
          <div className="results-detail">
            <span>{labels.maxCombo}: {stats.maxCombo}x</span>
            <span>{labels.avgOffset}: {avgOffset >= 0 ? "+" : ""}{avgOffset.toFixed(1)}ms</span>
            <span>{labels.earlyLate}: {earlyCount} / {lateCount}</span>
          </div>
          <div className="results-issues">
            <span className="results-issues__label">
              {labels.issues}
              {focus?.kind === "tier" && (
                <span className="results-issues__filter"> · {JUDGEMENT_LABEL[focus.tier]}</span>
              )}
            </span>
            <div className="results-issues__list">
              {presentIssues.length === 0 ? (
                <span className="results-issues__empty">{labels.clean}</span>
              ) : presentIssues.map(issue => {
                const count = issueCounts[issue] ?? 0;
                const active = focus?.kind === "issue"
                  ? focus.issue === issue
                  : focus?.kind === "tier"
                    ? count > 0
                    : false;
                const cls = "results-issue"
                  + (active ? " is-active" : "")
                  + (focus !== null && !active ? " is-dim" : "");
                return (
                  <span
                    key={issue}
                    className={cls}
                    onPointerEnter={() => setFocus({ kind: "issue", issue })}
                    onPointerLeave={() => setFocus(null)}
                  >
                    {ISSUE_LABELS[issue]} {count}
                  </span>
                );
              })}
            </div>
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
