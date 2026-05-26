import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { initLangToggle } from "./core/lang";
import { initSongPage }   from "./song/controller";
import { HomeLayoutSwitcher } from "./react/HomeLayoutSwitcher";
import { GameSurface }        from "./react/GameSurface";

document.addEventListener("DOMContentLoaded", () => {
  initLangToggle();

  const homeRoot = document.getElementById("home-root");
  if (homeRoot) {
    const infoContent      = homeRoot.dataset.infoContent ?? "";
    const tutorialContent  = homeRoot.dataset.tutorialContent ?? "";
    const songsManifest    = homeRoot.dataset.songsManifest ?? "{\"songs\":[]}";
    createRoot(homeRoot).render(
      createElement(HomeLayoutSwitcher, { infoContent, tutorialContent, songsManifest })
    );
  }

  const gameRoot = document.getElementById("game-root");
  if (gameRoot) {
    const returnHref = document.querySelector<HTMLAnchorElement>(".btn-back")?.href ?? "/";

    let stopSong: (() => void) | null = null;

    const handleTryAgain = (): void => {
      stopSong?.();
    };

    createRoot(gameRoot).render(
      createElement(GameSurface, {
        onReady: (game, show, hide, setSongInfoJp, registerToggle, setPlayerReady) => {
          const handle = initSongPage({
            game,
            onSongFinish: show,
            hideResult: hide,
            onSongInfo: setSongInfoJp,
            onPlayerReady: setPlayerReady,
          });
          registerToggle(() => handle.togglePlay());

          stopSong = () => handle.stop();
        },
        returnHref,
        onTryAgain: handleTryAgain,
      })
    );
  }
});