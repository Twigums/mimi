import type { TextAliveChar, TextAlivePhrase, TextAliveVideo, TextAliveWord } from "./textalive";
import type { HitResult, Note } from "../game/engine";
import {
  layoutLyricGlyphs,
  lyricCharLandTime,
  lyricFunnelDestOffsetYPx,
  LYRIC_FUNNEL_BLEND_MS,
} from "../game/lyricLayout";
import { loadHiddenMod, subscribeHiddenMod } from "../core/settings";
import { collectTextAliveChars, walkPhraseChars } from "./charLookup";

// Optional per-segment style directives (from `.story` m/l trailing tokens).
export interface StoryStyle extends Record<string, string> {
  color?: string;
  font?: string;
  scale?: string;
  in?: string;
  out?: string;
  motion?: string;
  pulse?: string;
  autotime?: string;
  delay?: string;
}

export interface StoryHighlight { type: "highlight"; from: number; to: number; }
export interface StoryMove      { type: "move";      time: number; x: number; y: number; style?: StoryStyle; }
export interface StoryExclude   { type: "exclude";   from: number; to: number; }
export interface StoryReactive  { type: "reactive";  modes: string[]; }
export interface StoryLyric     { type: "lyric";     from: number; to: number; x: number; y: number; text: string; chars: number[]; style?: StoryStyle; }
export type StoryEntry = StoryHighlight | StoryMove | StoryExclude | StoryReactive | StoryLyric;

// Live song-map values applied by the reactive directives, computed per tick by the
// controller (1/neutral when a mode is disabled, so the storyboard applies blindly).
export interface ReactiveFrame {
  beatProgress: number;     // 0..1 through the current beat (drives authored pulse)
  ampScale: number;         // vocal-amplitude scale multiplier (1 = neutral)
  moodColor: string | null; // valence/arousal tint, or null when disabled
  chorus: boolean;          // true while inside a chorus segment
}

const LOGICAL_W = 800;
const LOGICAL_H = 600;

const FONT_MAP: Record<string, string> = {
  display: "var(--font-display)",
  handwriting: "var(--font-handwriting)",
};

const styleDelayMs = (style?: StoryStyle): number => {
  if (!style?.delay) return 0;
  const raw = String(style.delay).trim();
  const braced = raw.match(/^\{([+-]?\d+)\}$/);
  const value = braced ? braced[1] : raw;
  if (!/^[+-]?\d+$/.test(value)) return 0;
  const n = Number(value);
  return Number.isInteger(n) ? n : 0;
};

const shouldRotateManualGlyph = (ch: string): boolean => /^[\x21-\x7e]$/.test(ch);
const manualGlyphClass = (el: HTMLElement, stateClass: string): string =>
  el.dataset.baseTransform ? `${stateClass} story-char-horizontal` : stateClass;
const OUT_DURATION_MS: Record<string, number> = { fade: 300, rise: 2800, fall: 900 };

const parseOutStyle = (raw: string): { name: string; durationMs: number } | null => {
  const match = raw.trim().match(/^([a-z][a-z-]*)(?:\((\d+(?:\.\d+)?)\))?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const defaultMs = OUT_DURATION_MS[name] ?? 300;
  if (!match[2]) return { name, durationMs: defaultMs };
  const seconds = Number(match[2]);
  if (!Number.isFinite(seconds) || seconds <= 0) return { name, durationMs: defaultMs };
  return { name, durationMs: seconds * 1000 };
};

const collectPhrases = (video: TextAliveVideo): TextAlivePhrase[] => {
  const phrases: TextAlivePhrase[] = [];
  const seen = new Set<TextAlivePhrase>();
  for (let phrase = video.firstPhrase; phrase && !seen.has(phrase); phrase = phrase.next) {
    seen.add(phrase);
    phrases.push(phrase);
  }
  return phrases;
};

interface StoryboardRenderer {
  setVideo(video: TextAliveVideo): void;
  setStoryData(entries: StoryEntry[]): void;
  setLyricMap(charToNote: Map<TextAliveChar, Note>): void;
  setApproachMs(ms: number): void;
  markLyricOutcome(x: number, y: number, result: HitResult): void;
  update(songMs: number, reactive?: ReactiveFrame): void;
  reset(): void;
}

interface Flight {
  el: HTMLElement;
  sx: number; sy: number;   // source %, captured from the storyboard glyph
  dx: number; dy: number;   // destination %, the note's logical position
  t0: number; t1: number;   // song-ms launch -> landing
  note: Note;
  charIndex: number;
}

interface ActiveLyric {
  entry: StoryLyric;
  el: HTMLElement;
  charSpans: HTMLElement[];
  charTimes: number[];
  pulse: boolean;
}

// `flightRoot` (a layer above the canvas) is where the funnel characters fly; the
// storyboard itself sits behind the canvas, so flights need their own foreground layer.
export function createStoryboardRenderer(root: HTMLElement, flightRoot: HTMLElement = root): StoryboardRenderer {
  let video: TextAliveVideo | null = null;
  let mountedPhrases = new Map<TextAlivePhrase, HTMLElement[]>();
  let allChars: TextAliveChar[] = [];
  let allPhrases: TextAlivePhrase[] = [];
  let charEls: { ch: TextAliveChar; el: HTMLElement; pulse: boolean }[] = [];
  let highlights: StoryHighlight[] = [];
  let moves: StoryMove[] = [];
  let lyrics: StoryLyric[] = [];
  let activeLyrics: ActiveLyric[] = [];
  // TextAlive chars claimed by a lyric note (from the matcher) render as empty
  // outlines until resolved. A char fills when its own note is hit; an entire word
  // shines once every note mapped into that word is hit (including unmapped chars).
  // Funnel + note-outline maps are keyed by char timing identity because display
  // and matching can see different TextAlive object instances for the same glyph.
  let lyricKeyToNote: Map<string, Note> = new Map();
  let noteOutcome: Map<Note, "hit" | "miss"> = new Map();
  let noteToMatchKeys: Map<Note, string[]> = new Map();
  let wordNotesByKey: Map<string, Set<Note>> = new Map();
  let charByKey: Map<string, TextAliveChar> = new Map();
  const charElMap: Map<TextAliveChar, HTMLElement> = new Map();
  const charKey = (c: TextAliveChar): string => `${c.startTime}\0${c.endTime}\0${c.text}`;
  // Funnel: characters detach from their source storyboard glyph and fly to the note.
  let flights: Flight[] = [];
  let launched = new Set<Note>();
  let approachMs = 2000;
  let hidden = loadHiddenMod();
  subscribeHiddenMod(v => { hidden = v; });
  const reducedMotion = typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Build a styled container with three transform layers so they never collide:
  // `outer` (.storyboard-line/-segment) already owns the positioning transform and
  // carries static style (color/font/size); `.sb-fx` owns continuous motion;
  // `.sb-enter` owns one-shot enter/exit transitions; char spans go in `.sb-enter`
  // and own the per-char pulse/amplitude scale. Returns the innermost char
  // container + pulse flag.
  const buildContainer = (cls: string, style?: StoryStyle): { outer: HTMLElement; inner: HTMLElement; pulse: boolean } => {
    const outer = document.createElement("div");
    outer.className = cls;
    const motionEl = document.createElement("div");
    motionEl.className = "sb-fx";
    const enterEl = document.createElement("div");
    enterEl.className = "sb-enter";
    motionEl.appendChild(enterEl);
    outer.appendChild(motionEl);
    let pulse = false;
    if (style) {
      if (style.color) outer.style.color = style.color;
      if (style.font)  outer.style.fontFamily = FONT_MAP[style.font] ?? style.font;
      if (style.scale) outer.style.fontSize = `${parseFloat(style.scale)}em`;
      if (style.in)     enterEl.classList.add(`sb-in-${style.in}`);
      if (style.out)    outer.dataset.out = style.out;
      if (style.motion) motionEl.classList.add(`sb-motion-${style.motion}`);
      pulse = !!style.pulse;
    }
    return { outer, inner: enterEl, pulse };
  };

  const startExit = (el: HTMLElement): number => {
    el.dataset.visible = "false";
    const out = el.dataset.out;
    if (!out) {
      el.classList.remove("visible");
      return 300;
    }
    const parsed = parseOutStyle(out);
    if (!parsed) {
      el.classList.remove("visible");
      return 300;
    }
    const exitEl = el.querySelector<HTMLElement>(".sb-enter") ?? el;
    exitEl.classList.add(`sb-out-${parsed.name}`);
    exitEl.style.animationDuration = `${parsed.durationMs / 1000}s`;
    return parsed.durationMs;
  };

  const moveDisplayStart = (move: StoryMove, phrase: TextAlivePhrase): number =>
    phrase.startTime - styleDelayMs(move.style);

  const phraseDisplayStart = (phrase: TextAlivePhrase): number => {
    let start = phrase.startTime;
    for (const move of moves) {
      if (move.time < phrase.startTime || move.time > phrase.endTime) continue;
      start = Math.min(start, moveDisplayStart(move, phrase));
    }
    return start;
  };

  const displayPhrases = (songMs: number): TextAlivePhrase[] => {
    if (!video) return [];
    const active = video.findActivePhrases?.(songMs)
      ?? (video.findPhrase(songMs) ? [video.findPhrase(songMs)!] : []);
    const seen = new Set<TextAlivePhrase>();
    const out: TextAlivePhrase[] = [];
    const add = (phrase: TextAlivePhrase): void => {
      if (seen.has(phrase)) return;
      seen.add(phrase);
      out.push(phrase);
    };

    for (const phrase of active) add(phrase);
    for (const phrase of allPhrases) {
      const displayStart = phraseDisplayStart(phrase);
      if (songMs >= displayStart && songMs < phrase.endTime) add(phrase);
    }
    return out;
  };

  const updateLineVisibility = (els: HTMLElement[], songMs: number): void => {
    for (const el of els) {
      const displayStart = Number(el.dataset.displayStart ?? 0);
      if (songMs >= displayStart) {
        if (el.dataset.visible !== "true") {
          el.dataset.visible = "true";
          requestAnimationFrame(() => {
            if (el.dataset.visible === "true") el.classList.add("visible");
          });
        }
      } else {
        el.dataset.visible = "false";
        el.classList.remove("visible");
      }
    }
  };

  // With `autotime`, derive each char's activation from the TextAlive characters at
  // or after the lyric's start, instead of a hand-listed char_time list.
  const deriveAutotime = (entry: StoryLyric): number[] => {
    if (!video) return entry.chars;
    const start = allChars.findIndex(c => c.startTime >= entry.from);
    if (start < 0) return entry.chars;
    const n = [...entry.text].length;
    return allChars.slice(start, start + n).map(c => c.startTime);
  };

  const renderPhrase = (phrase: TextAlivePhrase, songMs: number): HTMLElement[] => {
    const mounted: HTMLElement[] = [];
    const chars = walkPhraseChars(phrase);
    if (chars.length === 0) return mounted;

    const relevantMoves = moves.filter(m => m.time >= phrase.startTime && m.time <= phrase.endTime);

    const getMoveForChar = (ch: TextAliveChar): StoryMove | null => {
      let best: StoryMove | null = null;
      for (const m of relevantMoves) {
        if (m.time <= ch.startTime && (best === null || m.time > best.time)) best = m;
      }
      return best;
    };

    const groups = new Map<StoryMove | null, TextAliveChar[]>();
    for (const ch of chars) {
      const move = getMoveForChar(ch);
      if (!groups.has(move)) groups.set(move, []);
      groups.get(move)!.push(ch);
    }

    const addSpans = (container: HTMLElement, group: TextAliveChar[], pulse: boolean): void => {
      for (const ch of group) {
        const span = document.createElement("span");
        span.className = "storyboard-char";
        span.textContent = ch.text;
        container.appendChild(span);
        charEls.push({ ch, el: span, pulse });
        charElMap.set(ch, span);
      }
    };

    const mountLine = (
      cls: string,
      group: TextAliveChar[],
      style: StoryStyle | undefined,
      pos: { x: number; y: number } | null,
      displayStart: number,
    ): void => {
      const { outer, inner, pulse } = buildContainer(cls, style);
      outer.dataset.displayStart = String(displayStart);
      if (phrase.overlay) outer.classList.add("storyboard-line--overlay");
      if (pos) {
        outer.style.left = `${(pos.x / LOGICAL_W) * 100}%`;
        outer.style.top  = `${(pos.y / LOGICAL_H) * 100}%`;
      }
      addSpans(inner, group, pulse);
      root.appendChild(outer);
      mounted.push(outer);
    };

    const defaultChars = groups.get(null) ?? [];
    if (defaultChars.length > 0) {
      mountLine("storyboard-line", defaultChars, undefined, null, phrase.startTime);
    }

    for (const [move, mChars] of groups) {
      if (move === null) continue;
      mountLine("storyboard-segment", mChars, move.style, { x: move.x, y: move.y }, moveDisplayStart(move, phrase));
    }
    updateLineVisibility(mounted, songMs);
    return mounted;
  };

  const clearPhrase = (phrase: TextAlivePhrase, els: HTMLElement[]): void => {
    let removeDelay = 300;
    for (const el of els) {
      removeDelay = Math.max(removeDelay, startExit(el));
    }
    const toRemove = [...els];
    setTimeout(() => {
      for (const el of toRemove) { if (el.parentNode === root) root.removeChild(el); }
    }, removeDelay);
    for (const { ch, el } of charEls) {
      if (toRemove.some(r => r.contains(el))) charElMap.delete(ch);
    }
    charEls = charEls.filter(({ el }) => !toRemove.some(r => r.contains(el)));
    mountedPhrases.delete(phrase);
  };

  const phraseForChar = (ch: TextAliveChar): TextAlivePhrase | undefined =>
    allPhrases.find(p => ch.startTime >= p.startTime && ch.startTime < p.endTime);

  const phrasesForFunnel = (songMs: number): TextAlivePhrase[] => {
    const out = new Set<TextAlivePhrase>();
    for (const note of noteToMatchKeys.keys()) {
      if (songMs < note.time - approachMs || songMs >= note.time) continue;
      for (const key of noteToMatchKeys.get(note) ?? []) {
        const ch = charByKey.get(key);
        const phrase = ch ? phraseForChar(ch) : undefined;
        if (phrase) out.add(phrase);
      }
    }
    return [...out];
  };

  const syncActivePhrases = (songMs: number): void => {
    const active = displayPhrases(songMs);
    const activeSet = new Set(active);
    for (const phrase of phrasesForFunnel(songMs)) activeSet.add(phrase);
    const activeList = [...activeSet];

    for (const [phrase, els] of [...mountedPhrases]) {
      if (!activeSet.has(phrase)) clearPhrase(phrase, els);
    }

    for (const phrase of activeList) {
      if (!mountedPhrases.has(phrase)) {
        const els = renderPhrase(phrase, songMs);
        if (els.length > 0) mountedPhrases.set(phrase, els);
      }
    }

    for (const els of mountedPhrases.values()) updateLineVisibility(els, songMs);
  };

  // A word shines once every lyric note mapped into it has been hit.
  const wordComplete = (word: TextAliveWord | null): boolean => {
    if (!word?.firstChar) return false;
    const ns = wordNotesByKey.get(charKey(word.firstChar));
    if (!ns || ns.size === 0) return false;
    for (const n of ns) if (noteOutcome.get(n) !== "hit") return false;
    return true;
  };

  const clearFlights = (): void => {
    for (const f of flights) f.el.remove();
    flights = [];
    launched = new Set();
  };

  const LINE_SLIDE_PX = 12;

  const sourceGlyph = (key: string): HTMLElement | undefined => {
    for (const { ch, el } of charEls) {
      if (charKey(ch) === key) return el;
    }
    return undefined;
  };

  // Phrase lines slide in on appear; use their settled position when the segment
  // is still pre-visible so early funnel flights launch from where the glyph will be.
  const glyphCenterPct = (glyph: HTMLElement, rect: DOMRect): { x: number; y: number } => {
    const gr = glyph.getBoundingClientRect();
    const container = glyph.closest<HTMLElement>(".storyboard-line, .storyboard-segment");
    let cx = gr.left + gr.width / 2;
    const cy = gr.top + gr.height / 2;
    if (container && !container.classList.contains("visible")) {
      if (container.classList.contains("storyboard-line--overlay")) cx += LINE_SLIDE_PX;
      else if (container.classList.contains("storyboard-line")) cx -= LINE_SLIDE_PX;
    }
    return {
      x: ((cx - rect.left) / rect.width) * 100,
      y: ((cy - rect.top) / rect.height) * 100,
    };
  };

  // Spawn the funnel characters for a note: each flies from its source storyboard
  // glyph to the note's logical position, staggered so multi-char notes land in order
  // by the note time. The flying glyph carries the note's text (an override or the
  // matched chars), originating at the source character it claimed.
  const launchFlight = (note: Note, songMs: number): void => {
    const srcKeys = noteToMatchKeys.get(note) ?? [];
    const text = [...(note.lyricChar ?? "")];
    if (text.length === 0) return;
    const rect = flightRoot.getBoundingClientRect();
    if (rect.width === 0) return;
    const baseDx = (note.x / LOGICAL_W) * 100;
    const n = text.length;
    const scale = rect.width / LOGICAL_W;
    const layout = layoutLyricGlyphs(note.lyricChar ?? "", scale);
    const fontPx = layout.fontPx;
    const dy = (note.y / LOGICAL_H) * 100 + (lyricFunnelDestOffsetYPx(fontPx, true) / rect.height) * 100;
    for (let i = 0; i < n; i++) {
      const srcKey = srcKeys[Math.min(i, srcKeys.length - 1)];
      const glyph = srcKey ? sourceGlyph(srcKey) : undefined;
      if (!glyph) continue;
      const glyphPos = glyphCenterPct(glyph, rect);
      const dx = baseDx + (layout.charOffsets[i] / rect.width) * 100;
      const sx = reducedMotion ? dx : glyphPos.x;
      const sy = reducedMotion ? dy : glyphPos.y;
      const landTime = lyricCharLandTime(note.time, i, n, approachMs);
      const el = document.createElement("div");
      el.className = "sb-fly";
      el.textContent = text[i];
      el.style.fontSize = `${fontPx.toFixed(1)}px`;
      el.style.left = `${sx}%`;
      el.style.top  = `${sy}%`;
      el.style.transform = "translate(-50%, -50%) scale(0.5)";
      flightRoot.appendChild(el);
      flights.push({ el, sx, sy, dx, dy, t0: songMs, t1: landTime, note, charIndex: i });
    }
  };

  const updateFlights = (songMs: number): void => {
    if (!hidden) {
      for (const note of noteToMatchKeys.keys()) {
        if (launched.has(note)) continue;
        if (songMs < note.time - approachMs || songMs >= note.time) continue;
        const srcKeys = noteToMatchKeys.get(note) ?? [];
        if (!srcKeys.every(sourceGlyph)) continue;
        launched.add(note);
        launchFlight(note, songMs);
      }
    }
    flights = flights.filter(f => {
      if (noteOutcome.has(f.note) || songMs > f.note.time + 1500) {
        const el = f.el;
        el.style.transition = "opacity 0.2s ease, transform 0.2s ease";
        el.style.opacity = "0";
        el.style.transform = "translate(-50%, -50%) scale(1.3)";
        setTimeout(() => el.remove(), 220);
        return false;
      }
      const landBlend = Math.min(1, (songMs - f.t1) / LYRIC_FUNNEL_BLEND_MS);
      if (landBlend >= 1) {
        f.el.remove();
        return false;
      }
      const t = Math.max(0, Math.min(1, (songMs - f.t0) / Math.max(1, f.t1 - f.t0)));
      const ease = 1 - (1 - t) * (1 - t);
      const grow = t < 0.5 ? 0.5 : 0.5 + ((t - 0.5) / 0.5) * 0.5;
      f.el.style.left = `${f.sx + (f.dx - f.sx) * ease}%`;
      f.el.style.top  = `${f.sy + (f.dy - f.sy) * ease}%`;
      f.el.style.transform = `translate(-50%, -50%) scale(${grow.toFixed(3)})`;
      const approachOpacity = Math.min(1, t * 3);
      f.el.style.opacity = `${approachOpacity * (1 - landBlend)}`;
      return true;
    });
  };

  return {
    setVideo(v): void {
      video = v;
      allChars = collectTextAliveChars(v);
      allPhrases = collectPhrases(v);
      charByKey = new Map(allChars.map(ch => [charKey(ch), ch]));
    },

    setStoryData(entries): void {
      highlights = entries.filter((e): e is StoryHighlight => e.type === "highlight");
      moves      = entries.filter((e): e is StoryMove      => e.type === "move");
      lyrics     = entries.filter((e): e is StoryLyric     => e.type === "lyric");
    },

    setLyricMap(charToNote): void {
      lyricKeyToNote = new Map([...charToNote].map(([ch, n]) => [charKey(ch), n]));
      noteOutcome = new Map();
      noteToMatchKeys = new Map();
      wordNotesByKey = new Map();
      for (const [ch, note] of charToNote) {
        const k = charKey(ch);
        let arr = noteToMatchKeys.get(note);
        if (!arr) { arr = []; noteToMatchKeys.set(note, arr); }
        arr.push(k);
        const w = ch.parent;
        if (w?.firstChar) {
          const wk = charKey(w.firstChar);
          let s = wordNotesByKey.get(wk);
          if (!s) { s = new Set(); wordNotesByKey.set(wk, s); }
          s.add(note);
        }
      }
      clearFlights();
    },

    setApproachMs(ms): void { approachMs = ms; },

    markLyricOutcome(x, y, result): void {
      const outcome = result === "miss" ? "miss" : "hit";
      for (const note of lyricKeyToNote.values()) {
        if (note.x === x && note.y === y) { noteOutcome.set(note, outcome); break; }
      }
    },

    update(songMs, reactive): void {
      // Reactive song-map effects (no-ops when the modes are disabled): mood tint on
      // the root (chars inherit unless a state/authored color overrides), a chorus
      // class, and amplitude/beat scalars applied per char below.
      const ampScale = reactive?.ampScale ?? 1;
      const beat     = reactive?.beatProgress ?? 0;
      root.style.color = reactive?.moodColor ?? "";
      root.classList.toggle("sb-chorus", !!reactive?.chorus);

      const applyCharScale = (el: HTMLElement, active: boolean, pulse: boolean): void => {
        let s = active ? ampScale : 1;
        if (pulse) s *= 1 + 0.18 * beat;
        const baseTransform = el.dataset.baseTransform ?? "";
        const scaleTransform = s !== 1 ? `scale(${s.toFixed(3)})` : "";
        el.style.transform = [baseTransform, scaleTransform].filter(Boolean).join(" ");
      };

      // TextAlive phrase rendering (one or more concurrent layers)
      if (video) {
        syncActivePhrases(songMs);
        for (const { ch, el, pulse } of charEls) {
          // A note-mapped char (or any char in a completed word) is driven by hit/miss
          // outcome, not the song position. A char fills when its own note is hit; the
          // whole word (incl. unmapped chars) shines once all its notes are hit.
          const mappedNote = lyricKeyToNote.get(charKey(ch));
          const shine = wordComplete(ch.parent);
          if (mappedNote || shine) {
            const filled = shine || noteOutcome.get(mappedNote!) === "hit";
            const cls = filled ? "storyboard-char note-filled" : "storyboard-char note-empty";
            if (el.className !== cls) el.className = cls;
            el.style.transform = "";
            continue;
          }
          const active = songMs >= ch.startTime && songMs <= ch.endTime;
          let cls: string;
          if (active) {
            const highlighted = highlights.some(
              h => songMs >= h.from && songMs <= h.to && ch.startTime >= h.from && ch.startTime <= h.to,
            );
            cls = highlighted ? "storyboard-char approach" : "storyboard-char active";
          } else if (songMs > ch.endTime) {
            cls = "storyboard-char sung";
          } else {
            cls = "storyboard-char";
          }
          if (el.className !== cls) el.className = cls;
          applyCharScale(el, active, pulse);
        }
      }

      // Manual lyric rendering: create elements for newly visible entries
      for (const entry of lyrics) {
        const displayStart = entry.from - styleDelayMs(entry.style);
        if (songMs < displayStart || songMs >= entry.to) continue;
        if (activeLyrics.some(a => a.entry === entry)) continue;

        const { outer, inner, pulse } = buildContainer("storyboard-segment", entry.style);
        outer.style.left = `${(entry.x / LOGICAL_W) * 100}%`;
        outer.style.top  = `${(entry.y / LOGICAL_H) * 100}%`;

        const charSpans: HTMLElement[] = [];
        for (const ch of [...entry.text]) {
          const span = document.createElement("span");
          const rotate = shouldRotateManualGlyph(ch);
          span.className = rotate ? "storyboard-char story-char-horizontal" : "storyboard-char";
          if (rotate) span.dataset.baseTransform = "rotate(-90deg)";
          span.textContent = ch;
          inner.appendChild(span);
          charSpans.push(span);
        }

        root.appendChild(outer);
        requestAnimationFrame(() => outer.classList.add("visible"));
        const charTimes = entry.style?.autotime ? deriveAutotime(entry) : entry.chars;
        activeLyrics.push({ entry, el: outer, charSpans, charTimes, pulse });
      }

      // Fade out entries that have reached their end time
      activeLyrics = activeLyrics.filter(({ entry, el }) => {
        const displayStart = entry.from - styleDelayMs(entry.style);
        if (songMs < displayStart || songMs >= entry.to) {
          const removeDelay = startExit(el);
          setTimeout(() => el.remove(), removeDelay);
          return false;
        }
        return true;
      });

      // Update character states for all active manual lyrics
      for (const { entry, charSpans, charTimes, pulse } of activeLyrics) {
        for (let i = 0; i < charSpans.length; i++) {
          const charStart = i < charTimes.length ? charTimes[i] : Infinity;
          const nextStart = i + 1 < charTimes.length ? charTimes[i + 1] : entry.to;
          const active = songMs >= charStart && songMs < nextStart;
          let cls: string;
          if (active) {
            const highlighted = highlights.some(
              h => songMs >= h.from && songMs <= h.to && charStart >= h.from && charStart <= h.to,
            );
            cls = highlighted ? "storyboard-char approach" : "storyboard-char active";
          } else if (songMs >= nextStart) {
            cls = "storyboard-char sung";
          } else {
            cls = "storyboard-char";
          }
          cls = manualGlyphClass(charSpans[i], cls);
          if (charSpans[i].className !== cls) charSpans[i].className = cls;
          applyCharScale(charSpans[i], active, pulse);
        }
      }

      // Funnel characters from the storyboard glyphs onto approaching notes.
      updateFlights(songMs);
    },

    reset(): void {
      for (const [phrase, els] of [...mountedPhrases]) clearPhrase(phrase, els);
      mountedPhrases.clear();
      charEls = [];
      charElMap.clear();
      for (const { el } of activeLyrics) el.remove();
      activeLyrics = [];
      // Re-empty all note-mapped lyrics so a retry starts from outlines again.
      noteOutcome = new Map();
      clearFlights();
      root.style.color = "";
      root.classList.remove("sb-chorus");
    },
  };
}
