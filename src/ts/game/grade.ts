import type { GameStats, HitResult } from "./engine";
import { MAX_POINTS } from "./engine";

export type Grade = "SSS" | "SS" | "S" | "A" | "B" | "C" | "F";

export const JUDGEMENT_LABEL: Record<HitResult, string> = {
  tier3: "PERFECT",
  tier2: "GREAT",
  tier1: "GOOD",
  miss:  "MISS",
};

export function computeGrade(stats: GameStats): Grade {
  if (stats.total === 0) return "F";
  const accuracy = computeAccuracy(stats);
  if (accuracy >= 1.00) return "SSS";
  if (accuracy >= 0.99) return "SS";
  if (accuracy >= 0.95) return "S";
  if (accuracy >= 0.85) return "A";
  if (accuracy >= 0.70) return "B";
  if (accuracy >= 0.50) return "C";
  return "F";
}

export function computeAccuracy(stats: GameStats): number {
  if (stats.total === 0) return 0;
  return stats.score / (stats.total * MAX_POINTS);
}
