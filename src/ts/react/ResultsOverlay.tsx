import { useState } from "react";
import { useLang } from "./hooks/useLang";
import { computeGrade, computeAccuracy, JUDGEMENT_LABEL } from "../game/grade";
import { shareResult } from "../song/share";
import type { GameStats, IssueReason, NoteKind } from "../game/engine";

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

const ISSUE_LABELS_EN: Record<IssueReason, string> = {
  timing: "timing",
  contact: "contact",
  direction: "direction",
  gesture: "gesture",
};
const ISSUE_LABELS_JP: Record<IssueReason, string> = {
  timing: "タイミング",
  contact: "接触",
  direction: "方向",
  gesture: "ジェスチャー",
};
const ISSUE_ORDER: IssueReason[] = ["timing", "contact", "direction", "gesture"];

const NOTE_LABELS_EN: Record<NoteKind, string> = { cut: "cut", flow: "flow", lyric: "lyric" };
const NOTE_LABELS_JP: Record<NoteKind, string> = { cut: "カット", flow: "フロー", lyric: "歌詞" };
const NOTE_ORDER: NoteKind[] = ["cut", "flow", "lyric"];

// Tiers that can carry an issue (Tier 3 is clean by definition).
type IssueTier = "tier2" | "tier1" | "miss";
const ISSUE_TIERS: IssueTier[] = ["tier2", "tier1", "miss"];

// Every non-Tier-3 hit lands on one cell of each breakdown dimension (tier, note
// kind, issue). Hovering any cell scopes the other two dimensions to hits matching
// it, and re-highlights this dimension's own counts; all three rows stay linked.
type Dim = "tier" | "note" | "issue";
type Focus =
  | { dim: "tier"; tier: IssueTier }
  | { dim: "note"; note: NoteKind }
  | { dim: "issue"; issue: IssueReason }
  | null;

interface NonPerfectHit { tier: IssueTier; note: NoteKind; issue: IssueReason; }

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
  const issueLabels = lang === "jp" ? ISSUE_LABELS_JP : ISSUE_LABELS_EN;
  const noteLabels = lang === "jp" ? NOTE_LABELS_JP : NOTE_LABELS_EN;
  const acceptedHits = stats.hits.filter(hit => hit.result !== "miss");
  const avgOffset = acceptedHits.length === 0
    ? 0
    : acceptedHits.reduce((sum, hit) => sum + hit.offsetMs, 0) / acceptedHits.length;
  const earlyCount = acceptedHits.filter(hit => hit.timing === "early").length;
  const lateCount = acceptedHits.filter(hit => hit.timing === "late").length;

  // Every non-Tier-3 hit carries an issue; flatten them so each dimension's
  // counts are a simple predicate over the same list.
  const npHits: NonPerfectHit[] = [];
  for (const hit of stats.hits) {
    if (hit.result === "tier3" || !hit.issue) continue;
    npHits.push({ tier: hit.result as IssueTier, note: hit.kind, issue: hit.issue });
  }
  const matchesFocus = (h: NonPerfectHit): boolean =>
    focus === null
      || (focus.dim === "tier" ? h.tier === focus.tier
        : focus.dim === "note" ? h.note === focus.note
        : h.issue === focus.issue);
  const countWhere = (pred: (h: NonPerfectHit) => boolean): number => npHits.filter(pred).length;

  // The hovered dimension keeps its own (unscoped) counts; the other two scope to
  // the focus. The full counts (used when this dimension is focused or nothing is)
  // are just the focus-free totals.
  const tierCount = (tier: IssueTier): number =>
    focus !== null && focus.dim !== "tier"
      ? countWhere(h => h.tier === tier && matchesFocus(h))
      : stats[tier];
  const noteCount = (note: NoteKind): number =>
    focus !== null && focus.dim !== "note"
      ? countWhere(h => h.note === note && matchesFocus(h))
      : countWhere(h => h.note === note);
  const issueCount = (issue: IssueReason): number =>
    focus !== null && focus.dim !== "issue"
      ? countWhere(h => h.issue === issue && matchesFocus(h))
      : countWhere(h => h.issue === issue);

  const presentNotes = NOTE_ORDER.filter(note => countWhere(h => h.note === note) > 0);
  const presentIssues = ISSUE_ORDER.filter(issue => countWhere(h => h.issue === issue) > 0);

  // A cell is active when it is the hovered cell (same dimension) or, while a
  // different dimension is focused, it still has matching hits; everything else
  // dims while any focus is held.
  const cellState = (dim: Dim, isHovered: boolean, count: number): string => {
    const active = focus?.dim === dim ? isHovered : focus !== null && count > 0;
    return (active ? " is-active" : "") + (focus !== null && !active ? " is-dim" : "");
  };

  // The "Issues" label notes which filter currently scopes the two issue-section
  // rows; an issue focus doesn't scope them, so it shows no indicator.
  const filterLabel = focus === null || focus.dim === "issue" ? null
    : focus.dim === "tier" ? JUDGEMENT_LABEL[focus.tier]
    : noteLabels[focus.note];

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
            <span className={`results-breakdown__tier3${focus !== null && focus.dim !== "tier" ? " is-dim" : ""}`}>
              {JUDGEMENT_LABEL.tier3}: {stats.tier3}
            </span>
            {ISSUE_TIERS.map(tier => {
              const count = tierCount(tier);
              const cls = `results-breakdown__${tier} results-tierbtn`
                + cellState("tier", focus?.dim === "tier" && focus.tier === tier, count);
              return (
                <span
                  key={tier}
                  className={cls}
                  onPointerEnter={() => setFocus({ dim: "tier", tier })}
                  onPointerLeave={() => setFocus(null)}
                >
                  {JUDGEMENT_LABEL[tier]}: {count}
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
              {filterLabel !== null && (
                <span className="results-issues__filter"> · {filterLabel}</span>
              )}
            </span>
            {presentIssues.length === 0 ? (
              <div className="results-issues__list">
                <span className="results-issues__empty">{labels.clean}</span>
              </div>
            ) : (
              <>
                <div className="results-issues__list">
                  {presentNotes.map(note => {
                    const count = noteCount(note);
                    const cls = "results-issue"
                      + cellState("note", focus?.dim === "note" && focus.note === note, count);
                    return (
                      <span
                        key={note}
                        className={cls}
                        onPointerEnter={() => setFocus({ dim: "note", note })}
                        onPointerLeave={() => setFocus(null)}
                      >
                        {noteLabels[note]} {count}
                      </span>
                    );
                  })}
                </div>
                <div className="results-issues__list">
                  {presentIssues.map(issue => {
                    const count = issueCount(issue);
                    const cls = "results-issue"
                      + cellState("issue", focus?.dim === "issue" && focus.issue === issue, count);
                    return (
                      <span
                        key={issue}
                        className={cls}
                        onPointerEnter={() => setFocus({ dim: "issue", issue })}
                        onPointerLeave={() => setFocus(null)}
                      >
                        {issueLabels[issue]} {count}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
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
