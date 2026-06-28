import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { initLangToggle } from "./core/lang";
import { initThemeToggle } from "./core/theme";
import { initUiSounds }    from "./core/uiSound";
import { initBgSky }      from "./home/sky";
import { initSongPage }   from "./song/controller";
import { HomeLayoutSwitcher } from "./react/HomeLayoutSwitcher";
import { GameSurface }        from "./react/GameSurface";

document.addEventListener("DOMContentLoaded", () => {
  initLangToggle();
  initThemeToggle();
  initUiSounds();

  const homeRoot = document.getElementById("home-root");
  if (homeRoot) {
    initBgSky();
    const infoContent       = homeRoot.dataset.infoContent       ?? "";
    const infoContentJp     = homeRoot.dataset.infoContentJp     ?? "";
    const tutorialContent   = homeRoot.dataset.tutorialContent   ?? "";
    const tutorialContentJp = homeRoot.dataset.tutorialContentJp ?? "";
    const songsManifest     = homeRoot.dataset.songsManifest     ?? "{\"songs\":[]}";
    createRoot(homeRoot).render(
      createElement(HomeLayoutSwitcher, { infoContent, infoContentJp, tutorialContent, tutorialContentJp, songsManifest })
    );
  }

  const gameRoot = document.getElementById("game-root");
  if (gameRoot) {
    // Browser back/forward cache restores keep the old TextAlive timer and game
    // state alive. Reload so returning to a song URL behaves like selecting the
    // difficulty again: loading screen first, then a fresh Start prompt.
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) window.location.reload();
    });

    const returnHref = document.querySelector<HTMLAnchorElement>(".btn-back")?.href ?? "/";

    let stopSong: (() => void) | null = null;

    const handleTryAgain = (): void => {
      stopSong?.();
    };

    createRoot(gameRoot).render(
      createElement(GameSurface, {
        onReady: (game, show, hide, setSongInfoJp, registerStart, registerSkipBreak, setPlayerReady, setBreakSkipKind, setPreparing, setPaused, registerLyricOutcome) => {
          const handle = initSongPage({
            game,
            onSongFinish: show,
            hideResult: hide,
            onSongInfo: setSongInfoJp,
            onPreparing: setPreparing,
            onPlayerReady: setPlayerReady,
            onPaused: setPaused,
            onBreakSkipAvailable: setBreakSkipKind,
          });
          registerStart(() => handle.start());
          registerSkipBreak(() => handle.skipBreak());
          registerLyricOutcome((result, x, y) => handle.onLyricOutcome(result, x, y));

          stopSong = () => handle.stop();
        },
        returnHref,
        onTryAgain: handleTryAgain,
      })
    );
  }
});
