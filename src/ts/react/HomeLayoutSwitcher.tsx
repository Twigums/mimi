import { useEffect, useMemo, useRef, useState } from "react";
import { warmSongOrigins } from "../core/preload";
import { withPath } from "../core/sitePath";
import { useLang } from "./hooks/useLang";
import { OptionsPanel } from "./OptionsPanel";
import { TestPlay } from "./TestPlay";
import type { TestPlayHandle } from "./TestPlay";

type Layout = "original" | "play" | "info" | "tutorial";

interface Props {
  infoContent:        string;
  infoContentJp:      string;
  tutorialContent:    string;
  tutorialContentJp:  string;
  songsManifest:      string;
}

interface DifficultyInfo {
  id: string;
  labelEn: string;
  labelJp: string;
  level: number;
  ar: number | null;
  noteCount: number;
  cutCount: number;
  flowCount: number;
  lyricCount: number;
  playableMs: number | null;
  density: number | null;
}

interface SongEntry {
  id: string;
  titleEn: string;
  titleJp: string;
  authorEn: string;
  authorJp: string;
  mapper: string;
  sourceUrl: string;
  href: string;
  bpm: number | null;
  difficulties: DifficultyInfo[];
}

interface ManifestSong {
  id: string;
  titleEn: string;
  titleJp: string;
  authorEn: string;
  authorJp: string;
  mapper?: string;
  sourceUrl?: string;
  href: string;
  bpm: number | null;
  difficulties: {
    id: string;
    level: number;
    ar?: number | null;
    noteCount?: number;
    cutCount?: number;
    flowCount?: number;
    flickCount?: number;
    streamCount?: number;
    lyricCount?: number;
    playableMs?: number | null;
    density?: number | null;
  }[];
}

const DIFF_LABELS: Record<string, { labelEn: string; labelJp: string }> = {
  easy:   { labelEn: "EASY",   labelJp: "EASY" },
  medium: { labelEn: "MEDIUM", labelJp: "MEDIUM" },
  hard:   { labelEn: "HARD",   labelJp: "HARD" },
  expert: { labelEn: "EXPERT", labelJp: "EXPERT" },
};

function parseManifest(json: string): SongEntry[] {
  try {
    const data = JSON.parse(json) as { songs?: ManifestSong[] };
    return (data.songs ?? []).map(s => ({
      id: s.id,
      titleEn: s.titleEn,
      titleJp: s.titleJp,
      authorEn: s.authorEn,
      authorJp: s.authorJp,
      mapper: s.mapper ?? "",
      sourceUrl: s.sourceUrl ?? "",
      href: s.href,
      bpm: s.bpm ?? null,
      difficulties: s.difficulties
        .filter(d => d.id in DIFF_LABELS)
        .map(d => ({
          id: d.id,
          level: d.level,
          ar: d.ar ?? null,
          noteCount: d.noteCount ?? 0,
          cutCount: d.cutCount ?? d.flickCount ?? 0,
          flowCount: d.flowCount ?? d.streamCount ?? 0,
          lyricCount: d.lyricCount ?? 0,
          playableMs: d.playableMs ?? null,
          density: d.density ?? null,
          ...DIFF_LABELS[d.id],
        })),
    }));
  } catch {
    return [];
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "--";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDensity(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "--";
  return `${v.toFixed(1)}/s`;
}

export function HomeLayoutSwitcher({ infoContent, infoContentJp, tutorialContent, tutorialContentJp, songsManifest }: Props) {
  const songs = useMemo(() => parseManifest(songsManifest), [songsManifest]);

  const [layout, setLayout] = useState<Layout>("original");
  const [currentLayout, setCurrentLayout] = useState<Layout>(layout);
  const [exiting, setExiting] = useState(false);
  const [paneKey, setPaneKey] = useState(0);
  const exitTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tutorialRef     = useRef<TestPlayHandle>(null);
  const tutorialInfoRef = useRef<HTMLDivElement>(null);

  const [tutorialHintHovered, setTutorialHintHovered] = useState(false);
  const mikuVariant = useMemo(() => (Math.random() < 0.5 ? "miku_A" : "miku_S"), []);

  const [selectedSong, setSelectedSong] = useState<SongEntry | null>(null);
  const [renderedSong, setRenderedSong] = useState<SongEntry | null>(null);
  const [activeDiffId, setActiveDiffId] = useState<string | null>(null);
  const [songExiting, setSongExiting] = useState(false);
  const [songPaneKey, setSongPaneKey] = useState(0);
  const songTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (layout === currentLayout) return;
    setExiting(true);
    exitTimer.current = setTimeout(() => {
      setCurrentLayout(layout);
      setPaneKey(k => k + 1);
      setExiting(false);
    }, 240);
    return () => {
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    };
  }, [layout, currentLayout]);

  useEffect(() => {
    if (selectedSong === renderedSong) return;
    setSongExiting(true);
    songTimer.current = setTimeout(() => {
      setRenderedSong(selectedSong);
      setSongPaneKey(k => k + 1);
      setSongExiting(false);
    }, 240);
    return () => {
      if (songTimer.current !== null) clearTimeout(songTimer.current);
    };
  }, [selectedSong, renderedSong]);

  useEffect(() => {
    setActiveDiffId(renderedSong?.difficulties[0]?.id ?? null);
    // The difficulty select is the last screen before navigating to a song;
    // warm the song-page origins now so its TextAlive load starts on warm sockets.
    if (renderedSong) warmSongOrigins();
  }, [renderedSong]);

  useEffect(() => () => {
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    if (songTimer.current !== null) clearTimeout(songTimer.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedSong !== null) {
        setSelectedSong(null);
      } else if (layout !== "original") {
        setLayout("original");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layout, selectedSong]);

  const lang = useLang();
  const t = (en: string, jp: string) => lang === "jp" ? jp : en;
  const activeDiff = renderedSong?.difficulties.find(diff => diff.id === activeDiffId)
    ?? renderedSong?.difficulties[0]
    ?? null;

  const activeInfoContent     = lang === "jp" && infoContentJp     ? infoContentJp     : infoContent;
  const activeTutorialContent = lang === "jp" && tutorialContentJp ? tutorialContentJp : tutorialContent;

  useEffect(() => {
    if (currentLayout !== "tutorial") return;
    const el = tutorialInfoRef.current;
    if (!el) return;
    const update = (): void => {
      const top    = el.scrollTop > 0;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const t = top    ? "transparent 0, black 2rem," : "";
      const b = bottom ? ", black calc(100% - 2rem), transparent" : "";
      const mask = `linear-gradient(to bottom, ${t}black${b})`;
      el.style.setProperty("mask-image", mask);
      el.style.setProperty("-webkit-mask-image", mask);
    };
    const raf = requestAnimationFrame(update);
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [currentLayout, activeTutorialContent]);

  const handlePlayClick = () => {
    setSelectedSong(null);
    setRenderedSong(null);
    setLayout("play");
  };

  return (
    <>
    <div className={`layout-container${layout === "tutorial" || currentLayout === "tutorial" ? " layout-container--tutorial" : ""}`}>
      <OptionsPanel />
      <div className={`layout-pane${exiting ? " exiting" : ""}`} key={paneKey}>
        {currentLayout === "original" && (
          <>
            <button className="btn-main" onClick={handlePlayClick}>
              {t("Play", "プレイ")}
            </button>
            <button
              className={`btn-main${tutorialHintHovered ? " btn-main--shine" : ""}`}
              onClick={() => setLayout("tutorial")}
            >
              {t("Tutorial", "チュートリアル")}
            </button>
            <button className="btn-main" onClick={() => setLayout("info")}>
              {t("Info", "情報")}
            </button>
          </>
        )}
        {currentLayout === "play" && (
          <div className={`song-pane${songExiting ? " exiting" : ""}`} key={songPaneKey}>
            {!renderedSong && (
              <>
                <div className="song-list">
                  {songs.map(song => (
                    <div key={song.id} className="song-list-entry">
                      <button
                        className="btn-main"
                        onClick={() => setSelectedSong(song)}
                      >
                        <span className="song-btn-title">{t(song.titleEn, song.titleJp)}</span>
                        <span className="song-btn-artist">{t(song.authorEn, song.authorJp)}</span>
                      </button>
                      {song.bpm !== null && (
                        <span className="song-bpm">BPM: {song.bpm}</span>
                      )}
                    </div>
                  ))}
                  {songs.length === 0 && (
                    <p className="placeholder-text">
                      {t("No songs available.", "曲がありません。")}
                    </p>
                  )}
                  <p className="placeholder-text">
                    {t("More songs will be added later.", "他の曲は後に追加されます。")}
                  </p>
                </div>
                <button className="btn-back" onClick={() => setLayout("original")}>
                  {t("Back", "戻る")}
                </button>
              </>
            )}
            {renderedSong && (
              <>
                <div className="song-detail-header">
                  <span className="song-title">{t(renderedSong.titleEn, renderedSong.titleJp)}</span>
                  <span className="song-artist">{t(renderedSong.authorEn, renderedSong.authorJp)}</span>
                  <div className="song-static-meta">
                    {renderedSong.bpm !== null && <span>BPM {renderedSong.bpm}</span>}
                    {renderedSong.mapper && <span>{t("Mapped by", "譜面")}: {renderedSong.mapper}</span>}
                    {renderedSong.sourceUrl && (
                      <a className="song-source-link" href={renderedSong.sourceUrl} target="_blank" rel="noreferrer">
                        {t("Source", "ソース")}
                      </a>
                    )}
                  </div>
                </div>

                <div className="difficulty-select">
                  <div className="difficulty-list">
                    {renderedSong.difficulties.map(diff => (
                      <a
                        key={diff.id}
                        href={`${renderedSong.href}?d=${diff.id}`}
                        className={`btn-main diff-btn diff-btn--${diff.id}${activeDiff?.id === diff.id ? " active" : ""}`}
                        onMouseEnter={() => setActiveDiffId(diff.id)}
                        onFocus={() => setActiveDiffId(diff.id)}
                        onPointerDown={() => setActiveDiffId(diff.id)}
                        aria-describedby="difficulty-detail"
                      >
                        <span className="diff-level">{diff.level}</span>
                        <span className="diff-label">{t(diff.labelEn, diff.labelJp)}</span>
                      </a>
                    ))}
                  </div>

                  {activeDiff && (
                    <div className="difficulty-detail" id="difficulty-detail" aria-live="polite">
                      <div className="difficulty-detail-title">
                        <span>{t(activeDiff.labelEn, activeDiff.labelJp)}</span>
                        <strong>{activeDiff.level}</strong>
                      </div>
                      <div className="difficulty-stats">
                        <span>{t("Notes", "ノーツ")}: {activeDiff.noteCount}</span>
                        <span>{t("Cuts", "カット")}: {activeDiff.cutCount}</span>
                        <span>{t("Flows", "フロー")}: {activeDiff.flowCount}</span>
                        <span>{t("Lyrics", "歌詞")}: {activeDiff.lyricCount}</span>
                        <span>{t("Length", "長さ")}: {formatDuration(activeDiff.playableMs)}</span>
                        <span>{t("Density", "密度")}: {formatDensity(activeDiff.density)}</span>
                        <span>{activeDiff.ar === null ? "AR --" : `AR ${activeDiff.ar}`}</span>
                      </div>
                    </div>
                  )}
                </div>
                <button className="btn-back" onClick={() => setSelectedSong(null)}>
                  {t("Back", "戻る")}
                </button>
              </>
            )}
          </div>
        )}
        {currentLayout === "info" && (
          <>
            <div
              className="info-content"
              dangerouslySetInnerHTML={{ __html: activeInfoContent }}
            />
            <button className="btn-back" onClick={() => setLayout("original")}>
              {t("Back", "戻る")}
            </button>
          </>
        )}
        {currentLayout === "tutorial" && (
          <>
            <div className="tutorial-layout">
              <div
                ref={tutorialInfoRef}
                className="tutorial-info"
                dangerouslySetInnerHTML={{ __html: activeTutorialContent }}
                onClick={(e) => {
                  const el = e.target as HTMLElement;
                  if (el.tagName !== "A") return;
                  const href = (el as HTMLAnchorElement).getAttribute("href") ?? "";
                  if (!href.startsWith("spawn:")) return;
                  e.preventDefault();
                  const rawKind = href.slice(6);
                  const kind = rawKind === "flick" ? "cut" : rawKind === "stream" ? "flow" : rawKind;
                  if (kind === "cut" || kind === "flow" || kind === "lyric") {
                    tutorialRef.current?.spawnNote(kind);
                  }
                }}
              />
              <TestPlay ref={tutorialRef} variant="tutorial" arOverride={1} />
            </div>
            <button className="btn-back" onClick={() => setLayout("original")}>
              {t("Back", "戻る")}
            </button>
          </>
        )}
      </div>
    </div>

    {currentLayout === "original" && (
      <div className={`miku-hint${exiting ? " miku-hint--exiting" : ""}`} aria-hidden="true">
        <div className="miku-hint__cloud">
          <div className="miku-hint__bubble">
            <span className="miku-hint__text">
              {t("Is this your first time? Try reading the ", "初めてですか？")}
              <span
                className="miku-hint__tutorial-word"
                onPointerEnter={() => setTutorialHintHovered(true)}
                onPointerLeave={() => setTutorialHintHovered(false)}
                onClick={() => setLayout("tutorial")}
              >
                {t("tutorial", "チュートリアル")}
              </span>
              {t("!", "を読んでみて！")}
            </span>
          </div>
        </div>
        <img className="miku-hint__miku" src={withPath(`/images/miku/${mikuVariant}.svg`)} alt="" />
      </div>
    )}
    </>
  );
}
