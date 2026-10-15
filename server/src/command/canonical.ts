/**
 * Doc-canonical demo headline values (Vinga / DWAN explanation PDF + HTML).
 * Consistency tests and presenters compare at displayed precision.
 */
export const CANONICAL = {
  /** Coverage-adjusted, weight-averaged enterprise score (display f1). */
  headlineScore: "50.8",
  /** Arithmetic band before floor. */
  arithmeticBand: "Medium" as const,
  /** Displayed headline after floor rule. */
  headlineBand: "High" as const,
  floored: true,
  criticalDomains: 2,
  /** Plain average of the 12 RAW domain scores (display f1). Distinct from OT/ICS adjusted. */
  plainRawAverage: "42.8",
  /** OT / ICS Security adjusted score (display f1). Coincidence with plainRawAverage. */
  otIcsAdjusted: "42.8",
  confidencePct: 72,
  confidenceLabel: "Medium" as const,
  feedsFresh: 35,
  feedsTotal: 39,
  weightedCoveragePct: 78,
  domainSpread: { Critical: 2, High: 2, Medium: 4, Low: 4 },
  outsideAppetite: 5,
  domainCount: 12,
  openDecisions: 4,
  /** AED millions. */
  ale: 2.89,
  /** One-decimal AED millions display (formatAed / format1) — e.g. AED 2.9M. */
  aleDisplay: "2.9",
  p90: 10.07,
  p95: 14.94,
  /** rejected_rate must stay 0 so confidence formula does not drop below 72%. */
  rejectedRate: 0,
} as const;
