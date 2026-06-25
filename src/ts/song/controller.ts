import type { GameHandle, GameStats, Note } from "../game/engine";
import { arToMs, loadAr, loadVolume, subscribeVolume, loadMusicOffset, subscribeMusicOffset } from "../core/settings";
import { createStoryboardRenderer, type StoryEntry } from "./storyboard";
import { makeCharLookup } from "./charLookup";
import type { TextAlivePlayer, TextAlivePlayerOptions } from "./textalive";

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
  onBreakSkipAvailable?: (kind: BreakSkipKind | null) => void;
}

interface SongPageHandle {
  stop(): void;
  start(): void;
  skipBreak(): void;
}

interface BreakSkipTarget {
  kind: BreakSkipKind;
  targetSongMs: number;
}

export function initSongPage({ game, onSongFinish, hideResult, onSongInfo, onPreparing, onPlayerReady, onBreakSkipAvailable }: SongPageDeps): SongPageHandle {
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

  const btnHudToggle = document.getElementById("btn-hud-toggle")  as HTMLButtonElement | null;
  const songHud      = document.querySelector<HTMLElement>(".song-hud");
  const progressFill = document.getElementById("progress-fill")   as HTMLElement       | null;
  const storyboardEl = document.getElementById("song-storyboard") as HTMLElement       | null;

  if (!progressFill) return { stop() { /* no-op */ }, start() { /* no-op */ }, skipBreak() { /* no-op */ } };

  if (btnHudToggle && songHud) {
    btnHudToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      songHud.classList.toggle("is-open");
    });
    document.addEventListener("click", (e) => {
      if (!songHud.contains(e.target as Node)) songHud.classList.remove("is-open");
    });
  }

  const storyboard = storyboardEl ? createStoryboardRenderer(storyboardEl) : null;

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

  // TextAlive emits no progress events while fetching the song analysis, so ease
  // the bar asymptotically toward a ceiling to keep it visibly moving meanwhile.
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
  // Lives for the page lifetime (like subscribeVolume below); never torn down,
  // so live music-offset changes keep applying across retries.
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

  let isPlaying = false;
  // Mirrors the engine's `skipExpiry`: after a play/restart request the player's
  // timer can briefly report a stale near-duration position before the seek to the
  // start lands. While true, the loop must not finish the song (or schedule the
  // finish timeout) off that stale value; cleared once the timer rewinds near zero.
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

  const scheduleFinishTimeout = (fromSongMs: number): void => {
    if (finishTimeout !== null) { clearTimeout(finishTimeout); finishTimeout = null; }
    if (songLengthMs > 0) finishTimeout = setTimeout(triggerFinish, Math.max(0, songLengthMs - fromSongMs));
  };

  const resetPlayback = (): void => {
    if (finishTimeout !== null) { clearTimeout(finishTimeout); finishTimeout = null; }
    finished = false;
    isPlaying = false;
    awaitingRewind = true;
    setBreakSkipTarget(null);
    game.reset();
    storyboard?.reset();
    progressFill.style.width = "0%";
    lastSongMs = 0;
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (songLengthMs > 0 && lastSongMs >= songLengthMs) triggerFinish();
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
        storyboard?.setVideo(video);
        game.setCharLookup(makeCharLookup(video));
        // Expose the ready video for the `lyrictrace` capture snippet (see its
        // `--help`): it reads real char timings straight from the console.
        window.__mimiVideo = video;
        songLengthMs = video.duration;
        if (player?.data.song) {
          const { name, artist } = player.data.song;
          onSongInfo?.(name, artist.name);
        }
        // Analysis is ready: drop the loading screen now and let the audio keep
        // buffering behind a "preparing" indicator on the song page itself.
        onPreparing?.();
        dismissLoading();
      },
      onTimerReady() {
        clearTimeout(loadTimeout);
        // Audio is buffered: reveal the Start button, which triggers playback
        // from the user's click gesture (so no autoplay-policy rejection).
        playerReady = true;
        onPlayerReady?.();
        dismissLoading();
        if (player) player.volume = loadVolume();
      },
      onPlay() {
        isPlaying = true;
        finished = false;
        game.start();
        // Defer the finish timeout until the timer confirms it rewound near the
        // start; the loop schedules it when `awaitingRewind` clears, so a stale
        // near-duration position here can't fire the finish almost immediately.
        if (!awaitingRewind) scheduleFinishTimeout(player?.timer.position ?? 0);
      },
      // Propagate self-initiated pause/stop (e.g. an autoplay-blocked or stalled
      // play) to the UI's playing state, otherwise the Start prompt stays hidden
      // and the player is left with no way to (re)start playback.
      onPause() { isPlaying = false; game.setPlaying(false); },
      onStop()  { isPlaying = false; finished = false; setBreakSkipTarget(null); game.setPlaying(false); },
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
      noteTimes = notes.map(note => note.time);
      chartLoaded = true;
      game.setChart(notes);
    } catch (err) {
      console.error("[mimi] chart load failed:", err);
    }
  })();

  if (storyboard && chartDir) {
    (async () => {
      try {
        const res = await fetch(`${chartDir}${difficulty}.story.json`);
        if (!res.ok) return;
        const entries = await res.json() as StoryEntry[];
        storyboard.setStoryData(entries);
      } catch (err) {
        console.error("[mimi] story load failed:", err);
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
    if (!playerReady || !player || !isPlaying || finished || !chartLoaded) return null;

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
      game.tick(songMs - musicOffsetMs);
      if (songMs > 0) storyboard?.update(songMs);
      setBreakSkipTarget(findBreakSkipTarget(songMs, songMs - musicOffsetMs));

      if (songLengthMs > 0) {
        const pct = Math.max(0, Math.min(100, (songMs / songLengthMs) * 100));
        progressFill.style.width = `${pct}%`;

        if (awaitingRewind) {
          // Clear once the timer has actually rewound into the lead-in window; a
          // stale near-duration position right after a start request must not pass.
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
      // Guard the finish/expiry paths against a stale near-duration timer position
      // until the player rewinds. game.reset() arms the engine's matching skipExpiry
      // (the first start has no preceding reset), and clears any leftover state.
      awaitingRewind = true;
      game.reset();
      player.requestPlay();
    },
    skipBreak(): void {
      if (!playerReady || !player || !isPlaying || !breakSkipTarget) return;
      const target = breakSkipTarget;
      setBreakSkipTarget(null);
      player.requestMediaSeek(target.targetSongMs);
      if (target.kind === "finish") triggerFinish();
    },
  };
}
