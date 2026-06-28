import { useEffect, useRef, useState } from "react";
import { useLang } from "./hooks/useLang";
import { computeGrade, computeAccuracy, JUDGEMENT_LABEL } from "../game/grade";
import { TIER1_MS } from "../game/judgement";
import { shareResult } from "../song/share";
import { withPath } from "../core/sitePath";
import { commitPersonalBest, type PersonalBest } from "../game/personalBest";
import type { GameStats, IssueReason, NoteKind } from "../game/engine";
import type { Grade } from "../game/grade";

function mikuSvg(grade: Grade): string {
  if (grade === "SSS" || grade === "SS" || grade === "S") return withPath("/images/miku/miku_S.svg");
  if (grade === "A") return withPath("/images/miku/miku_A.svg");
  if (grade === "B") return withPath("/images/miku/miku_B.svg");
  return withPath("/images/miku/miku_C.svg");
}

function MikuFigure({ grade, anim }: { grade: Grade; anim: "bounce" | "sway" }) {
  const [markup, setMarkup] = useState("");
  const src = mikuSvg(grade);
  useEffect(() => {
    let alive = true;
    fetch(src)
      .then(r => r.text())
      .then(t => { if (alive) setMarkup(t.slice(Math.max(0, t.indexOf("<svg")))); })
      .catch(() => { });
    return () => { alive = false; };
  }, [src]);
  return (
    <div
      className={`results-pie__miku results-pie__miku--${anim}`}
      role="img"
      aria-label={`Miku ${grade}`}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

const LABELS_EN = {
  accuracy: "Accuracy",
  maxCombo: "Max combo", avgOffset: "Avg offset", issues: "Issues",
  judgement: "Judgement", level: "lv.", bpm: "BPM",
  timing: "Timing", early: "early", late: "late",
  tendEarly: "Tends early", tendLate: "Tends late",
  to: (diff: string, grade: string) => `${diff} to ${grade}`,
  fullCombo: "Full Mimi", allPerfect: "All Mimi",
  hoverFilter: "hover to filter", best: "Best", newRecord: "New Record!",
  toGo: (diff: string) => `${diff} to best`,
  advancedDetails: "Advanced Details", basicDetails: "Basic Details",
  share: "Share", copied: "Copied!", failed: "Failed", tryAgain: "Try Again", back: "Back",
};
const LABELS_JP = {
  accuracy: "精度",
  maxCombo: "最大コンボ", avgOffset: "平均ズレ", issues: "課題",
  judgement: "判定", level: "Lv.", bpm: "BPM",
  timing: "タイミング", early: "早", late: "遅",
  tendEarly: "早め", tendLate: "遅め",
  to: (diff: string, grade: string) => `${grade} まで ${diff}`,
  fullCombo: "フルミミ", allPerfect: "オールミミ",
  hoverFilter: "ホバーで絞り込み", best: "ベスト", newRecord: "自己ベスト更新！",
  toGo: (diff: string) => `あと${diff}`,
  advancedDetails: "詳細表示", basicDetails: "簡易表示",
  share: "シェア", copied: "コピー済み！", failed: "失敗", tryAgain: "やり直す", back: "戻る",
};

// Ease a number from 0 to target over the mount
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

const HIST_BINS = 21;
const HIST_RANGE = TIER1_MS;

function TimingHistogram({ offsets, labels }: { offsets: number[]; labels: typeof LABELS_EN }) {
  const range = HIST_RANGE;
  const binW = (range * 2) / HIST_BINS;
  const counts = new Array<number>(HIST_BINS).fill(0);
  for (const o of offsets) {
    const idx = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((o + range) / binW)));
    counts[idx]++;
  }
  const maxCount = Math.max(1, ...counts);
  const hasData = offsets.length > 0;
  const mean = hasData ? offsets.reduce((s, o) => s + o, 0) / offsets.length : 0;
  const W = HIST_BINS;
  const H = 30;
  const meanX = ((mean + range) / (range * 2)) * W;
  const tendency = !hasData || Math.abs(mean) < 8
    ? "" : mean < 0 ? labels.tendEarly : labels.tendLate;
  return (
    <div className="results-hist">
      <div className="results-hist__head">
        <span className="results-hist__label">{labels.timing}</span>
        {hasData && (
          <span className="results-hist__verdict">
            {tendency}
            <span className="results-hist__avg">{tendency ? " · " : ""}{labels.avgOffset} {mean >= 0 ? "+" : ""}{mean.toFixed(1)}ms</span>
          </span>
        )}
      </div>
      <svg className="results-hist__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {counts.map((c, i) => {
          const h = (c / maxCount) * (H - 2);
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
        {hasData && (
          <line className="results-hist__mean" x1={meanX} y1={0} x2={meanX} y2={H} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="results-hist__axis">
        <span>{labels.early} −{range}ms</span>
        <span>0</span>
        <span>+{range}ms {labels.late}</span>
      </div>
    </div>
  );
}

// basic view
type PieTierKey = "tier3" | "tier2" | "tier1" | "miss";
const PIE_TIERS: { key: PieTierKey; cls: string }[] = [
  { key: "tier3", cls: "perfect" },
  { key: "tier2", cls: "good" },
  { key: "tier1", cls: "ok" },
  { key: "miss", cls: "miss" },
];
const TIER_CLS: Record<PieTierKey, string> = { tier3: "perfect", tier2: "good", tier1: "ok", miss: "miss" };

function JudgementPie(
  { stats, grade, anim }: { stats: GameStats; grade: Grade; anim: "bounce" | "sway" },
) {
  const [hover, setHover] = useState<PieTierKey | null>(null);
  const total = stats.tier3 + stats.tier2 + stats.tier1 + stats.miss;
  const size = 192;
  const cx = size / 2;
  const cy = size / 2;
  const r = 70;
  const sw = 16;
  const rLabel = r + sw / 2 + 11;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  const segs = PIE_TIERS.map(t => {
    const count = stats[t.key];
    const frac = total > 0 ? count / total : 0;
    const mid = (acc + frac / 2) * 2 * Math.PI - Math.PI / 2;
    const seg = { ...t, count, frac, offset: acc, mid };
    acc += frac;
    return seg;
  });

  const active = segs.filter(s => s.count > 0);
  if (active.length > 1) {
    const MIN_GAP = 0.16;
    for (let iter = 0; iter < 8; iter++) {
      for (let i = 0; i < active.length; i++) {
        const j = (i + 1) % active.length;
        let gap = active[j].mid - active[i].mid;
        if (gap < 0) gap += 2 * Math.PI;
        if (gap < MIN_GAP) {
          const push = (MIN_GAP - gap) / 2;
          active[i].mid -= push;
          active[j].mid += push;
        }
      }
    }
  }
  return (
    <div className="results-pie">
      <svg className="results-pie__chart" viewBox={`0 0 ${size} ${size}`}>
        <circle className="results-pie__track" cx={cx} cy={cy} r={r} fill="none" strokeWidth={sw} />
        {total > 0 && segs.map(s => s.frac > 0 && (
          <circle
            key={s.key}
            className={`results-pie__seg results-pie__seg--${s.cls}`
              + (hover !== null && hover !== s.key ? " is-dim" : "")}
            cx={cx} cy={cy} r={r} fill="none" strokeWidth={sw}
            strokeDasharray={`${s.frac * circ} ${circ}`}
            transform={`rotate(${s.offset * 360 - 90} ${cx} ${cy})`}
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
        {/* start/end notch at top */}
        <line
          className="results-pie__notch"
          x1={cx} y1={cy - r - sw / 2 - 2}
          x2={cx} y2={cy - r + sw / 2 + 2}
          vectorEffect="non-scaling-stroke"
        />
        {total > 0 && segs.map(s => s.count > 0 && (
          <text
            key={s.key}
            className="results-pie__num"
            x={cx + Math.cos(s.mid) * rLabel}
            y={cy + Math.sin(s.mid) * rLabel}
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
          >
            {s.count}
          </text>
        ))}
      </svg>
      <div className="results-pie__mikuwrap">
        <MikuFigure grade={grade} anim={anim} />
      </div>
      <div className={`results-pie__tag${hover ? ` results-pie__tag--${TIER_CLS[hover]} is-shown` : ""}`}>
        {hover ? `${JUDGEMENT_LABEL[hover]}: ${stats[hover]}` : " "}
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
const GRADE_STEPS: { grade: string; min: number }[] = [
  { grade: "C", min: 0.5 }, { grade: "B", min: 0.7 }, { grade: "A", min: 0.85 },
  { grade: "S", min: 0.95 }, { grade: "SS", min: 0.99 }, { grade: "SSS", min: 1.0 },
];

type IssueTier = "tier2" | "tier1" | "miss";
const ISSUE_TIERS: IssueTier[] = ["tier2", "tier1", "miss"];

// Hover cross filter
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
  // Language-stable English song name; with `difficulty` and the chart hash it
  // keys this chart's localStorage personal best. Empty disables PB tracking.
  songId: string;
  artist: string;
  difficulty: string;
  level: number | null;
  bpm: number | null;
}

export function ResultsOverlay({ stats, returnHref, onTryAgain, songName, songId, artist, difficulty, level, bpm }: Props) {
  const lang = useLang();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [focus, setFocus] = useState<Focus>(null);
  const [view, setView] = useState<"pie" | "detailed">("pie");

  // Personal best (issue #72). Commit this run against localStorage exactly once on
  // mount (guarded so it never double-writes), then surface the prior best and a
  // "New Record!" flag. A run with no judged notes is ignored. The chart hash in
  // stats invalidates a best left over from before a chart edit.
  const [pb, setPb] = useState<{ previous: PersonalBest | null; isRecord: boolean } | null>(null);
  const committed = useRef(false);
  useEffect(() => {
    if (committed.current || !songId || stats.total === 0) return;
    committed.current = true;
    setPb(commitPersonalBest(songId, difficulty, {
      accuracy: computeAccuracy(stats),
      grade: computeGrade(stats),
      maxCombo: stats.maxCombo,
      hash: stats.chartHash,
    }));
  }, [songId, difficulty, stats]);

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
  const accView = useCountUp(accuracy * 100);
  const nextStep = GRADE_STEPS.find(s => s.min > accuracy);
  // Achievement badge: an all-PERFECT run, else an unbroken full combo. A combo
  // breaks on a GOOD (tier1) as well as a miss, so a true full combo means the
  // longest streak spans every note — not merely that nothing was missed (#86).
  const badgeKey: "allPerfect" | "fullCombo" | null =
    stats.total === 0 ? null
      : stats.tier3 === stats.total ? "allPerfect"
        : stats.maxCombo === stats.total ? "fullCombo"
          : null;

  const labels = lang === "jp" ? LABELS_JP : LABELS_EN;
  const issueLabels = lang === "jp" ? ISSUE_LABELS_JP : ISSUE_LABELS_EN;
  const noteLabels = lang === "jp" ? NOTE_LABELS_JP : NOTE_LABELS_EN;
  const difficultyName = difficulty ? difficulty.toUpperCase() : "";
  const acceptedHits = stats.hits.filter(hit => hit.result !== "miss");

  // The parenthetical delta on the accuracy "Best" line. A run that beats (or
  // ties) the prior best reads as a gain "(+diff)"; one that falls short reads
  // how far it still has to go — "(あとdiff)" in JP, "(diff to best)" in EN —
  // never a bare minus, so a missed best frames the next attempt, not the loss.
  const bestDelta = (beatsBest: boolean, diff: string): string =>
    beatsBest ? `(+${diff})` : `(${labels.toGo(diff)})`;

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
  const tierCount = (tier: IssueTier): number =>
    focus !== null && focus.dim !== "tier"
      ? countWhere(h => h.tier === tier && matchesFocus(h))
      : stats[tier];
  const issueCount = (issue: IssueReason): number =>
    focus !== null && focus.dim !== "issue"
      ? countWhere(h => h.issue === issue && matchesFocus(h))
      : countWhere(h => h.issue === issue);

  const timingEarly = stats.hits.filter(h => h.issue === "timing" && h.timing === "early").length;
  const timingLate = stats.hits.filter(h => h.issue === "timing" && h.timing === "late").length;

  // A cell is active when it is the hovered cell
  const cellState = (dim: Dim, isHovered: boolean, count: number): string => {
    if (count === 0) return " is-dim";
    const active = focus?.dim === dim ? isHovered : focus !== null && count > 0;
    return (active ? " is-active" : "") + (focus !== null && !active ? " is-dim" : "");
  };

  const noteCellState = (note: NoteKind): string =>
    stats.noteCounts[note] === 0 ? " is-dim"
      : focus?.dim === "note" ? (focus.note === note ? " is-active" : " is-dim") : "";

  const issueIndicator: string =
    focus === null ? labels.hoverFilter
      : focus.dim === "tier" ? JUDGEMENT_LABEL[focus.tier]
        : focus.dim === "note" ? noteLabels[focus.note]
          : focus.issue === "timing"
            ? `${labels.early} ${timingEarly} · ${labels.late} ${timingLate}`
            : issueLabels[focus.issue];

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

  const mikuAnim = (grade === "SSS" || grade === "SS" || grade === "S" || grade === "A")
    ? "bounce" : "sway";

  return (
    <div className="results-overlay">
      <div className={`results-panel${difficulty ? ` results-panel--${difficulty.toLowerCase()}` : ""}`}>
        <div className="results-head">
          <div className="results-songhead">
            <span className="results-songhead__name">{songName}</span>
            {artist && <span className="results-songhead__artist">{artist}</span>}
          </div>
        </div>
        <div className="results-body">
          <div className="results-left">
            <div className={`results-grade results-grade--${grade.toLowerCase()}`}>{grade}</div>
            <div className="results-accuracy">{accView.toFixed(2)}%</div>
            {pb && (
              <div className="results-accuracy-best">
                <span className="results-accuracy-best__label">{labels.best}</span>
                <span className="results-accuracy-best__value">
                  {`${(Math.max(accuracy, pb.previous?.accuracy ?? 0) * 100).toFixed(2)}% `}
                  <span className="results-accuracy-best__hintvalue">
                    {bestDelta(accuracy >= (pb.previous?.accuracy ?? 0),
                      `${(Math.abs(accuracy - (pb.previous?.accuracy ?? 0)) * 100).toFixed(2)}%`)}
                  </span>
                </span>
              </div>
            )}
            {nextStep && (
              <div className="results-next">
                {labels.to(`${((nextStep.min - accuracy) * 100).toFixed(2)}%`, nextStep.grade)}
              </div>
            )}
            {pb?.isRecord && (
              <div className="results-badge results-badge--record">{labels.newRecord}</div>
            )}
            {badgeKey && (
              <div className={`results-badge results-badge--${badgeKey}`}>{labels[badgeKey]}</div>
            )}
            <div className="results-headline">
              <div className="results-stat">
                <span className="results-stat__label">{labels.maxCombo}</span>
                <span className="results-stat__value">{stats.maxCombo}x</span>
              </div>
              {pb && (
                <div className="results-stat results-stat--hint">
                  <span className="results-stat__hintlabel">{labels.best}</span>
                  <span className="results-stat__hintvalue">
                    {`${Math.max(stats.maxCombo, pb.previous?.maxCombo ?? 0)}x`}
                    {stats.maxCombo > (pb.previous?.maxCombo ?? 0) && (
                      ` (+${stats.maxCombo - (pb.previous?.maxCombo ?? 0)})`
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="results-right">
            <button
              className="results-viewtoggle"
              onClick={() => setView(v => (v === "pie" ? "detailed" : "pie"))}
            >
              <span className="results-viewtoggle__caret" aria-hidden="true">&gt;</span>
              <span className="results-viewtoggle__text">
                {view === "pie" ? labels.advancedDetails : labels.basicDetails}
              </span>
            </button>
            {view === "pie" ? (
              <div className="results-pieview">
                <JudgementPie stats={stats} grade={grade} anim={mikuAnim} />
              </div>
            ) : (
              <>
                <div className="results-judgement">
                  <span className="results-section__label">{labels.judgement}</span>
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
                </div>

                <div className="results-issues">
                  <span className="results-issues__label">
                    {labels.issues}
                    <span className={`results-issues__filter${focus === null ? " is-hint" : ""}`}>
                      {" · "}{issueIndicator}
                    </span>
                  </span>
                  <div className="results-issues__list">
                    {ISSUE_ORDER.map(issue => {
                      const count = issueCount(issue);
                      const cls = `results-issue results-issue--${issue}`
                        + cellState("issue", focus?.dim === "issue" && focus.issue === issue, count);
                      return (
                        <span
                          key={issue}
                          className={cls}
                          onPointerEnter={() => setFocus({ dim: "issue", issue })}
                          onPointerLeave={() => setFocus(null)}
                        >
                          <span className="results-issue__kind">{issueLabels[issue]}</span>
                          <span className="results-issue__count">{count}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>

                <TimingHistogram offsets={acceptedHits.map(hit => hit.offsetMs)} labels={labels} />

                <div className="results-chart">
                  <div className="results-chart__meta">
                    {difficultyName && (
                      <span className="results-chart__stat results-chart__diff">
                        <b>{difficultyName}</b>
                        {level != null && <span className="results-chart__level"> {labels.level} {level}</span>}
                      </span>
                    )}
                    {bpm != null && (
                      <span className="results-chart__stat">
                        {labels.bpm} <b>{bpm}</b>
                      </span>
                    )}
                  </div>
                  <div className="results-notes">
                    {NOTE_ORDER.map(note => (
                      <span
                        key={note}
                        className={`results-note results-note--${note}${noteCellState(note)}`}
                        onPointerEnter={() => setFocus({ dim: "note", note })}
                        onPointerLeave={() => setFocus(null)}
                      >
                        <span className="results-note__kind">{noteLabels[note]}</span>
                        <span className="results-note__count">{stats.noteCounts[note]}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="results-actions">
          <a className="results-btn results-btn--back" href={returnHref}>{labels.back}</a>
          <button
            className={`results-btn results-btn--share results-btn--share-${shareStatus}`}
            onClick={handleShare}
          >
            {shareLabel}
          </button>
          <button className="results-btn results-btn--try-again" onClick={onTryAgain}>{labels.tryAgain}</button>
        </div>
      </div>
    </div>
  );
}
