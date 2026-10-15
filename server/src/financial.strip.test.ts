import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ROLE_CODES,
  canViewFinancials,
  canonicalRole,
  hasFinancialLeak,
  hasPermission,
  isRoleCode,
  redactFinancial,
} from "./command/rbac.js";
import { DEMO_ORG_ID } from "./command/personas.js";
import { listDecisions } from "./services/decisions.js";
import { getOverview } from "./services/overview.js";
import { getPortfolio } from "./services/intelligence.js";
import { listFindings } from "./services/catalog.js";
import { listScenarios } from "./services/scenarios.js";
import { ENTERPRISE_LOSS } from "./command/model.js";
import { CANONICAL } from "./command/canonical.js";

const ORG = DEMO_ORG_ID;

const NON_FINANCIAL = ROLE_CODES.filter((r) => !canViewFinancials(r));

describe("central financial strip (all routes × non-financial roles)", () => {
  it("omits financial keys entirely (no null placeholders)", () => {
    const sample = {
      title: "x",
      financialExposureAed: 1_000_000,
      note: "Cost about AED 2.9M",
      nested: { ale: 2.89, p90: 10.07, ok: true },
    };
    const stripped = redactFinancial("program_office", sample) as Record<string, unknown>;
    assert.equal("financialExposureAed" in stripped, false);
    assert.equal("ale" in (stripped.nested as object), false);
    assert.equal(hasFinancialLeak(stripped), false);
    assert.equal(canViewFinancials("program_office"), false);
    assert.equal(canViewFinancials("domain_analyst"), false);
    assert.equal(canViewFinancials("admin"), false);
    assert.equal(canViewFinancials("cxo"), true);
  });

  it("maps compliance_manager away from the schema role set", () => {
    assert.equal(isRoleCode("compliance_manager"), false);
    assert.equal(canonicalRole("compliance_manager"), "program_office");
    assert.equal(hasPermission("compliance_manager", "command.loss"), false);
  });

  it("strips money from overview, decisions, portfolio, findings, scenarios for every non-financial role", async () => {
    const [overview, decisions, portfolio, findings, scenarios] = await Promise.all([
      getOverview(ORG),
      listDecisions(ORG),
      getPortfolio(ORG),
      listFindings(ORG),
      listScenarios(ORG),
    ]);

    const routes: { name: string; payload: unknown }[] = [
      { name: "overview", payload: overview },
      { name: "decisions", payload: { decisions } },
      { name: "portfolio", payload: portfolio },
      { name: "findings", payload: { findings } },
      { name: "scenarios", payload: { scenarios } },
    ];

    for (const role of NON_FINANCIAL) {
      for (const route of routes) {
        const redacted = redactFinancial(role, route.payload);
        assert.equal(
          hasFinancialLeak(redacted),
          false,
          `${role} × ${route.name} must not leak AED/financial fields`,
        );
      }
    }
  });

  it("canonical annual loss on overview + portfolio for Al Dhabi", async () => {
    const overview = await getOverview(ORG);
    const portfolio = await getPortfolio(ORG);
    assert.equal(overview?.businessImpactExposureAed, Math.round(ENTERPRISE_LOSS.ale * 1_000_000));
    assert.deepEqual(overview?.annualLossAedM, ENTERPRISE_LOSS);
    assert.equal(portfolio.totals.knownFinancialExposureAed, Math.round(ENTERPRISE_LOSS.ale * 1_000_000));
    assert.deepEqual(portfolio.totals.annualLossAedM, ENTERPRISE_LOSS);
    assert.deepEqual(portfolio.totals.byPriority, {
      critical: CANONICAL.domainSpread.Critical,
      high: CANONICAL.domainSpread.High,
      medium: CANONICAL.domainSpread.Medium,
      low: CANONICAL.domainSpread.Low,
    });
    assert.equal(portfolio.totals.outsideTolerance, CANONICAL.outsideAppetite);
  });
});
