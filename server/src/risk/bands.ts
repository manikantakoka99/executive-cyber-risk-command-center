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

export type PriorityTier = "critical" | "high" | "medium" | "low";

export function bandOf(score: number): Band {
  if (score >= BAND_THRESHOLDS.criticalMin) return "Critical";
  if (score >= BAND_THRESHOLDS.highMin) return "High";
  if (score >= BAND_THRESHOLDS.mediumMin) return "Medium";
  return "Low";
}

/** Lowercase label for narrative copy and API priority fields. */
export function tierWord(score: number): PriorityTier {
  return bandOf(score).toLowerCase() as PriorityTier;
}

/** Alias — derive display/API tier from residual (never trust stored tier). */
export function priorityTierFromScore(score: number): PriorityTier {
  return tierWord(score);
}

/**
 * SQL CASE that maps a residual-risk expression onto priority_tier text.
 * Thresholds are compile-time constants from BAND_THRESHOLDS.
 */
export function sqlPriorityFromResidual(expr = "ra.residual_risk"): string {
  return `CASE
    WHEN ${expr} IS NULL THEN 'low'
    WHEN ${expr} >= ${BAND_THRESHOLDS.criticalMin} THEN 'critical'
    WHEN ${expr} >= ${BAND_THRESHOLDS.highMin} THEN 'high'
    WHEN ${expr} >= ${BAND_THRESHOLDS.mediumMin} THEN 'medium'
    ELSE 'low'
  END`;
}

/** Policy JSON shape kept in sync with BAND_THRESHOLDS. */
export function priorityBandsConfig() {
  return {
    critical: BAND_THRESHOLDS.criticalMin,
    high: BAND_THRESHOLDS.highMin,
    medium: BAND_THRESHOLDS.mediumMin,
  };
}
