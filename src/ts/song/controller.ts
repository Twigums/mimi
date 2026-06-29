import type { GameHandle, GameStats, HitResult, Note } from "../game/engine";
import { computeLyricHolds } from "../game/lyrics";
import { arToMs, loadAr, loadVolume, subscribeVolume, loadMusicOffset, subscribeMusicOffset } from "../core/settings";
import { withPath } from "../core/sitePath";
import { createStoryboardRenderer, type StoryEntry, type ReactiveFrame } from "./storyboard";
import { loadChorusTimingsJsonc, mergeChorusTimings } from "./chorusTimings";
import { matchLyrics, flattenChars, type ExcludeRange } from "./lyricMatch";
import type { TextAlivePlayer, TextAlivePlayerOptions, TextAliveVideo } from "./textalive";

const JUDGEMENT_WINDOW_MS      = 100;
const GAP_SKIP_SAFETY_MS      = 120;
const GAP_SKIP_MIN_BREAK_MS   = 3000;

export type BreakSkipKind = "gap" | "finish";

interface SongPageDeps {
  game: GameHandle;
  onSongFinish: (stats: GameStats) => void;
  hideResult: () => void;
  onSongInfo?: (nameJp: string, authorJp: string) => void;
  onPreparing?: () => void;
  onPlayerReady?: () => void;
  onPaused?: () => void;
  onBreakSkipAvailable?: (kind: BreakSkipKind | null) => void;
}

interface SongPageHandle {
  stop(): void;
  start(): void;
  skipBreak(): void;
  onLyricOutcome(result: HitResult, x: number, y: number): void;
}

interface BreakSkipTarget {
  kind: BreakSkipKind;
  targetSongMs: number;
}

export function initSongPage({ game, onSongFinish, hideResult, onSongInfo, onPreparing, onPlayerReady, onPaused, onBreakSkipAvailable }: SongPageDeps): SongPageHandle {
  const body    = document.body;
  const songUrl = body.dataset.songUrl ?? "";
  const chartDir = body.dataset.songChartDir ?? "";
  const difficulty = new URL(window.location.href).searchParams.get("d") ?? "expert";
  const chartUrl = chartDir ? `${chartDir}${difficulty}.json` : "";
  const token   = body.dataset.textaliveToken ?? "";

  const beatId               = parseInt(body.dataset.textaliveBeatId ?? "");
  const chordId              = parseInt(body.dataset.textaliveChordId ?? "");
  const repetitiveSegmentId  = parseInt(body.dataset.textaliveRepetitiveSegmentId ?? "");
  const lyricId              = parseInt(body.dataset.textaliveLyricId ?? "");
  const lyricDiffId          = parseInt(body.dataset.textaliveLyricDiffId ?? "");
  const hasVideoIds = !isNaN(beatId) && !isNaN(chordId) && !isNaN(repetitiveSegmentId) && !isNaN(lyricId) && !isNaN(lyricDiffId);
  const chorusTimingsPath = body.dataset.lyricChorusTimings ?? "";

  const btnHudToggle = document.getElementById("btn-hud-toggle")  as HTMLButtonElement | null;
  const songHud      = document.querySelector<HTMLElement>(".song-hud");
  const progressFill = document.getElementById("progress-fill")   as HTMLElement       | null;
  const storyboardEl = document.getElementById("song-storyboard") as HTMLElement       | null;

  if (!progressFill) return { stop() { /* no-op */ }, start() { /* no-op */ }, skipBreak() { /* no-op */ }, onLyricOutcome() { /* no-op */ } };

  if (btnHudToggle && songHud) {
    btnHudToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      songHud.classList.toggle("is-open");
    });
    document.addEventListener("click", (e) => {
      if (!songHud.contains(e.target as Node)) songHud.classList.remove("is-open");
    });
  }

  const funnelEl = document.getElementById("song-funnel") as HTMLElement | null;
  const storyboard = storyboardEl ? createStoryboardRenderer(storyboardEl, funnelEl ?? storyboardEl) : null;
  storyboard?.setApproachMs(arToMs(loadAr()));

  const loadingScreen = document.getElementById("loading-screen");
  const loadingBar    = document.getElementById("loading-bar-fill") as HTMLElement | null;

  let loadingPct = 0;
  let loadingDismissed = false;
  let trickleTimer: ReturnType<typeof setInterval> | null = null;

  const setProgress = (pct: number): void => {
    loadingPct = Math.max(loadingPct, Math.min(100, pct));
    if (loadingBar) loadingBar.style.width = `${loadingPct}%`;
  };

  const stopTrickle = (): void => {
    if (trickleTimer !== null) { clearInterval(trickleTimer); trickleTimer = null; }
  };

  const startTrickle = (ceiling: number): void => {
    if (trickleTimer !== null) return;
    trickleTimer = setInterval(() => setProgress(loadingPct + (ceiling - loadingPct) * 0.08), 250);
  };

  const dismissLoading = (): void => {
    if (loadingDismissed) return;
    loadingDismissed = true;
    stopTrickle();
    setProgress(100);
    if (!loadingScreen) return;
    setTimeout(() => {
      loadingScreen.classList.add("loaded");
      loadingScreen.addEventListener("transitionend", () => loadingScreen.remove(), { once: true });
    }, 400);
  };

  setProgress(8);

  let musicOffsetMs = loadMusicOffset();
  subscribeMusicOffset(v => { musicOffsetMs = v; });
  const gapSkipLeadInMs = arToMs(loadAr()) + JUDGEMENT_WINDOW_MS + GAP_SKIP_SAFETY_MS;

  let player: TextAlivePlayer | null = null;
  let playerReady = false;
  let songLengthMs = 0;
  let finished = false;
  let finishTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSongMs = 0;
  let chartLoaded = false;
  let noteTimes: number[] = [];
  let breakSkipTarget: BreakSkipTarget | null = null;
  let publishedBreakSkipKind: BreakSkipKind | null = null;
  let reportedLoopError = false;

  // Lyric matching is gated on three async inputs TextAlive, chart, and story
  let videoForMatch: TextAliveVideo | null = null;
  let rawVideo: TextAliveVideo | null = null;
  let chorusOverlay: { phrases: ReturnType<typeof loadChorusTimingsJsonc>["phrases"]; wordSizes: number[][] } | null = null;
  let loadedNotes: Note[] | null = null;
  let excludeRanges: ExcludeRange[] = [];
  let storyPending = !!(storyboard && chartDir);
  let chartApplied = false;
  let chorusTimingsReady = !chorusTimingsPath;

  const publishVideoForMatch = (): void => {
    if (!rawVideo) return;
    if (chorusTimingsPath && !chorusTimingsReady) return;
    const merged = chorusOverlay
      ? mergeChorusTimings(rawVideo, chorusOverlay.phrases, chorusOverlay.wordSizes)
      : null;
    videoForMatch = merged?.match ?? rawVideo;
    storyboard?.setVideo(merged?.display ?? rawVideo);
    tryApplyChart();
  };

  if (chorusTimingsPath) {
    (async () => {
      try {
        const res = await fetch(withPath(`/${chorusTimingsPath.replace(/^\//, "")}`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const loaded = loadChorusTimingsJsonc(await res.text());
        chorusOverlay = loaded;
        publishVideoForMatch();
      } catch (err) {
        console.error("[mimi] chorus timings load failed:", err);
      } finally {
        chorusTimingsReady = true;
        tryApplyChart();
      }
    })();
  }

  const isEndMarker = (note: Note): boolean => (note.kind as string).toLowerCase() === "end";
  const playableNotes = (notes: Note[]): Note[] => notes.filter(note => !isEndMarker(note));
  const endMarkerTimes = (notes: Note[]): number[] =>
    notes.flatMap(note => isEndMarker(note) && typeof note.time === "number" ? [note.time] : []);

  const tryApplyChart = (): void => {
    if (chartApplied || !loadedNotes || storyPending) return;
    if (hasVideoIds && !videoForMatch) return;
    if (chorusTimingsPath && !chorusTimingsReady) return;
    const playable = playableNotes(loadedNotes);
    computeLyricHolds(playable, endMarkerTimes(loadedNotes));
    if (videoForMatch) {
      const { charToNote } = matchLyrics(videoForMatch, playable, excludeRanges);
      storyboard?.setLyricMap(charToNote);
    }
    game.setChart(loadedNotes);
    chartApplied = true;
  };

  // Reactive storyboard directives
  let reactiveModes = new Set<string>();
  let hasPulse = false;
  let maxAmplitude = 1;
  let choruses: { startTime: number; endTime: number }[] = [];

  const moodToColor = (v: number, a: number): string => {
    const valence = (v + 1) / 2;
    const arousal = (a + 1) / 2;
    const r = (1.1 - valence) * 2;
    const b = (0.85 - arousal) * 2;
    const g = -0.5 * (Math.hypot(r, b) - 2);
    const ch = (x: number): number => Math.round(Math.max(0, Math.min(1, x)) * 255);
    return `rgb(${ch(r)}, ${ch(g)}, ${ch(b)})`;
  };

  const computeReactive = (songMs: number): ReactiveFrame | undefined => {
    if (!player || (reactiveModes.size === 0 && !hasPulse)) return undefined;
    const beat = player.findBeat(songMs);
    const beatProgress = beat ? Math.max(0, Math.min(1, beat.progress(songMs))) : 0;
    let ampScale = 1;
    if (reactiveModes.has("amplitude")) {
      const ratio = Math.max(0, Math.min(1, player.getVocalAmplitude(songMs) / maxAmplitude));
      ampScale = 1 + 0.5 * ratio;
    }
    let moodColor: string | null = null;
    if (reactiveModes.has("mood")) {
      const va = player.getValenceArousal(songMs);
      moodColor = moodToColor(va.v, va.a);
    }
    const chorus = reactiveModes.has("chorus")
      && choruses.some(c => songMs >= c.startTime && songMs <= c.endTime);
    return { beatProgress, ampScale, moodColor, chorus };
  };

  let isPlaying = false;
  let awaitingRewind = false;

  const triggerFinish = (): void => {
    if (finished) return;
    finished = true;
    isPlaying = false;
    publishBreakSkip(null);
    onSongFinish(game.getStats());
  };

  function publishBreakSkip(kind: BreakSkipKind | null): void {
    if (publishedBreakSkipKind === kind) return;
    publishedBreakSkipKind = kind;
    onBreakSkipAvailable?.(kind);
  }

  const setBreakSkipTarget = (target: BreakSkipTarget | null): void => {
    breakSkipTarget = target;
    publishBreakSkip(target?.kind ?? null);
  };

  const dismissResult = (): void => {
    hideResult();
  };

  // The finish timer is wall-clock, so it must only run while the song is actually
  // advancing — otherwise a long pause/tab-out lets it elapse and pops results mid-song.
  const clearFinishTimeout = (): void => {
    if (finishTimeout !== null) { clearTimeout(finishTimeout); finishTimeout = null; }
  };

  const scheduleFinishTimeout = (fromSongMs: number): void => {
    clearFinishTimeout();
    if (songLengthMs > 0) finishTimeout = setTimeout(triggerFinish, Math.max(0, songLengthMs - fromSongMs));
  };

  const resetPlayback = (): void => {
    clearFinishTimeout();
    finished = false;
    isPlaying = false;
    autoPaused = false;
    autoPauseSavedMs = 0;
    isResuming = false;
    awaitingRewind = true;
    setBreakSkipTarget(null);
    game.reset();
    storyboard?.reset();
    progressFill.style.width = "0%";
    lastSongMs = 0;
  };

  let autoPaused = false;
  let autoPauseSavedMs = 0;
  let isResuming = false;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (player && isPlaying) {
        player.requestPause();
        // Directly pause the media element — more reliable than requestPause alone
        const media = document.querySelector<HTMLMediaElement>("#textalive-media audio, #textalive-media video");
        media?.pause();
        // Kill the wall-clock finish timer immediately: while backgrounded `onPause` may be
        // throttled, and a long tab-out would otherwise let it fire and pop results mid-song.
        clearFinishTimeout();
        autoPaused = true;
        autoPauseSavedMs = player.timer.position;
      }
      return;
    }
    if (autoPaused) {
      autoPaused = false;
      const currentMs = player?.timer.position ?? 0;
      console.log("[mimi] Tab returned, resuming from auto-pause. Saved: %d, current: %d, drift: %d",
        autoPauseSavedMs, currentMs, currentMs - autoPauseSavedMs);
      // If the player continued in the background despite pause, position will
      // have jumped. Reload to recover a clean state.
      if (autoPauseSavedMs > 0 && currentMs - autoPauseSavedMs > 2000) {
        console.warn("[mimi] Song drifted while tabbed out — reloading to recover.");
        window.location.reload();
        return;
      }
      isResuming = true;
      player?.requestStop();
      game.setPlaying(false);
      console.log("[mimi] Calling onPaused callback: %s", typeof onPaused);
      onPaused?.();
      return;
    }
  });

  const TextAliveApp = window.TextAliveApp;
  if (!songUrl || !token) {
    dismissLoading();
    onPlayerReady?.();
  } else if (TextAliveApp) {
    const mediaElement = document.getElementById("textalive-media");
    const opts: TextAlivePlayerOptions = {
      app: { token },
      mediaElement,
    };

    const loadTimeout = setTimeout(() => {
      playerReady = true;
      onPlayerReady?.();
      dismissLoading();
    }, 15000);

    player = new TextAliveApp.Player(opts);
    subscribeVolume(v => { if (player) player.volume = v; });
    player.addListener({
      onAppReady(app) {
        if (!app.songUrl && player) {
          setProgress(30);
          const videoOpts = hasVideoIds ? {
            video: { beatId, chordId, repetitiveSegmentId, lyricId, lyricDiffId }
          } : undefined;
          player.createFromSongUrl(songUrl, videoOpts).catch(err => {
            stopTrickle();
            console.error("[mimi] createFromSongUrl failed:", err);
          });
          startTrickle(88);
        }
      },
      onVideoReady(video) {
        rawVideo = video;
        publishVideoForMatch();
        maxAmplitude = player?.getMaxVocalAmplitude() || 1;
        choruses = player?.getChoruses() ?? [];
        songLengthMs = video.duration;
        if (player?.data.song) {
          const { name, artist } = player.data.song;
          onSongInfo?.(name, artist.name);
        }
        onPreparing?.();
        dismissLoading();
      },
      onTimerReady() {
        clearTimeout(loadTimeout);
        playerReady = true;
        onPlayerReady?.();
        dismissLoading();
        if (player) player.volume = loadVolume();
      },
      onPlay() {
        isPlaying = true;
        finished = false;
        game.start();
        if (!awaitingRewind) scheduleFinishTimeout(player?.timer.position ?? 0);
      },
      onPause() { isPlaying = false; clearFinishTimeout(); game.setPlaying(false); },
      onStop()  { isPlaying = false; finished = false; clearFinishTimeout(); setBreakSkipTarget(null); game.setPlaying(false); },
    });
  } else {
    setTimeout(dismissLoading, 15000);
  }

  (async () => {
    if (!chartUrl) return;
    try {
      let res = await fetch(chartUrl);
      if (!res.ok && difficulty !== "expert") {
        res = await fetch(`${chartDir}expert.json`);
      }
      if (!res.ok) return;
      const notes = (await res.json() as Note[]).slice().sort((a, b) => a.time - b.time);
      noteTimes = playableNotes(notes).map(note => note.time);
      chartLoaded = true;
      loadedNotes = notes;
      tryApplyChart();
    } catch (err) {
      console.error("[mimi] chart load failed:", err);
    }
  })();

  if (storyboard && chartDir) {
    (async () => {
      try {
        const res = await fetch(`${chartDir}${difficulty}.story.json`);
        if (res.ok) {
          const entries = await res.json() as StoryEntry[];
          excludeRanges = entries
            .filter((e): e is Extract<StoryEntry, { type: "exclude" }> => e.type === "exclude")
            .map(e => ({ from: e.from, to: e.to }));
          const reactiveEntry = entries.find((e): e is Extract<StoryEntry, { type: "reactive" }> => e.type === "reactive");
          reactiveModes = new Set(reactiveEntry?.modes ?? []);
          hasPulse = entries.some(e => (e.type === "move" || e.type === "lyric") && !!e.style?.pulse);
          storyboard.setStoryData(entries);
        }
      } catch (err) {
        console.error("[mimi] story load failed:", err);
      } finally {
        storyPending = false;
        tryApplyChart();
      }
    })();
  }

  const btnFullscreen = document.getElementById("btn-fullscreen") as HTMLButtonElement | null;
  if (btnFullscreen) {
    const syncFullscreenIcon = (): void => {
      btnFullscreen.classList.toggle("is-fullscreen", !!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", syncFullscreenIcon);
    btnFullscreen.addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    });
  }

  const findNextJudgableNoteIndex = (gameSongMs: number): number => {
    let lo = 0;
    let hi = noteTimes.length;
    const cutoff = gameSongMs - JUDGEMENT_WINDOW_MS;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (noteTimes[mid] < cutoff) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const makeBreakSkipTarget = (
    fromSongMs: number,
    targetSongMs: number,
    breakRemainingMs: number,
    kind: BreakSkipKind,
  ): BreakSkipTarget | null => {
    if (songLengthMs <= 0) return null;
    if (breakRemainingMs < GAP_SKIP_MIN_BREAK_MS) return null;
    const clampedTarget = Math.max(0, Math.min(songLengthMs, Math.floor(targetSongMs)));
    if (clampedTarget <= fromSongMs) return null;
    return { kind, targetSongMs: clampedTarget };
  };

  const findBreakSkipTarget = (songMs: number, gameSongMs: number): BreakSkipTarget | null => {
    if (!playerReady || !player || !isPlaying || awaitingRewind || finished || !chartLoaded) return null;

    if (noteTimes.length === 0) {
      return makeBreakSkipTarget(songMs, songLengthMs, songLengthMs - songMs, "finish");
    }

    const nextIndex = findNextJudgableNoteIndex(gameSongMs);
    const nextNoteTime = noteTimes[nextIndex];

    if (nextNoteTime !== undefined) {
      if (nextNoteTime <= gameSongMs + JUDGEMENT_WINDOW_MS) return null;
      return makeBreakSkipTarget(
        songMs,
        nextNoteTime - gapSkipLeadInMs + musicOffsetMs,
        nextNoteTime - gameSongMs,
        "gap",
      );
    }

    const lastNoteTime = noteTimes[noteTimes.length - 1];
    if (songLengthMs > 0 && gameSongMs > lastNoteTime + JUDGEMENT_WINDOW_MS) {
      return makeBreakSkipTarget(songMs, songLengthMs, songLengthMs - songMs, "finish");
    }

    return null;
  };

  const loop = (): void => {
    try {
      const songMs = player?.timer.position ?? 0;
      if (songMs > 0) lastSongMs = songMs;
      const waitingForStartRewind = awaitingRewind && songMs > gapSkipLeadInMs;
      const gameSongMs = waitingForStartRewind ? 0 : songMs - musicOffsetMs;
      game.tick(gameSongMs, isPlaying && !waitingForStartRewind);
      if (!waitingForStartRewind && songMs > 0) storyboard?.update(songMs, computeReactive(songMs));
      setBreakSkipTarget(waitingForStartRewind ? null : findBreakSkipTarget(songMs, songMs - musicOffsetMs));

      if (songLengthMs > 0) {
        const progressSongMs = waitingForStartRewind ? 0 : songMs;
        const pct = Math.max(0, Math.min(100, (progressSongMs / songLengthMs) * 100));
        progressFill.style.width = `${pct}%`;

        if (awaitingRewind) {
          if (songMs <= gapSkipLeadInMs) {
            awaitingRewind = false;
            if (isPlaying) scheduleFinishTimeout(songMs);
          }
        } else if (songMs >= songLengthMs) {
          triggerFinish();
        }
      }
    } catch (err) {
      if (!reportedLoopError) {
        reportedLoopError = true;
        console.error("[mimi] song animation loop failed:", err);
      }
    } finally {
      requestAnimationFrame(loop);
    }
  };

  requestAnimationFrame(loop);

  return {
    stop(): void {
      if (!playerReady || !player) return;
      dismissResult();
      resetPlayback();
      player.requestStop();
    },
    start(): void {
      if (!playerReady || !player) return;
      dismissResult();
      if (isResuming) {
        isResuming = false;
        player.requestMediaSeek(autoPauseSavedMs);
        game.setPlaying(true);
      } else {
        awaitingRewind = true;
        game.reset();
        player.requestMediaSeek(0);
      }
      player.requestPlay();
    },
    skipBreak(): void {
      if (!playerReady || !player || !isPlaying || !breakSkipTarget) return;
      const target = breakSkipTarget;
      setBreakSkipTarget(null);
      player.requestMediaSeek(target.targetSongMs);
      if (target.kind === "finish") triggerFinish();
    },
    onLyricOutcome(result, x, y): void {
      storyboard?.markLyricOutcome(x, y, result);
    },
  };
}
