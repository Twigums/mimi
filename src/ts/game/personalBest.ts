// Personal-best tracking (issue #72). Each song difficulty keeps one record in
// localStorage, ranked by accuracy (there is no player-facing score, #75). The
// chart's content hash is stored alongside the record so an edit to the chart
// invalidates a stale best (a different note set) instead of crediting an old
// result to the new notes.
//
// localStorage contract:
//   key   `mimi:pb:<songId>::<difficulty>`  (songId = the language-stable English
//                                            song name; one record per difficulty)
//   value JSON PersonalBest, including the `hash` it was set on — a record whose
//         stored hash no longer matches the live chart is treated as absent.
import type { Note } from "./engine";

export interface PersonalBest {
  accuracy: number; // 0..1, the ranking key
  grade: string;
  maxCombo: number;
  hash: string; // chart content hash this best was set on
  at: number;   // epoch ms when the best was set
}

const PB_PREFIX = "mimi:pb:";

const KIND_CODE: Record<string, number> = { cut: 1, flow: 2, lyric: 3 };

// Stable 32-bit FNV-1a hash over the gameplay-relevant, order-sensitive fields of
// every note. Positions/direction are rounded so insignificant float jitter in the
// compiled JSON doesn't spuriously invalidate a best.
export function hashChart(notes: Note[]): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h = Math.imul(h ^ (n | 0), 0x01000193);
  };
  for (const n of notes) {
    mix(KIND_CODE[n.kind] ?? 0);
    mix(Math.round(n.time));
    mix(Math.round(n.x));
    mix(Math.round(n.y));
    mix(Math.round((n.direction ?? 0) * 1000));
  }
  return (h >>> 0).toString(16);
}

function pbKey(songId: string, difficulty: string): string {
  return `${PB_PREFIX}${songId}::${difficulty}`;
}

// The stored best for this chart, or null when there is none or the stored record
// predates a chart edit (its hash no longer matches the live chart).
export function loadPersonalBest(songId: string, difficulty: string, hash: string): PersonalBest | null {
  try {
    const raw = localStorage.getItem(pbKey(songId, difficulty));
    if (!raw) return null;
    const pb = JSON.parse(raw) as PersonalBest;
    return pb.hash === hash ? pb : null;
  } catch {
    return null;
  }
}

// Record a run if it beats (by accuracy) the current valid best, replacing any
// stale record. Returns the best that stood *before* this run (null if none) and
// whether this run set a new record, so the results screen can show both.
export function commitPersonalBest(
  songId: string,
  difficulty: string,
  candidate: Omit<PersonalBest, "at">,
): { previous: PersonalBest | null; isRecord: boolean } {
  const previous = loadPersonalBest(songId, difficulty, candidate.hash);
  const isRecord = previous === null || candidate.accuracy > previous.accuracy;
  if (isRecord) {
    try {
      localStorage.setItem(
        pbKey(songId, difficulty),
        JSON.stringify({ ...candidate, at: Date.now() } satisfies PersonalBest),
      );
    } catch { /* storage full or unavailable — skip persisting */ }
  }
  return { previous, isRecord };
}
