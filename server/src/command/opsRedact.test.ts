import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canViewOperationsTechnical,
  hasPermission,
  redactOperationsTechnical,
} from "./rbac.js";

describe("operations technical redaction for CxO", () => {
  it("lets CxO open ops overview and decide, but not findings/connectors", () => {
    assert.equal(hasPermission("cxo", "ops.overview"), true);
    assert.equal(hasPermission("cxo", "decisions.act"), true);
    assert.equal(hasPermission("cxo", "findings.read"), false);
    assert.equal(hasPermission("cxo", "connectors.read"), false);
    assert.equal(canViewOperationsTechnical("cxo"), false);
    assert.equal(canViewOperationsTechnical("ciso"), true);
  });

  it("strips findings/connector/signal fields while keeping decide ids", () => {
    const payload = {
      decisionsAwaitingCxo: 4,
      criticalFindingsOpen: 9,
      pendingDecisions: [
        {
          decisionId: "dec-1",
          findingId: "find-1",
          title: "Fund OT monitoring",
        },
      ],
      executiveActionQueue: [
        { scenarioId: "sc-1", title: "Decide me", recommendedAction: "Approve" },
      ],
      riskScenarios: { top: [{ scenarioId: "sc-2", title: "tech" }], outsideTolerance: 3 },
      activity: [
        { activityType: "decision_approved", summary: "ok" },
        { activityType: "finding_opened", summary: "hide" },
        { activityType: "connector_sync", summary: "hide" },
      ],
      connectors: [{ connectorId: "c1" }],
    };

    const redacted = redactOperationsTechnical("cxo", payload);
    assert.equal(redacted.decisionsAwaitingCxo, 4);
    assert.equal(redacted.criticalFindingsOpen, undefined);
    assert.equal(redacted.connectors, undefined);
    assert.equal(redacted.riskScenarios, undefined);
    assert.equal(redacted.pendingDecisions[0]!.decisionId, "dec-1");
    assert.equal(redacted.pendingDecisions[0]!.findingId, undefined);
    assert.equal(redacted.executiveActionQueue[0]!.scenarioId, "sc-1");
    assert.equal(redacted.activity.length, 1);
    assert.equal(redacted.activity[0]!.activityType, "decision_approved");

    const ciso = redactOperationsTechnical("ciso", payload);
    assert.equal(ciso.criticalFindingsOpen, 9);
    assert.equal(ciso.riskScenarios?.outsideTolerance, 3);
  });
});
