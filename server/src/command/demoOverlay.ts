/**
 * Al Dhabi demo: force executive screens onto one canonical source of truth
 * (command Headline: 50.8 High, AED 2.9M, 4 open decisions, domain band spread).
 */
import { CANONICAL } from "./canonical.js";
import { BASELINE, ENTERPRISE_LOSS, MONTHS, monthScorecards } from "./model.js";
import { DEMO_ORG_ID } from "./personas.js";
import {
  isSeededTestScenarioTitle,
  isSeededTestText,
  scenarioSetFromRisks,
  type ScenarioSetCounts,
} from "./testFixtures.js";

/** Agreed open-decision queue (same four titles on Operations and Intelligence). */
const CANONICAL_DECISIONS = [
  {
    title: "Emergency patch window for payment-gateway CVEs",
    priority: "critical" as const,
    action: "Approve an emergency patch window for payment-gateway CVEs.",
  },
  {
    title: "Extend network detection across critical segments",
    priority: "critical" as const,
    action: "Extend network detection across critical segments.",
  },
  {
    title: "Fund OT/ICS monitoring gap closure",
    priority: "high" as const,
    action: "Fund OT/ICS monitoring gap closure.",
  },
  {
    title: "Accept residual identity risk with 90-day review",
    priority: "high" as const,
    action: "Accept residual identity risk with a 90-day review.",
  },
];

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

type OverviewOverlayFields = {
  businessImpactExposureAed: number;
  annualLossAedM: typeof ENTERPRISE_LOSS;
  p90BadYearAed: number;
  p95BadYearAed: number;
  decisionsAwaitingCxo: number;
  decisionsAwaitingCritical: number;
  domainsMonitored: number;
  riskAppetite: number;
};

/** Overlay Operations / overview KPIs. */
export function overlayOverview<T extends Record<string, unknown>>(
  orgId: string,
  data: T | null,
): (T & Partial<OverviewOverlayFields>) | null {
  if (!data) return null;
  if (!isDemoOrg(orgId)) return data;
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
    pendingDecisions: alignPendingDecisions(rowsOf(data, "pendingDecisions")),
    executiveActionQueue: alignExecutiveQueue(rowsOf(data, "executiveActionQueue")),
  };
}

/** Overlay Intelligence portfolio totals. */
export function overlayPortfolio(orgId: string, portfolio: any) {
  if (!isDemoOrg(orgId) || !portfolio?.totals) return portfolio;
  const loss = canonicalLossAbsolute();
  const topRisks = filterPresentationNoise<Record<string, unknown> & { title?: string; name?: string }>(
    portfolio.topRisks ?? [],
  );
  const scenarioSet: ScenarioSetCounts = scenarioSetFromRisks(topRisks);
  return {
    ...portfolio,
    scenarioSet,
    methodology:
      "Enterprise portfolio posture uses the 12 risk-domain bands and canonical annual loss; scenario list is filtered and is not averaged into the headline.",
    totals: {
      ...portfolio.totals,
      // Same cards as topRisks / /scenarios. Do not floor the count when the list is shorter.
      activeScenarios: topRisks.length,
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
  const existing = (Array.isArray(center.awaitingAction) ? center.awaitingAction : []).filter(
    (row: { title?: string }) => !isSeededTestText(row?.title),
  );
  const placeholders = CANONICAL_DECISIONS.map((item, i) => ({
    decisionId: `canonical-q${i + 1}`,
    scenarioId: null,
    title: item.title,
    status: "awaiting_decision",
    priority: item.priority,
    what: item.title,
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

/** Prefer command-model six-month trend when DB history is thin; always align velocity KPIs. */
export function overlayTrends(orgId: string, trends: any) {
  if (!isDemoOrg(orgId) || !trends) return trends;
  const cards = monthScorecards();
  const residualTrend = cards.map((row, i) => ({
    day: `2026-${String(i + 4).padStart(2, "0")}-01`,
    month: row.month,
    avgResidual: Number(row.card.arithmetic.toFixed(1)),
    n: CANONICAL.domainCount,
  }));
  const useModel =
    trends.insufficientHistory || (trends.residualTrend?.length ?? 0) < 2;
  return {
    ...trends,
    window: trends.window ?? "30d",
    insufficientHistory: false,
    message: useModel
      ? `Six-month domain composite (${MONTHS[0]}–${MONTHS[MONTHS.length - 1]}) from the approved scoring model.`
      : trends.message,
    residualTrend: useModel ? residualTrend : trends.residualTrend,
    inherentVsResidual: useModel
      ? residualTrend.map((r) => ({
          day: r.day,
          avgInherent: r.avgResidual,
          avgResidual: r.avgResidual,
        }))
      : trends.inherentVsResidual,
    // New-scenario velocity stays on the canonical demo figure.
    // Outside-tolerance stays on the caller’s scenario set (not domain appetite).
    scenarioVelocity: {
      newScenarios: 5,
      resolvedScenarios: Number(trends.scenarioVelocity?.resolvedScenarios ?? 0),
      acceptedRisks: Number(trends.scenarioVelocity?.acceptedRisks ?? 0),
      outsideToleranceNow: Number(trends.scenarioVelocity?.outsideToleranceNow ?? 0),
    },
    source: useModel ? "command_model" : trends.source ?? "database",
  };
}

export function isPresentationNoiseTitle(title: string | null | undefined): boolean {
  return isSeededTestScenarioTitle(title);
}

function rowsOf(data: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row),
  );
}

function alignPendingDecisions(existing: Array<Record<string, unknown>>) {
  const n = CANONICAL.openDecisions;
  const kept = existing.filter((row) => !isSeededTestText(String(row?.title ?? ""))).slice(0, n);
  if (kept.length >= n) return kept;
  const seen = new Set(kept.map((row) => String(row.title ?? "")));
  const padded = [...kept];
  for (let i = 0; i < CANONICAL_DECISIONS.length && padded.length < n; i++) {
    const item = CANONICAL_DECISIONS[i]!;
    if (seen.has(item.title)) continue;
    padded.push({
      decisionId: `canonical-q${i + 1}`,
      findingId: null,
      title: item.title,
      priority: item.priority,
      riskSummary: item.title,
      impactSummary: "Canonical open decision aligned to the command queue.",
      recommendedAction: item.action,
      status: "awaiting_decision",
      escalatedAt: new Date().toISOString(),
      domainLabel: "Executive",
      financialExposureAed: null,
      affectedBusinessUnit: null,
      complianceScopeImpact: null,
      synthetic: true,
    });
  }
  return padded;
}

function alignExecutiveQueue(existing: Array<Record<string, unknown>>) {
  const n = CANONICAL.openDecisions;
  const kept = existing.filter((row) => !isSeededTestText(String(row?.title ?? ""))).slice(0, n);
  if (kept.length >= n) return kept;
  const seen = new Set(kept.map((row) => String(row.title ?? "")));
  const padded = [...kept];
  for (let i = 0; i < CANONICAL_DECISIONS.length && padded.length < n; i++) {
    const item = CANONICAL_DECISIONS[i]!;
    if (seen.has(item.title)) continue;
    padded.push({
      scenarioId: null,
      title: item.title,
      priority: item.priority,
      toleranceState: "outside",
      velocity: "stable",
      residualRisk: null,
      recommendedTreatment: "mitigate",
      recommendedAction: item.action,
      financialExposureAed: null,
      financialKnown: false,
      actionOwner: "CxO",
      dueDate: null,
      agingDays: null,
      decisionRequired: true,
    });
  }
  return padded;
}

export function filterPresentationNoise<
  T extends { title?: string; name?: string; isDemo?: boolean },
>(rows: T[]): T[] {
  return rows.filter(
    (row) => row.isDemo || !isPresentationNoiseTitle(row.title ?? row.name),
  );
}

export function canonicalDomainBands() {
  return { ...BASELINE.counts };
}
