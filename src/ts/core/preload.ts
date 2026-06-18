// Third-party origins the song page's load path hits (TextAlive SDK CDN, Songle
// analysis API, TextAlive backend, Piapro audio). Mirrors the static preconnects
// in song.html for the case where the player reaches a song via in-page nav.
const SONG_ORIGINS = [
  "https://unpkg.com",
  "https://api.songle.jp",
  "https://api.textalive.jp",
  "https://piapro.jp",
];

let warmed = false;

/**
 * Open early DNS/TLS connections to the song-page origins so a subsequent
 * navigation can begin `createFromSongUrl` against warm sockets. Best-effort
 * (the browser may drop unused/idle connections); idempotent within a page.
 */
export function warmSongOrigins(): void {
  if (warmed) return;
  warmed = true;
  for (const href of SONG_ORIGINS) {
    if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = href;
    link.crossOrigin = "";
    document.head.appendChild(link);
  }
}
