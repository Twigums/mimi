import { withPath } from "./sitePath";
import { loadUiVolume, subscribeUiVolume, volToFactor } from "./settings";

const UI_BUTTON_SELECTOR = "button, .btn-main, .btn-back, .diff-btn";

const HOVER_URL = withPath("/audio/hover.wav");
const CLICK_URL = withPath("/audio/click.wav");

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
  if (el instanceof HTMLButtonElement && el.disabled) return null;
  return el;
}

export function initUiSounds(): void {
  window.addEventListener("pointerdown", ensureAudio, { once: true });
  window.addEventListener("keydown", ensureAudio, { once: true });

  let hovered: Element | null = null;

  document.addEventListener("pointerover", (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const btn = targetButton(e.target);
    if (!btn || btn === hovered) return;
    hovered = btn;
    play(hoverBuffer);
  });

  document.addEventListener("pointerout", (e: PointerEvent) => {
    if (hovered && !hovered.contains(e.relatedTarget as Node | null)) hovered = null;
  });

  document.addEventListener("click", (e: MouseEvent) => {
    if (targetButton(e.target)) play(clickBuffer);
  });
}