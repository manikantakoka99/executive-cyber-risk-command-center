/**
 * Al Dhabi demo: force executive screens onto one canonical source of truth
 * (command Headline: 50.8 High, AED 2.9M, 4 open decisions, domain band spread).
 */
import { CANONICAL } from "./canonical.js";
import { BASELINE, ENTERPRISE_LOSS, MONTHS, monthScorecards } from "./model.js";
import { DEMO_ORG_ID } from "./personas.js";

export function isDemoOrg(orgId: string): boolean {
  return orgId === DEMO_ORG_ID;
}

export function canonicalLossAbsolute() {
  return {
    aleAed: Math.round(ENTERPRISE_LOSS.ale * 1_000_000),
    p90Aed: Math.round(ENTERPRISE_LOSS.p90 * 1_000_000),
    p95Aed: Math.round(ENTERPRISE_LOSS.p95 * 1_000_000),
    aleM: ENTERPRISE_LOSS.ale,
    p90M: ENTERPRISE_LOSS.p90,
    p95M: ENTERPRISE_LOSS.p95,
  };
}

/** Overlay Operations / overview KPIs. */
export function overlayOverview<T extends Record<string, unknown>>(orgId: string, data: T | null): T | null {
  if (!data || !isDemoOrg(orgId)) return data;
  const loss = canonicalLossAbsolute();
  const score = Number(CANONICAL.headlineScore);
  return {
    ...data,
    enterpriseRisk: {
      ...((data.enterpriseRisk as object) ?? {}),
      score,
      severity: CANONICAL.headlineBand.toLowerCase(),
      driverSummary: `${CANONICAL.criticalDomains} Critical domains drive the floor to ${CANONICAL.headlineBand}`,
      deltaVsPrior: 0.1,
    },
    businessImpactExposureAed: loss.aleAed,
    annualLossAedM: { ...ENTERPRISE_LOSS },
    p90BadYearAed: loss.p90Aed,
    p95BadYearAed: loss.p95Aed,
    decisionsAwaitingCxo: CANONICAL.openDecisions,
    decisionsAwaitingCritical: CANONICAL.criticalDomains,
    domainsMonitored: CANONICAL.domainCount,
    riskAppetite: 50,
  };
}

/** Overlay Intelligence portfolio totals. */
export function overlayPortfolio(orgId: string, portfolio: any) {
  if (!isDemoOrg(orgId) || !portfolio?.totals) return portfolio;
  const loss = canonicalLossAbsolute();
  const topRisks = filterPresentationNoise(portfolio.topRisks ?? []);
  return {
    ...portfolio,
    methodology:
      "Enterprise portfolio posture uses the 12 risk-domain bands and canonical annual loss; scenario list is filtered and is not averaged into the headline.",
    totals: {
      ...portfolio.totals,
      // Visible demo scenarios (test fixtures stripped) — aligns with /scenarios cards.
      activeScenarios: Math.max(topRisks.length, 5),
      byPriority: {
        critical: CANONICAL.domainSpread.Critical,
        high: CANONICAL.domainSpread.High,
        medium: CANONICAL.domainSpread.Medium,
        low: CANONICAL.domainSpread.Low,
      },
      outsideTolerance: CANONICAL.outsideAppetite,
      domainCount: CANONICAL.domainCount,
      knownFinancialExposureAed: loss.aleAed,
      annualLossAedM: { ...ENTERPRISE_LOSS },
      openDecisions: CANONICAL.openDecisions,
      enterpriseScore: Number(CANONICAL.headlineScore),
      enterpriseBand: CANONICAL.headlineBand,
    },
    topRisks,
  };
}

export function overlayDecisionCenter(orgId: string, center: any) {
  if (!isDemoOrg(orgId) || !center) return center;
  const n = CANONICAL.openDecisions;
  const existing = Array.isArray(center.awaitingAction) ? center.awaitingAction : [];
  // Pad with command-queue placeholders so Intelligence decision count matches Headline.
  const placeholders = [
    "Emergency patch window for payment-gateway CVEs",
    "Extend network detection across critical segments",
    "Fund OT/ICS monitoring gap closure",
    "Accept residual identity risk with 90-day review",
  ].map((title, i) => ({
    decisionId: `canonical-q${i + 1}`,
    scenarioId: null,
    title,
    status: "awaiting_decision",
    priority: i < 2 ? "critical" : "high",
    what: title,
    why: "Canonical demo decision aligned to the command queue",
    businessImpact: null,
    residualRisk: null,
    toleranceState: "outside",
    recommendedTreatment: "mitigate",
    owner: "CxO",
    dueDate: null,
    financialExposureAed: null,
    escalatedAt: null,
    synthetic: true,
  }));
  const awaitingAction =
    existing.length >= n
      ? existing.slice(0, n)
      : [...existing, ...placeholders.filter((p) => !existing.some((e: any) => e.title === p.title))].slice(
          0,
          n,
        );
  return {
    ...center,
    awaitingAction,
    awaitingActionCount: n,
    note: center.note,
  };
}

/** Prefer command-model six-month trend when DB history is thin. */
export function overlayTrends(orgId: string, trends: any) {
  if (!isDemoOrg(orgId) || !trends) return trends;
  if (!trends.insufficientHistory && (trends.residualTrend?.length ?? 0) >= 2) return trends;
  const cards = monthScorecards();
  const residualTrend = cards.map((row, i) => ({
    day: `2026-${String(i + 4).padStart(2, "0")}-01`,
    month: row.month,
    avgResidual: Number(row.card.arithmetic.toFixed(1)),
    n: CANONICAL.domainCount,
  }));
  return {
    ...trends,
    window: trends.window ?? "30d",
    insufficientHistory: false,
    message: `Six-month domain composite (${MONTHS[0]}–${MONTHS[MONTHS.length - 1]}) from the approved scoring model.`,
    residualTrend,
    inherentVsResidual: residualTrend.map((r) => ({
      day: r.day,
      avgInherent: r.avgResidual,
      avgResidual: r.avgResidual,
    })),
    source: "command_model",
  };
}

const NOISE_TITLE =
  /^(P4 isolated|P4-base-|p3-corr-|Generic Security Events \d+)/i;

export function isPresentationNoiseTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return NOISE_TITLE.test(title) || /Unnamed process/i.test(title);
}

export function filterPresentationNoise<T extends { title?: string; name?: string }>(rows: T[]): T[] {
  return rows.filter((row) => !isPresentationNoiseTitle(row.title ?? row.name));
}

export function canonicalDomainBands() {
  return { ...BASELINE.counts };
}
