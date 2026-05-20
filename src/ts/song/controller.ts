import type { GameHandle, GameStats, Note } from "../game/engine";
import { loadVolume, subscribeVolume, loadMusicOffset, subscribeMusicOffset } from "../core/settings";
import { createStoryboardRenderer, type StoryEntry } from "./storyboard";
import type { TextAliveChar, TextAlivePlayer, TextAlivePlayerOptions, TextAliveVideo } from "./textalive";

function charDist(c: TextAliveChar, timeMs: number): number {
  if (timeMs >= c.startTime && timeMs <= c.endTime) return 0;
  return Math.min(Math.abs(c.startTime - timeMs), Math.abs(c.endTime - timeMs));
}

function makeCharLookup(video: TextAliveVideo): (timeMs: number) => { text: string; distMs: number } | null {
  const chars: TextAliveChar[] = [];
  let phrase = video.firstPhrase;
  while (phrase) {
    let c = phrase.firstChar;
    while (c) { chars.push(c); c = c.next; }
    phrase = phrase.next;
  }
  if (chars.length === 0) return () => null;
  return (timeMs: number) => {
    let best = chars[0];
    let bestDist = charDist(best, timeMs);
    for (let i = 1; i < chars.length; i++) {
      const dist = charDist(chars[i], timeMs);
      if (dist < bestDist) { bestDist = dist; best = chars[i]; }
    }
    return { text: best.text, distMs: bestDist };
  };
}

interface SongPageDeps {
  game: GameHandle;
  onSongFinish: (stats: GameStats) => void;
  hideResult: () => void;
  onSongInfo?: (nameJp: string, authorJp: string) => void;
  onPlayerReady?: () => void;
}

interface SongPageHandle {
  stop(): void;
  togglePlay(): void;
}

export function initSongPage({ game, onSongFinish, hideResult, onSongInfo, onPlayerReady }: SongPageDeps): SongPageHandle {
  const body    = document.body;
  const songUrl = body.dataset.songUrl ?? "";
  const chartDir = body.dataset.songChartDir ?? "";
  const difficulty = new URL(window.location.href).searchParams.get("d") ?? "expert";
  const chartUrl = chartDir ? `${chartDir}chart-${difficulty}.json` : "";
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

  if (!progressFill) return { stop() { /* no-op */ }, togglePlay() { /* no-op */ } };

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

  const setProgress = (pct: number): void => {
    if (loadingBar) loadingBar.style.width = `${pct}%`;
  };

  const dismissLoading = (): void => {
    if (!loadingScreen) return;
    setProgress(100);
    setTimeout(() => {
      loadingScreen.classList.add("loaded");
      loadingScreen.addEventListener("transitionend", () => loadingScreen.remove(), { once: true });
    }, 400);
  };

  if (loadingBar) setProgress(30);

  let musicOffsetMs = loadMusicOffset();
  const unsubMusicOffset = subscribeMusicOffset(v => { musicOffsetMs = v; });

  let player: TextAlivePlayer | null = null;
  let playerReady = false;
  let songLengthMs = 0;
  let finished = false;
  let finishTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastSongMs = 0;

  let isPlaying = false;

  const triggerFinish = (): void => {
    if (finished) return;
    finished = true;
    isPlaying = false;
    onSongFinish(game.getStats());
  };

  const dismissResult = (): void => {
    hideResult();
  };

  const resetPlayback = (): void => {
    if (finishTimeout !== null) { clearTimeout(finishTimeout); finishTimeout = null; }
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
          const videoOpts = hasVideoIds ? {
            video: { beatId, chordId, repetitiveSegmentId, lyricId, lyricDiffId }
          } : undefined;
          player.createFromSongUrl(songUrl, videoOpts).catch(err => {
            console.error("[mimi] createFromSongUrl failed:", err);
          });
        }
      },
      onVideoReady(video) {
        setProgress(70);
        storyboard?.setVideo(video);
        game.setLyricVideo(makeCharLookup(video));
        songLengthMs = video.duration;
        if (player?.data.song) {
          const { name, artist } = player.data.song;
          onSongInfo?.(name, artist.name);
        }
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
        if (finishTimeout !== null) { clearTimeout(finishTimeout); finishTimeout = null; }
        if (songLengthMs > 0) {
          const remaining = Math.max(0, songLengthMs - (player?.timer.position ?? 0));
          finishTimeout = setTimeout(triggerFinish, remaining);
        }
      },
      onPause() { isPlaying = false; },
      onStop()  { isPlaying = false; finished = false; },
    });
  } else {
    setTimeout(dismissLoading, 15000);
  }

  (async () => {
    if (!chartUrl) return;
    try {
      let res = await fetch(chartUrl);
      if (!res.ok && difficulty !== "expert") {
        res = await fetch(`${chartDir}chart-expert.json`);
      }
      if (!res.ok) return;
      const notes = await res.json() as Note[];
      game.setChart(notes);
    } catch (err) {
      console.error("[mimi] chart load failed:", err);
    }
  })();

  if (storyboard && chartDir) {
    (async () => {
      try {
        const res = await fetch(`${chartDir}chart.json`);
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

  const loop = (): void => {
    const songMs = player?.timer.position ?? 0;
    if (songMs > 0) lastSongMs = songMs;
    game.tick(songMs + musicOffsetMs);
    if (songMs > 0) storyboard?.update(songMs);

    if (songLengthMs > 0) {
      const pct = Math.max(0, Math.min(100, (songMs / songLengthMs) * 100));
      progressFill.style.width = `${pct}%`;

      if (songMs >= songLengthMs) triggerFinish();
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);

  return {
    stop(): void {
      unsubMusicOffset();
      if (!playerReady || !player) return;
      dismissResult();
      resetPlayback();
      player.requestStop();
    },
    togglePlay(): void {
      if (!playerReady || !player) return;
      if (isPlaying) {
        dismissResult();
        resetPlayback();
        player.requestStop();
      } else {
        player.requestPlay();
        game.start();
      }
    },
  };
}
