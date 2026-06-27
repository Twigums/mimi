import { collectTextAliveChars } from "./charLookup";
import type { TextAliveChar, TextAlivePhrase, TextAliveVideo, TextAliveWord } from "./textalive";

export interface PhraseTimingData {
  startTime: number;
  endTime: number;
  text: string;
  chars: Array<{ text: string; startTime: number; endTime: number }>;
}

/** Phrase-grouped timings (test fixtures, tooling). */
export interface PhraseGroup {
  startTime: number;
  endTime: number;
  chars: Array<{ text: string; startTime: number; endTime: number }>;
}

type ChorusSlot = { startTime: number; endTime: number };

function linesFrom(raw: string): string[] {
  return raw.split(/\r?\n/).map(l => l.replace(/\r$/, ""));
}

/** Drop // comment lines so the staff jsonc parses as JSON. */
export function stripJsoncComments(raw: string): string {
  return linesFrom(raw).filter(line => !/^\s*\/\//.test(line)).join("\n");
}

/** Pull Japanese lyric lines from // comments (phrase text, not file headers). */
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

/** Parse Magical Mirai staff chorus jsonc into timed phrases with glyph text. */
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

/** Parse jsonc and return phrase data plus per-phrase word sizes for word grouping. */
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

function walkPhraseChars(phrase: TextAlivePhrase): TextAliveChar[] {
  const out: TextAliveChar[] = [];
  let c = phrase.firstChar;
  while (c) { out.push(c); c = c.next; }
  return out;
}

/** TextAlive emits placeholder micro-timings when char sync failed for a phrase. */
export function isDegeneratePhraseData(phrase: PhraseGroup): boolean {
  if (phrase.chars.length === 0) return true;
  const span = phrase.endTime - phrase.startTime;
  if (span < 150 && phrase.chars.length >= 5) return true;
  const durs = phrase.chars.map(c => c.endTime - c.startTime).sort((a, b) => a - b);
  const med = durs[Math.floor(durs.length / 2)];
  return med < 25;
}

/** TextAlive emits placeholder micro-timings when char sync failed for a phrase. */
export function isDegeneratePhrase(phrase: TextAlivePhrase): boolean {
  const chars = walkPhraseChars(phrase);
  if (chars.length === 0) return true;
  const span = phrase.endTime - phrase.startTime;
  if (span < 150 && chars.length >= 5) return true;
  const med = chars.map(c => c.endTime - c.startTime).sort((a, b) => a - b)[Math.floor(chars.length / 2)];
  return med < 25;
}

/** Drop degenerate API phrases and overlay staff chorus timings into phrase-grouped data. */
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

/** Overlay staff chorus timings onto a TextAlive video for lyric matching and storyboard. */
export function mergeChorusTimings(
  base: TextAliveVideo,
  chorusPhrases: PhraseTimingData[],
  chorusWordSizes: number[][],
): TextAliveVideo {
  if (chorusPhrases.length === 0) return base;

  const chorusStart = Math.min(...chorusPhrases.map(p => p.startTime));
  const chorusEnd = Math.max(...chorusPhrases.map(p => p.endTime));

  const keptBasePhrases: TextAlivePhrase[] = [];
  let phrase = base.firstPhrase;
  while (phrase) {
    if (!isDegeneratePhrase(phrase)) keptBasePhrases.push(phrase);
    phrase = phrase.next;
  }
  for (let i = 0; i < keptBasePhrases.length - 1; i++) {
    keptBasePhrases[i].next = keptBasePhrases[i + 1];
  }
  if (keptBasePhrases.length > 0) {
    keptBasePhrases[keptBasePhrases.length - 1].next = null;
  }

  const baseChars = collectTextAliveChars(base).filter(
    c => c.startTime < chorusStart || c.startTime > chorusEnd,
  );

  const chorusPhraseNodes: TextAlivePhrase[] = [];
  for (let i = chorusPhrases.length - 1; i >= 0; i--) {
    chorusPhraseNodes.unshift(
      buildPhraseNodeFromData(chorusPhrases[i], chorusWordSizes[i] ?? [], chorusPhraseNodes[0] ?? null),
    );
  }
  for (let i = 0; i < chorusPhraseNodes.length - 1; i++) {
    chorusPhraseNodes[i].next = chorusPhraseNodes[i + 1];
  }

  const chorusChars = chorusPhraseNodes.flatMap(p => walkPhraseChars(p));
  const allChars = [...baseChars, ...chorusChars].sort(
    (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
  );
  for (let i = 0; i < allChars.length - 1; i++) allChars[i].next = allChars[i + 1];
  if (allChars.length > 0) allChars[allChars.length - 1].next = null;

  const phraseChain = [...keptBasePhrases, ...chorusPhraseNodes];
  for (let i = 0; i < phraseChain.length - 1; i++) phraseChain[i].next = phraseChain[i + 1];
  if (phraseChain.length > 0) phraseChain[phraseChain.length - 1].next = null;

  const chorusSet = new Set(chorusPhraseNodes);

  return {
    duration: base.duration,
    charCount: allChars.length,
    firstPhrase: phraseChain[0] ?? null,
    findPhrase: (t: number) => {
      for (const p of chorusPhraseNodes) {
        if (t >= p.startTime && t <= p.endTime) return p;
      }
      return phraseChain.find(p => !chorusSet.has(p) && t >= p.startTime && t <= p.endTime) ?? null;
    },
    findChar: (t: number) => allChars.find(c => t >= c.startTime && t <= c.endTime) ?? null,
  };
}
