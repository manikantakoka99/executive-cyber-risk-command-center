/**
 * Single source of truth for severity / residual bands.
 * Critical ≥70, High 55–69, Medium 35–54, Low <35.
 */
export const BAND_THRESHOLDS = {
  mediumMin: 35,
  highMin: 55,
  criticalMin: 70,
} as const;

export type Band = "Critical" | "High" | "Medium" | "Low";

export function bandOf(score: number): Band {
  if (score >= BAND_THRESHOLDS.criticalMin) return "Critical";
  if (score >= BAND_THRESHOLDS.highMin) return "High";
  if (score >= BAND_THRESHOLDS.mediumMin) return "Medium";
  return "Low";
}

/** Lowercase label for narrative copy. */
export function tierWord(score: number): string {
  return bandOf(score).toLowerCase();
}
