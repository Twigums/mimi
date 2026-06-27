// third-party origins the song page's load path hits
const SONG_ORIGINS = [
  "https://unpkg.com",
  "https://api.songle.jp",
  "https://api.textalive.jp",
  "https://piapro.jp",
];

let warmed = false;

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