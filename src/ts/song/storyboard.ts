import type { TextAliveChar, TextAlivePhrase, TextAliveVideo } from "./textalive";
import { collectTextAliveChars } from "./charLookup";

export interface StoryHighlight { type: "highlight"; from: number; to: number; }
export interface StoryMove      { type: "move";      time: number; x: number; y: number; }
export interface StoryLyric     { type: "lyric";     from: number; to: number; x: number; y: number; text: string; chars: number[]; }
export type StoryEntry = StoryHighlight | StoryMove | StoryLyric;

const LOGICAL_W = 800;
const LOGICAL_H = 600;

interface StoryboardRenderer {
  setVideo(video: TextAliveVideo): void;
  setStoryData(entries: StoryEntry[]): void;
  update(songMs: number): void;
  reset(): void;
}

interface ActiveLyric {
  entry: StoryLyric;
  el: HTMLElement;
  charSpans: HTMLElement[];
}

export function createStoryboardRenderer(root: HTMLElement): StoryboardRenderer {
  let video: TextAliveVideo | null = null;
  let currentPhrase: TextAlivePhrase | null = null;
  let allChars: TextAliveChar[] = [];
  let charEls: { ch: TextAliveChar; el: HTMLElement }[] = [];
  let lineEls: HTMLElement[] = [];
  let highlights: StoryHighlight[] = [];
  let moves: StoryMove[] = [];
  let lyrics: StoryLyric[] = [];
  let activeLyrics: ActiveLyric[] = [];
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  const renderPhrase = (phrase: TextAlivePhrase): void => {
    // Preserve manual lyric elements before clearing TextAlive phrase content
    const manualEls = activeLyrics.map(a => a.el);
    root.innerHTML = "";
    for (const el of manualEls) root.appendChild(el);
    charEls = [];
    lineEls = [];

    const chars = allChars.filter(c => c.startTime >= phrase.startTime && c.startTime <= phrase.endTime);

    const relevantMoves = moves.filter(m => m.time >= phrase.startTime && m.time <= phrase.endTime);

    const getMoveForChar = (ch: TextAliveChar): StoryMove | null => {
      let best: StoryMove | null = null;
      for (const m of relevantMoves) {
        if (m.time <= ch.startTime && (best === null || m.time > best.time)) best = m;
      }
      return best;
    };

    // Group chars by applicable move (insertion-order groups the segment splits correctly)
    const groups = new Map<StoryMove | null, TextAliveChar[]>();
    for (const ch of chars) {
      const move = getMoveForChar(ch);
      if (!groups.has(move)) groups.set(move, []);
      groups.get(move)!.push(ch);
    }

    const addSpans = (container: HTMLElement, group: TextAliveChar[]): void => {
      for (const ch of group) {
        const span = document.createElement("span");
        span.className = "storyboard-char";
        span.textContent = ch.text;
        container.appendChild(span);
        charEls.push({ ch, el: span });
      }
    };

    const defaultChars = groups.get(null) ?? [];
    if (defaultChars.length > 0) {
      const lineEl = document.createElement("div");
      lineEl.className = "storyboard-line";
      addSpans(lineEl, defaultChars);
      root.appendChild(lineEl);
      lineEls.push(lineEl);
      requestAnimationFrame(() => lineEl.classList.add("visible"));
    }

    for (const [move, mChars] of groups) {
      if (move === null) continue;
      const seg = document.createElement("div");
      seg.className = "storyboard-segment";
      seg.style.left = `${(move.x / LOGICAL_W) * 100}%`;
      seg.style.top  = `${(move.y / LOGICAL_H) * 100}%`;
      addSpans(seg, mChars);
      root.appendChild(seg);
      lineEls.push(seg);
      requestAnimationFrame(() => seg.classList.add("visible"));
    }
  };

  const clearLine = (): void => {
    if (clearTimer !== null) { clearTimeout(clearTimer); clearTimer = null; }
    for (const el of lineEls) el.classList.remove("visible");
    const toRemove = [...lineEls];
    clearTimer = setTimeout(() => {
      clearTimer = null;
      for (const el of toRemove) { if (el.parentNode === root) root.removeChild(el); }
    }, 300);
    lineEls = [];
    charEls = [];
    currentPhrase = null;
  };

  return {
    setVideo(v): void {
      video = v;
      allChars = collectTextAliveChars(v);
    },

    setStoryData(entries): void {
      highlights = entries.filter((e): e is StoryHighlight => e.type === "highlight");
      moves      = entries.filter((e): e is StoryMove      => e.type === "move");
      lyrics     = entries.filter((e): e is StoryLyric     => e.type === "lyric");
    },

    update(songMs): void {
      // TextAlive phrase rendering
      if (video) {
        const phrase = video.findPhrase(songMs);
        if (phrase !== currentPhrase) {
          if (currentPhrase) clearLine();
          currentPhrase = phrase;
          if (phrase) renderPhrase(phrase);
        }
        for (const { ch, el } of charEls) {
          let cls: string;
          if (songMs >= ch.startTime && songMs <= ch.endTime) {
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
        }
      }

      // Manual lyric rendering: create elements for newly visible entries
      for (const entry of lyrics) {
        if (songMs < entry.from || songMs >= entry.to) continue;
        if (activeLyrics.some(a => a.entry === entry)) continue;

        const el = document.createElement("div");
        el.className = "storyboard-segment";
        el.style.left = `${(entry.x / LOGICAL_W) * 100}%`;
        el.style.top  = `${(entry.y / LOGICAL_H) * 100}%`;

        const charSpans: HTMLElement[] = [];
        for (const ch of [...entry.text]) {
          const span = document.createElement("span");
          span.className = "storyboard-char";
          span.textContent = ch;
          el.appendChild(span);
          charSpans.push(span);
        }

        root.appendChild(el);
        requestAnimationFrame(() => el.classList.add("visible"));
        activeLyrics.push({ entry, el, charSpans });
      }

      // Fade out entries that have reached their end time
      activeLyrics = activeLyrics.filter(({ entry, el }) => {
        if (songMs >= entry.to) {
          el.classList.remove("visible");
          setTimeout(() => el.remove(), 300);
          return false;
        }
        return true;
      });

      // Update character states for all active manual lyrics
      for (const { entry, charSpans } of activeLyrics) {
        for (let i = 0; i < charSpans.length; i++) {
          const charStart = i < entry.chars.length ? entry.chars[i] : Infinity;
          const nextStart = i + 1 < entry.chars.length ? entry.chars[i + 1] : entry.to;
          let cls: string;
          if (songMs >= charStart && songMs < nextStart) {
            const highlighted = highlights.some(
              h => songMs >= h.from && songMs <= h.to && charStart >= h.from && charStart <= h.to,
            );
            cls = highlighted ? "storyboard-char approach" : "storyboard-char active";
          } else if (songMs >= nextStart) {
            cls = "storyboard-char sung";
          } else {
            cls = "storyboard-char";
          }
          if (charSpans[i].className !== cls) charSpans[i].className = cls;
        }
      }
    },

    reset(): void {
      clearLine();
      for (const { el } of activeLyrics) el.remove();
      activeLyrics = [];
    },
  };
}
