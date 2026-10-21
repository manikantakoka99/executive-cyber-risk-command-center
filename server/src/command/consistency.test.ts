import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL } from "./canonical.js";
import {
  BASELINE,
  DOMAINS,
  ENTERPRISE_LOSS,
  adjustedScore,
  bandOf,
  feedTotals,
  format1,
  format2,
  weightedCoverage,
} from "./model.js";
import {
  canonicalLossAbsolute,
  overlayDecisionCenter,
  overlayOverview,
  overlayPortfolio,
  overlayTrends,
} from "./demoOverlay.js";
import { presentEvidence, presentWorkspace } from "./present.js";
import { DEMO_ORG_ID } from "./personas.js";
import { hasPermission, homeFor, redactFinancial } from "./rbac.js";
import { initialState } from "./store.js";

const FINANCIAL_ROLES = ["ciso", "cxo", "board_member", "risk_lead", "auditor"] as const;
const NO_MONEY_ROLES = ["domain_analyst", "program_office", "admin"] as const;

function payloadHasAed(value: unknown): boolean {
  return /\bAED\b|\bP9[05]\b/i.test(JSON.stringify(value));
}

describe("cross-screen canonical consistency (Vinga PDF/HTML)", () => {
  it("enterprise headline is 50.8 Critical with floor; plain raw average is 42.8", () => {
    assert.equal(format1(BASELINE.arithmetic), CANONICAL.headlineScore);
    assert.equal(bandOf(BASELINE.arithmetic), CANONICAL.arithmeticBand);
    assert.equal(BASELINE.headline, CANONICAL.headlineBand);
    assert.equal(BASELINE.floored, CANONICAL.floored);
    assert.equal(BASELINE.counts.Critical, CANONICAL.criticalDomains);
    assert.equal(format1(BASELINE.plain), CANONICAL.plainRawAverage);
    // Plain raw average ≠ OT/ICS adjusted (same digits, different meaning).
    const ot = BASELINE.rows.find((r) => r.domain.id === "ot")!;
    assert.equal(format1(ot.adjusted), CANONICAL.otIcsAdjusted);
    assert.equal(format1(ot.raw), "17.0");
    assert.notEqual(ot.raw, BASELINE.plain);
  });

  it("confidence 72%, feeds 35/39, weighted coverage 78%, spread and appetite", () => {
    assert.equal(Math.round(BASELINE.confidence * 100), CANONICAL.confidencePct);
    const feeds = feedTotals();
    assert.equal(feeds.fresh, CANONICAL.feedsFresh);
    assert.equal(feeds.total, CANONICAL.feedsTotal);
    assert.equal(Math.round(weightedCoverage() * 100), CANONICAL.weightedCoveragePct);
    assert.deepEqual(BASELINE.counts, CANONICAL.domainSpread);
    const outside = BASELINE.rows.filter((r) => r.adjusted > r.domain.appetite).length;
    assert.equal(outside, CANONICAL.outsideAppetite);
    assert.equal(DOMAINS.length, CANONICAL.domainCount);
    // Schema confidence also × (1 − rejected_rate); seed must keep rejected_rate = 0.
    assert.equal(CANONICAL.rejectedRate, 0);
  });

  it("loss figures match ENT at display precision", () => {
    assert.equal(ENTERPRISE_LOSS.ale, CANONICAL.ale);
    assert.equal(format1(ENTERPRISE_LOSS.ale), CANONICAL.aleDisplay);
    assert.equal(format2(ENTERPRISE_LOSS.p90), "10.07");
    assert.equal(format2(ENTERPRISE_LOSS.p95), "14.94");
  });

  it("presenter surfaces the same numbers on every command view that shows them", () => {
    const orgId = "2accc7de-f693-4b19-8fe8-6db501be05e2";
    const ws = presentWorkspace("ciso", initialState(), "Al Dhabi Holdings", orgId);
    assert.equal(format1(ws.headline!.arithmetic), CANONICAL.headlineScore);
    assert.equal(ws.headline!.band, CANONICAL.headlineBand);
    assert.equal(ws.headline!.floored, true);
    assert.match(ws.headline!.floorNote ?? "", /Org held at Critical because Attack Surface and VAPT is Critical/);
    assert.equal(format1(ws.headline!.plain), CANONICAL.plainRawAverage);
    assert.equal(ws.headline!.confidencePct, CANONICAL.confidencePct);
    assert.equal(ws.headline!.outsideAppetite, CANONICAL.outsideAppetite);
    assert.equal(ws.openDecisions, CANONICAL.openDecisions);
    assert.equal(ws.headline!.acceptanceCount, CANONICAL.openDecisions);
    assert.equal(ws.trust!.fresh, CANONICAL.feedsFresh);
    assert.equal(ws.trust!.total, CANONICAL.feedsTotal);
    assert.equal(ws.trust!.confidencePct, CANONICAL.confidencePct);
    assert.equal(ws.trust!.weightedCoveragePct, CANONICAL.weightedCoveragePct);
    assert.equal(format1(ws.headline!.loss!.ale), CANONICAL.aleDisplay);
    assert.equal(ws.headline!.loss!.p90, CANONICAL.p90);
    assert.equal(ws.pack!.heading.includes(CANONICAL.headlineBand), true);
    assert.ok(ws.pack!.blocks.some((b) => b.text?.includes(CANONICAL.headlineScore)));
    // Board / exec screens show the approved policy version (not draft).
    assert.match(ws.headline!.policyVersion, /v1 \(approved\)/i);
    assert.equal(
      presentWorkspace("board_member", initialState(), "Al Dhabi Holdings", orgId).headline!
        .policyVersion,
      "v1 (approved)",
    );
  });

  it("financial roles receive canonical ALE 2.9 / P90 / P95; non-financial roles get no AED", () => {
    for (const role of FINANCIAL_ROLES) {
      assert.equal(hasPermission(role, "command.loss"), true, role);
      const ws = redactFinancial(role, presentWorkspace(role, initialState(), "Al Dhabi Holdings"));
      if (ws.headline) {
        assert.equal(format1(ws.headline.loss!.ale), CANONICAL.aleDisplay, role);
        assert.equal(ws.headline.loss!.p90, CANONICAL.p90, role);
        assert.equal(ws.headline.loss!.p95, CANONICAL.p95, role);
        assert.equal(ws.headline.acceptanceCount, CANONICAL.openDecisions, role);
      }
      if (ws.pack) {
        const money = ws.pack.blocks.find((b) => b.heading === "Money");
        assert.ok(money?.text?.includes("AED"), role);
        assert.ok(money?.text?.includes(CANONICAL.aleDisplay), role);
      }
      assert.equal(payloadHasAed(ws), true, role);
    }

    for (const role of NO_MONEY_ROLES) {
      assert.equal(hasPermission(role, "command.loss"), false, role);
      const ws = redactFinancial(role, presentWorkspace(role, initialState(), "Al Dhabi Holdings"));
      assert.equal(ws.headline?.loss ?? null, null, role);
      assert.equal(ws.queue?.canSeeLoss ?? false, false, role);
      assert.ok(!(ws.queue?.items ?? []).some((item) => item.loss), role);
      assert.ok(!(ws.pack?.blocks ?? []).some((b) => b.heading === "Money"), role);
      assert.equal(payloadHasAed(ws), false, `${role} workspace must carry no AED`);
      const evidence = redactFinancial(role, presentEvidence(role, "ran"));
      assert.equal(evidence?.loss ?? null, null, role);
      assert.equal(payloadHasAed(evidence), false, `${role} evidence must carry no AED`);
    }
  });

  it("persona homes match Quiet Command: CISO posture, CxO/Board headline", () => {
    assert.equal(homeFor("ciso"), "/c/posture");
    assert.equal(homeFor("cxo"), "/c/headline");
    assert.equal(homeFor("board_member"), "/c/headline");
  });

  it("spot-checks domain adjusted scores at display precision", () => {
    const byId = Object.fromEntries(BASELINE.rows.map((r) => [r.domain.id, r]));
    assert.equal(format1(byId.att!.adjusted), "76.0");
    assert.equal(format1(byId.soc!.adjusted), "72.0");
    assert.equal(format1(byId.ran!.adjusted), "55.2");
    assert.equal(format1(byId.pci!.adjusted), "51.0");
    assert.equal(format1(byId.ai!.adjusted), "53.5");
    assert.equal(format1(byId.cld!.adjusted), "30.8");
    assert.equal(format1(byId.ot!.adjusted), "42.8");
    assert.equal(format1(adjustedScore(17, 0.4)), "42.8");
  });

  it("Operations + Intelligence overlays match Headline canonical numbers", () => {
    const loss = canonicalLossAbsolute();
    const overview = overlayOverview(DEMO_ORG_ID, {
      enterpriseRisk: { score: 43, severity: "medium" },
      businessImpactExposureAed: 5_100_000,
      decisionsAwaitingCxo: 0,
      domainsMonitored: 9,
    });
    assert.equal(overview!.enterpriseRisk.score, Number(CANONICAL.headlineScore));
    assert.equal(overview!.enterpriseRisk.severity, CANONICAL.headlineBand.toLowerCase());
    assert.equal(overview!.businessImpactExposureAed, loss.aleAed);
    assert.equal(overview!.decisionsAwaitingCxo, CANONICAL.openDecisions);

    const portfolio = overlayPortfolio(DEMO_ORG_ID, {
      totals: {
        activeScenarios: 20,
        byPriority: { critical: 0, high: 0, medium: 43, low: 0 },
        outsideTolerance: 0,
        knownFinancialExposureAed: 1_540_000,
        openDecisions: 0,
      },
      topRisks: [
        { title: "Payment path privilege anomaly" },
        { title: "P4 isolated 179205 junk" },
        { title: "P4-base-fixture" },
        { title: "Internet-facing API exposure" },
        { title: "Ransomware resilience gap" },
        { title: "Credential compromise path" },
        { title: "Recovery control degradation" },
      ],
    });
    assert.equal(portfolio.totals.enterpriseScore, Number(CANONICAL.headlineScore));
    assert.equal(portfolio.totals.enterpriseBand, CANONICAL.headlineBand);
    assert.equal(portfolio.totals.knownFinancialExposureAed, loss.aleAed);
    assert.equal(portfolio.totals.openDecisions, CANONICAL.openDecisions);
    assert.equal(portfolio.totals.outsideTolerance, CANONICAL.outsideAppetite);
    assert.deepEqual(portfolio.totals.byPriority, {
      critical: CANONICAL.domainSpread.Critical,
      high: CANONICAL.domainSpread.High,
      medium: CANONICAL.domainSpread.Medium,
      low: CANONICAL.domainSpread.Low,
    });
    assert.ok(!portfolio.topRisks.some((r: { title: string }) => /P4 isolated|P4-base-/i.test(r.title)));
    assert.equal(portfolio.totals.activeScenarios, 5);

    const center = overlayDecisionCenter(DEMO_ORG_ID, {
      awaitingAction: [],
      awaitingInformation: [],
      overdue: [],
    });
    assert.equal(center.awaitingActionCount, CANONICAL.openDecisions);
    assert.equal(center.awaitingAction.length, CANONICAL.openDecisions);

    const trends = overlayTrends(DEMO_ORG_ID, {
      insufficientHistory: true,
      residualTrend: [],
      message: "Insufficient historical data",
      scenarioVelocity: { newScenarios: 20, outsideToleranceNow: 12 },
    });
    assert.equal(trends.insufficientHistory, false);
    assert.ok((trends.residualTrend?.length ?? 0) >= 2);
    assert.equal(trends.scenarioVelocity.newScenarios, 5);
    // Scenario outside-tolerance is not replaced with the domain appetite count.
    assert.equal(trends.scenarioVelocity.outsideToleranceNow, 12);
  });
});
