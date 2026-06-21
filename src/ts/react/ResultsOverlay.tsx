import { useEffect, useState } from "react";
import { useLang } from "./hooks/useLang";
import { computeGrade, computeAccuracy, JUDGEMENT_LABEL } from "../game/grade";
import { shareResult } from "../song/share";
import type { GameStats, HitTiming, IssueReason, NoteKind } from "../game/engine";

const LABELS_EN = {
  title: "Results", score: "Score", accuracy: "Accuracy",
  maxCombo: "Max combo", avgOffset: "Avg offset", issues: "Issues",
  timing: "Timing", early: "early", late: "late",
  tendEarly: "Tends early", tendLate: "Tends late", onTime: "On time",
  to: "to", topGrade: "Top grade!", fullCombo: "Full Combo", allPerfect: "All Perfect",
  hoverFilter: "hover to filter",
  clean: "clean", share: "Share", copied: "Copied!", failed: "Failed", tryAgain: "Try Again", back: "Back",
};
const LABELS_JP = {
  title: "リザルト", score: "スコア", accuracy: "精度",
  maxCombo: "最大コンボ", avgOffset: "平均ズレ", issues: "課題",
  timing: "タイミング", early: "早", late: "遅",
  tendEarly: "早め", tendLate: "遅め", onTime: "ジャスト",
  to: "まで", topGrade: "最高評価！", fullCombo: "フルコンボ", allPerfect: "オールパーフェクト",
  hoverFilter: "ホバーで絞り込み",
  clean: "クリーン", share: "シェア", copied: "コピー済み！", failed: "失敗", tryAgain: "やり直す", back: "戻る",
};

// Ease a number from 0 to target over the mount (easeOutCubic); respects
// prefers-reduced-motion by snapping straight to the target.
function useCountUp(target: number, durationMs = 800): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      setVal(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}

// Distribution of hit offsets (ms; negative = early, positive = late) as a small
// SVG strip centred on 0, early/late shaded, with a marker at the mean. Surfaces
// per-hit offsetMs we already capture — the single most useful rhythm-game stat.
const HIST_BINS = 21;

function TimingHistogram({ offsets, labels }: { offsets: number[]; labels: typeof LABELS_EN }) {
  if (offsets.length === 0) return null;
  const maxAbs = offsets.reduce((m, o) => Math.max(m, Math.abs(o)), 0);
  const range = Math.min(200, Math.max(60, Math.ceil(maxAbs / 10) * 10));
  const binW = (range * 2) / HIST_BINS;
  const counts = new Array<number>(HIST_BINS).fill(0);
  for (const o of offsets) {
    const idx = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((o + range) / binW)));
    counts[idx]++;
  }
  const maxCount = Math.max(...counts);
  const mean = offsets.reduce((s, o) => s + o, 0) / offsets.length;
  const W = HIST_BINS;
  const H = 30;
  const meanX = ((mean + range) / (range * 2)) * W;
  // One-line coaching takeaway (tendency word) trailed by the precise average
  // offset (the avg-offset stat lives here now rather than in a separate row).
  const verdict = Math.abs(mean) < 8
    ? labels.onTime
    : mean < 0 ? labels.tendEarly : labels.tendLate;
  return (
    <div className="results-hist">
      <div className="results-hist__head">
        <span className="results-hist__label">{labels.timing}</span>
        <span className="results-hist__verdict">
          {verdict}
          <span className="results-hist__avg"> · {labels.avgOffset} {mean >= 0 ? "+" : ""}{mean.toFixed(1)}ms</span>
        </span>
      </div>
      <svg className="results-hist__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {counts.map((c, i) => {
          const h = maxCount === 0 ? 0 : (c / maxCount) * (H - 2);
          const centre = i - (HIST_BINS - 1) / 2;
          const cls = centre < 0 ? "early" : centre > 0 ? "late" : "on";
          return (
            <rect
              key={i}
              className={`results-hist__bar results-hist__bar--${cls}`}
              x={i + 0.12}
              y={H - h}
              width={0.76}
              height={h}
            />
          );
        })}
        <line className="results-hist__center" x1={W / 2} y1={0} x2={W / 2} y2={H} vectorEffect="non-scaling-stroke" />
        <line className="results-hist__mean" x1={meanX} y1={0} x2={meanX} y2={H} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="results-hist__axis">
        <span>{labels.early} −{range}ms</span>
        <span>0</span>
        <span>+{range}ms {labels.late}</span>
      </div>
    </div>
  );
}

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

// Early/late (timing direction) is a fourth cross-filter dimension. It is not a
// complete partition — an exactly-on-beat non-perfect hit matches neither cell.
const TIMING_ORDER: ("early" | "late")[] = ["early", "late"];

// Accuracy thresholds for the "next grade" hint, ascending so the first entry
// above the current accuracy is the next tier up. Mirrors computeGrade.
const GRADE_STEPS: { grade: string; min: number }[] = [
  { grade: "C", min: 0.5 }, { grade: "B", min: 0.7 }, { grade: "A", min: 0.85 },
  { grade: "S", min: 0.95 }, { grade: "SS", min: 0.99 }, { grade: "SSS", min: 1.0 },
];

// Tiers that can carry an issue (Tier 3 is clean by definition).
type IssueTier = "tier2" | "tier1" | "miss";
const ISSUE_TIERS: IssueTier[] = ["tier2", "tier1", "miss"];

// Every non-Tier-3 hit lands on one cell of each breakdown dimension (tier, note
// kind, issue, early/late timing). Hovering any cell scopes the other dimensions
// to hits matching it, and re-highlights this dimension's own counts; all rows
// stay linked.
type Dim = "tier" | "note" | "issue" | "timing";
type Focus =
  | { dim: "tier"; tier: IssueTier }
  | { dim: "note"; note: NoteKind }
  | { dim: "issue"; issue: IssueReason }
  | { dim: "timing"; timing: HitTiming }
  | null;

interface NonPerfectHit { tier: IssueTier; note: NoteKind; issue: IssueReason; timing: HitTiming; }

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

  // Enter retries, Escape returns — the buttons are right there, just wire keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Enter") { e.preventDefault(); onTryAgain(); }
      else if (e.key === "Escape") { e.preventDefault(); window.location.href = returnHref; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTryAgain, returnHref]);

  const grade = computeGrade(stats);
  const accuracy = computeAccuracy(stats);
  const pct = (accuracy * 100).toFixed(2);
  const scoreView = useCountUp(stats.score);
  const accView = useCountUp(accuracy * 100);

  // Distance to the next grade up — a concrete reason to retry. Mirrors the
  // accuracy thresholds in computeGrade; undefined once already at the top.
  const nextStep = GRADE_STEPS.find(s => s.min > accuracy);
  // Achievement badge: an all-PERFECT run, else a no-miss full combo.
  const badgeKey: "allPerfect" | "fullCombo" | null =
    stats.total === 0 ? null
    : stats.tier3 === stats.total ? "allPerfect"
    : stats.miss === 0 ? "fullCombo"
    : null;

  const labels = lang === "jp" ? LABELS_JP : LABELS_EN;
  const issueLabels = lang === "jp" ? ISSUE_LABELS_JP : ISSUE_LABELS_EN;
  const noteLabels = lang === "jp" ? NOTE_LABELS_JP : NOTE_LABELS_EN;
  const acceptedHits = stats.hits.filter(hit => hit.result !== "miss");

  // Every non-Tier-3 hit carries an issue; flatten them so each dimension's
  // counts are a simple predicate over the same list.
  const npHits: NonPerfectHit[] = [];
  for (const hit of stats.hits) {
    if (hit.result === "tier3" || !hit.issue) continue;
    npHits.push({ tier: hit.result as IssueTier, note: hit.kind, issue: hit.issue, timing: hit.timing });
  }
  const matchesFocus = (h: NonPerfectHit): boolean =>
    focus === null
      || (focus.dim === "tier" ? h.tier === focus.tier
        : focus.dim === "note" ? h.note === focus.note
        : focus.dim === "issue" ? h.issue === focus.issue
        : h.timing === focus.timing);
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
  const timingCount = (timing: HitTiming): number =>
    focus !== null && focus.dim !== "timing"
      ? countWhere(h => h.timing === timing && matchesFocus(h))
      : countWhere(h => h.timing === timing);

  const presentNotes = NOTE_ORDER.filter(note => countWhere(h => h.note === note) > 0);
  const presentIssues = ISSUE_ORDER.filter(issue => countWhere(h => h.issue === issue) > 0);
  const presentTimings = TIMING_ORDER.filter(timing => countWhere(h => h.timing === timing) > 0);

  // A cell is active when it is the hovered cell (same dimension) or, while a
  // different dimension is focused, it still has matching hits; everything else
  // dims while any focus is held.
  const cellState = (dim: Dim, isHovered: boolean, count: number): string => {
    const active = focus?.dim === dim ? isHovered : focus !== null && count > 0;
    return (active ? " is-active" : "") + (focus !== null && !active ? " is-dim" : "");
  };

  // The "Issues" label notes which filter currently scopes the issue-section
  // rows. A focus from within those rows (note, issue, timing) reads on its own
  // cell, so only a tier focus (from the separate breakdown row) is annotated.
  const filterLabel = focus !== null && focus.dim === "tier"
    ? JUDGEMENT_LABEL[focus.tier]
    : null;

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
        <div className="results-head">
          <h2 className="results-title">{labels.title}</h2>
          <div className="results-songhead">
            <span className="results-songhead__name">{songName}</span>
            {artist && <span className="results-songhead__artist">{artist}</span>}
          </div>
        </div>
        <div className="results-body">
        <div className="results-left">
          <div className={`results-grade results-grade--${grade.toLowerCase()}`}>{grade}</div>
          <div className="results-accuracy">{accView.toFixed(2)}%</div>
          <div className="results-next">
            {nextStep
              ? `${((nextStep.min - accuracy) * 100).toFixed(2)}% ${labels.to} ${nextStep.grade}`
              : labels.topGrade}
          </div>
          {badgeKey && (
            <div className={`results-badge results-badge--${badgeKey}`}>{labels[badgeKey]}</div>
          )}
          <div className="results-headline">
            <div className="results-stat">
              <span className="results-stat__label">{labels.score}</span>
              <span className="results-stat__value">{Math.round(scoreView)}</span>
            </div>
            <div className="results-stat">
              <span className="results-stat__label">{labels.maxCombo}</span>
              <span className="results-stat__value">{stats.maxCombo}x</span>
            </div>
          </div>
        </div>
        <div className="results-right">
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
          <div className="results-issues">
            <span className="results-issues__label">
              {labels.issues}
              {filterLabel !== null ? (
                <span className="results-issues__filter"> · {filterLabel}</span>
              ) : focus === null && presentIssues.length > 0 && (
                <span className="results-issues__hint"> · {labels.hoverFilter}</span>
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
                <div className="results-issues__list">
                  {presentTimings.map(timing => {
                    const count = timingCount(timing);
                    const cls = "results-issue"
                      + cellState("timing", focus?.dim === "timing" && focus.timing === timing, count);
                    return (
                      <span
                        key={timing}
                        className={cls}
                        onPointerEnter={() => setFocus({ dim: "timing", timing })}
                        onPointerLeave={() => setFocus(null)}
                      >
                        {labels[timing]} {count}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        </div>
        <TimingHistogram offsets={acceptedHits.map(hit => hit.offsetMs)} labels={labels} />
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
