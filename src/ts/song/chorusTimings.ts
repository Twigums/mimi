import { collectTextAliveChars, walkPhraseChars } from "./charLookup";
import type { TextAliveChar, TextAlivePhrase, TextAliveVideo, TextAliveWord } from "./textalive";

export interface PhraseTimingData {
  startTime: number;
  endTime: number;
  text: string;
  chars: Array<{ text: string; startTime: number; endTime: number }>;
}

export interface PhraseGroup {
  startTime: number;
  endTime: number;
  chars: Array<{ text: string; startTime: number; endTime: number }>;
}

type ChorusSlot = { startTime: number; endTime: number };

function linesFrom(raw: string): string[] {
  return raw.split(/\r?\n/).map(l => l.replace(/\r$/, ""));
}

export function stripJsoncComments(raw: string): string {
  return linesFrom(raw).filter(line => !/^\s*\/\//.test(line)).join("\n");
}

function phraseTextsFromComments(raw: string): string[] {
  const texts: string[] = [];
  for (const line of linesFrom(raw)) {
    const m = line.match(/^\s*\/\/\s+(.+)$/);
    if (!m) continue;
    const t = m[1].trim();
    if (t.length < 5 || !/[\u3040-\u9fff\u3400-\u9fff]/.test(t)) continue;
    if (t.includes("/") || t.includes("http") || t.includes("プログラミング") || t.includes("タイミング")) continue;
    texts.push(t);
  }
  return texts;
}

function wordSizesFromNested(words: ChorusSlot[][]): number[] {
  return words.map(w => w.length);
}

// Parse Magical Mirai staff chorus jsonc into timed phrases with glyph text
export function parseChorusTimingsJsonc(raw: string): PhraseTimingData[] {
  const phraseTexts = phraseTextsFromComments(raw);
  const nested = JSON.parse(stripJsoncComments(raw)) as ChorusSlot[][][];
  return nested.map((words, pi) => {
    const glyphs = [...(phraseTexts[pi] ?? "")];
    let gi = 0;
    const chars: PhraseTimingData["chars"] = [];
    for (const word of words) {
      for (const slot of word) {
        chars.push({
          text: glyphs[gi] ?? "",
          startTime: slot.startTime,
          endTime: slot.endTime,
        });
        gi++;
      }
    }
    const sorted = chars.slice().sort((a, b) => a.startTime - b.startTime);
    return {
      startTime: sorted[0]?.startTime ?? 0,
      endTime: sorted[sorted.length - 1]?.endTime ?? 0,
      text: phraseTexts[pi] ?? sorted.map(c => c.text).join(""),
      chars: sorted,
    };
  });
}

// Parse jsonc and return phrase data plus per-phrase word sizes for word grouping
export function loadChorusTimingsJsonc(raw: string): {
  phrases: PhraseTimingData[];
  wordSizes: number[][];
} {
  const nested = JSON.parse(stripJsoncComments(raw)) as ChorusSlot[][][];
  return {
    phrases: parseChorusTimingsJsonc(raw),
    wordSizes: nested.map(words => wordSizesFromNested(words)),
  };
}

function charKey(c: { startTime: number; endTime: number; text: string }): string {
  return `${c.startTime}\0${c.endTime}\0${c.text}`;
}

function cloneChar(c: TextAliveChar): TextAliveChar {
  return { text: c.text, startTime: c.startTime, endTime: c.endTime, next: null, parent: null };
}

function linkNext(nodes: TextAliveChar[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].next = nodes[i + 1];
  if (nodes.length > 0) nodes[nodes.length - 1].next = null;
}

function linkPhraseNext(phrases: TextAlivePhrase[]): void {
  for (let i = 0; i < phrases.length - 1; i++) phrases[i].next = phrases[i + 1];
  if (phrases.length > 0) phrases[phrases.length - 1].next = null;
}

// TextAlive emits placeholder micro-timings when char sync failed for a phrase
export function isDegeneratePhraseData(phrase: PhraseGroup): boolean {
  if (phrase.chars.length === 0) return true;
  const span = phrase.endTime - phrase.startTime;
  if (span < 150 && phrase.chars.length >= 5) return true;
  const durs = phrase.chars.map(c => c.endTime - c.startTime).sort((a, b) => a - b);
  const med = durs[Math.floor(durs.length / 2)];
  return med < 25;
}

//TextAlive emits placeholder micro-timings when char sync failed for a phrase
export function isDegeneratePhrase(phrase: TextAlivePhrase): boolean {
  const chars = walkPhraseChars(phrase);
  if (chars.length === 0) return true;
  const span = phrase.endTime - phrase.startTime;
  if (span < 150 && chars.length >= 5) return true;
  const med = chars.map(c => c.endTime - c.startTime).sort((a, b) => a - b)[Math.floor(chars.length / 2)];
  return med < 25;
}

// Drop degenerate API phrases and overlay staff chorus timings into phrase-grouped data
export function mergeChorusIntoPhrases(basePhrases: PhraseGroup[], chorusRaw: string): PhraseGroup[] {
  const { phrases: chorusPhrases } = loadChorusTimingsJsonc(chorusRaw);
  if (chorusPhrases.length === 0) return basePhrases;

  const chorusStart = Math.min(...chorusPhrases.map(p => p.startTime));
  const chorusEnd = Math.max(...chorusPhrases.map(p => p.endTime));

  const kept: PhraseGroup[] = [];
  for (const phrase of basePhrases) {
    if (isDegeneratePhraseData(phrase)) continue;
    const chars = phrase.chars.filter(
      c => c.startTime < chorusStart || c.startTime > chorusEnd,
    );
    if (chars.length === 0) continue;
    kept.push({
      startTime: chars[0].startTime,
      endTime: chars[chars.length - 1].endTime,
      chars,
    });
  }

  for (const cp of chorusPhrases) {
    kept.push({ startTime: cp.startTime, endTime: cp.endTime, chars: cp.chars });
  }

  return kept.sort((a, b) => a.startTime - b.startTime);
}

function buildPhraseNodeFromData(data: PhraseTimingData, wordSizes: number[], next: TextAlivePhrase | null): TextAlivePhrase {
  const charNodes: TextAliveChar[] = data.chars.map(c => ({
    text: c.text,
    startTime: c.startTime,
    endTime: c.endTime,
    next: null,
    parent: null,
  }));
  for (let i = 0; i < charNodes.length - 1; i++) charNodes[i].next = charNodes[i + 1];

  let at = 0;
  for (const size of wordSizes) {
    const slice = charNodes.slice(at, at + size);
    if (slice.length === 0) { at += size; continue; }
    const word: TextAliveWord = { firstChar: slice[0], lastChar: slice[slice.length - 1] };
    for (const ch of slice) ch.parent = word;
    at += size;
  }

  return {
    startTime: data.startTime,
    endTime: data.endTime,
    text: data.text,
    firstChar: charNodes[0] ?? null,
    next,
  };
}

export interface MergedChorusVideos {
  match: TextAliveVideo;
  display: TextAliveVideo;
}

function activePhrasesAt(chain: TextAlivePhrase[], t: number): TextAlivePhrase[] {
  const active = chain.filter(p => t >= p.startTime && t < p.endTime);
  if (active.length <= 1) return active;

  const overlays = active.filter(p => p.overlay);
  const bases = active.filter(p => !p.overlay);
  if (bases.length === 0) return overlays;

  // One lead/base column on the right; overlay chorus lines stack on the left.
  const primaryBase = bases.length === 1 ? bases[0] : bases.find(p => {
    for (const c of walkPhraseChars(p)) {
      if (t >= c.startTime && t <= c.endTime) return true;
    }
    return false;
  }) ?? bases.reduce((a, b) => (b.endTime - b.startTime) >= (a.endTime - a.startTime) ? b : a);

  return [...overlays, primaryBase];
}

function buildPhraseFromChars(
  phrase: TextAlivePhrase,
  chars: TextAliveChar[],
  overlay = false,
): TextAlivePhrase {
  return {
    startTime: phrase.startTime,
    endTime: phrase.endTime,
    text: phrase.text,
    firstChar: chars[0] ?? null,
    next: null,
    overlay,
  };
}

// Overlay staff chorus timings onto a TextAlive video for lyric matching and storyboard
export function mergeChorusTimings(
  base: TextAliveVideo,
  chorusPhrases: PhraseTimingData[],
  chorusWordSizes: number[][],
): MergedChorusVideos {
  if (chorusPhrases.length === 0) return { match: base, display: base };

  const chorusStart = Math.min(...chorusPhrases.map(p => p.startTime));
  const chorusEnd = Math.max(...chorusPhrases.map(p => p.endTime));

  const chorusPhraseNodes: TextAlivePhrase[] = [];
  for (let i = chorusPhrases.length - 1; i >= 0; i--) {
    const node = buildPhraseNodeFromData(chorusPhrases[i], chorusWordSizes[i] ?? [], chorusPhraseNodes[0] ?? null);
    node.overlay = true;
    chorusPhraseNodes.unshift(node);
  }
  linkPhraseNext(chorusPhraseNodes);

  const matchBaseChars = collectTextAliveChars(base)
    .filter(c => c.startTime < chorusStart || c.startTime > chorusEnd)
    .map(cloneChar);

  const chorusChars = chorusPhraseNodes.flatMap(p => walkPhraseChars(p));
  const matchChars = [...matchBaseChars, ...chorusChars].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
  );
  linkNext(matchChars);
  const matchCharByKey = new Map(matchChars.map(c => [charKey(c), c]));

  const matchBasePhraseNodes: TextAlivePhrase[] = [];
  let phrase = base.firstPhrase;
  while (phrase) {
    if (!isDegeneratePhrase(phrase)) {
      const kept = walkPhraseChars(phrase).filter(
        c => c.startTime < chorusStart || c.startTime > chorusEnd,
      );
      matchBasePhraseNodes.push(buildPhraseFromChars(phrase, kept.map(c => matchCharByKey.get(charKey(c))!).filter(Boolean)));
    }
    phrase = phrase.next;
  }

  const matchPhraseChain = [...matchBasePhraseNodes, ...chorusPhraseNodes];
  linkPhraseNext(matchPhraseChain);
  const matchChorusSet = new Set(chorusPhraseNodes);

  const matchVideo: TextAliveVideo = {
    duration: base.duration,
    charCount: matchChars.length,
    firstPhrase: matchPhraseChain[0] ?? null,
    findActivePhrases: t => activePhrasesAt(matchPhraseChain, t),
    findPhrase: (t: number) => {
      for (const p of chorusPhraseNodes) {
        if (t >= p.startTime && t < p.endTime) return p;
      }
      return matchPhraseChain.find(p => !matchChorusSet.has(p) && t >= p.startTime && t < p.endTime) ?? null;
    },
    findChar: (t: number) => matchChars.find(c => t >= c.startTime && t <= c.endTime) ?? null,
  };

  const displayBasePhraseNodes: TextAlivePhrase[] = [];
  phrase = base.firstPhrase;
  while (phrase) {
    if (!isDegeneratePhrase(phrase)) {
      const cloned = walkPhraseChars(phrase).map(cloneChar);
      linkNext(cloned);
      displayBasePhraseNodes.push(buildPhraseFromChars(phrase, cloned));
    }
    phrase = phrase.next;
  }

  const displayPhraseChain = [...displayBasePhraseNodes, ...chorusPhraseNodes];
  linkPhraseNext(displayPhraseChain);

  const displayVideo: TextAliveVideo = {
    duration: base.duration,
    charCount: displayPhraseChain.flatMap(p => walkPhraseChars(p)).length,
    firstPhrase: displayPhraseChain[0] ?? null,
    findActivePhrases: t => activePhrasesAt(displayPhraseChain, t),
    findPhrase: (t: number) => displayPhraseChain.find(p => t >= p.startTime && t < p.endTime) ?? null,
    findChar: (t: number) => {
      for (const p of [...displayPhraseChain].reverse()) {
        const c = walkPhraseChars(p).find(ch => t >= ch.startTime && t <= ch.endTime);
        if (c) return c;
      }
      return null;
    },
  };

  return { match: matchVideo, display: displayVideo };
}