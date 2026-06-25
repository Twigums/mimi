import { withPath } from "./sitePath";
import { loadUiVolume, subscribeUiVolume, volToFactor } from "./settings";

// Interface controls that should react to hover/click. `.btn-main` also covers the
// difficulty links (`.diff-btn`) and song-list entries; plain `button` covers the
// toggles, options panel, results buttons, and song-page chrome.
const UI_BUTTON_SELECTOR = "button, .btn-main, .btn-back, .diff-btn";

const HOVER_URL = withPath("/audio/hover.wav");
const CLICK_URL = withPath("/audio/click.wav");

// UI feedback sits a little under gameplay/music levels; the dedicated Interface
// volume slider scales it on top of this base.
const UI_GAIN = 0.6;

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let hoverBuffer: AudioBuffer | null = null;
let clickBuffer: AudioBuffer | null = null;

function loadBuffer(url: string): void {
  if (!ctx) return;
  fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => ctx!.decodeAudioData(buf))
    .then(decoded => {
      if (url === HOVER_URL) hoverBuffer = decoded;
      else clickBuffer = decoded;
    })
    .catch(err => console.error("[mimi] ui sound load failed:", url, err));
}

// Browsers block audio until a user gesture, so the context is created lazily on the
// first interaction (which also primes both buffers for later plays).
function ensureAudio(): void {
  if (ctx) return;
  ctx = new AudioContext();
  gain = ctx.createGain();
  gain.gain.value = volToFactor(loadUiVolume()) * UI_GAIN;
  gain.connect(ctx.destination);
  subscribeUiVolume(v => { if (gain) gain.gain.value = volToFactor(v) * UI_GAIN; });
  loadBuffer(HOVER_URL);
  loadBuffer(CLICK_URL);
}

function play(buffer: AudioBuffer | null): void {
  if (!ctx || !gain || !buffer) return;
  if (ctx.state === "suspended") void ctx.resume();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start();
}

function targetButton(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target.closest(UI_BUTTON_SELECTOR) : null;
  // Disabled controls are inert: no hover or click feedback.
  if (el instanceof HTMLButtonElement && el.disabled) return null;
  return el;
}

export function initUiSounds(): void {
  window.addEventListener("pointerdown", ensureAudio, { once: true });
  window.addEventListener("keydown", ensureAudio, { once: true });

  // Track the hovered control so moving across the button's own children does not
  // retrigger the hover sound (pointerover bubbles from descendants).
  let hovered: Element | null = null;

  document.addEventListener("pointerover", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return; // skip hover SFX for touch/pen taps
    const btn = targetButton(e.target);
    if (!btn || btn === hovered) return;
    hovered = btn;
    play(hoverBuffer);
  });

  document.addEventListener("pointerout", (e: PointerEvent) => {
    if (hovered && !hovered.contains(e.relatedTarget as Node | null)) hovered = null;
  });

  // `click` (not pointerdown) so keyboard activation (Enter/Space) is covered too.
  document.addEventListener("click", (e: MouseEvent) => {
    if (targetButton(e.target)) play(clickBuffer);
  });
}
