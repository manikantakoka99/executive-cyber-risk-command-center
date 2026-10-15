import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { presentEvidence, presentWorkspace } from "./present.js";
import { canAcceptRisk, hasPermission, homeFor, viewsFor } from "./rbac.js";
import {
  acceptQueue,
  approveQueue,
  getState,
  initialState,
  resetState,
  saveScenario,
  updateWhatIf,
  verifyFix,
} from "./store.js";

const ORG = "org-access-test";

describe("command RBAC", () => {
  beforeEach(() => resetState(ORG));

  it("gives each executive role a distinct home and view set", () => {
    assert.deepEqual(viewsFor("board_member"), ["headline", "posture", "changed", "pack"]);
    assert.equal(homeFor("cxo"), "/c/queue");
    assert.equal(homeFor("ciso"), "/c/posture");
    assert.equal(homeFor("security_analyst"), "/c/trust");
    assert.equal(homeFor("soc_analyst"), "/c/trust");
    assert.equal(homeFor("org_admin"), "/admin");
    assert.equal(hasPermission("org_admin", "command.loss"), false);
    assert.equal(hasPermission("board_member", "command.queue.act"), false);
    assert.equal(hasPermission("ciso", "findings.technical"), true);
    assert.equal(hasPermission("cxo", "findings.technical"), false);
    assert.equal(hasPermission("cxo", "command.loss"), true);
    assert.equal(hasPermission("security_analyst", "command.loss"), false);
    assert.equal(canAcceptRisk("cxo"), true);
    assert.equal(canAcceptRisk("risk_lead"), true);
    assert.equal(canAcceptRisk("ciso"), false);
    assert.equal(canAcceptRisk("board_member"), false);
    assert.equal(hasPermission("ciso", "policy.approve"), false);
    assert.equal(hasPermission("ciso", "policy.propose"), true);
    assert.equal(hasPermission("board_member", "policy.approve"), true);
    assert.equal(hasPermission("risk_lead", "command.queue.act"), false);
    assert.equal(hasPermission("risk_lead", "command.queue.accept"), true);
  });

  it("lets CxO and Risk Lead accept risk, and refuses CISO and Board", () => {
    const deniedCiso = acceptQueue(ORG, "ciso", "CISO", "q1", {
      reason: "Vendor migration pending until Q1",
      approver: "CEO",
      days: 30,
    });
    assert.equal(deniedCiso.ok, false);
    if (!deniedCiso.ok) assert.equal(deniedCiso.status, 403);

    const deniedBoard = acceptQueue(ORG, "board_member", "Board", "q1", {
      reason: "Vendor migration pending until Q1",
      approver: "CEO",
      days: 30,
    });
    assert.equal(deniedBoard.ok, false);

    const accepted = acceptQueue(ORG, "risk_lead", "Risk Lead", "q1", {
      reason: "Vendor migration pending until Q1",
      approver: "Risk Lead",
      days: 30,
    });
    assert.equal(accepted.ok, true);
    assert.equal(presentWorkspace("risk_lead", getState(ORG)).queue?.canAccept, true);
  });

  it("strips financials and technical feeds from the board payload except loss and posture summary", () => {
    const board = presentWorkspace("board_member", initialState(), "Al Dhabi Holdings");
    assert.ok(board.headline?.loss);
    assert.equal(board.queue, null);
    assert.equal(board.trust, null);
    assert.equal(board.whatif, null);
    assert.equal(board.closure, null);
    assert.equal(board.posture?.technical, false);
    assert.equal(board.posture?.rows[0]?.raw, undefined);
    const evidence = presentEvidence("board_member", "ran");
    assert.equal(evidence?.raw, null);
    assert.equal(evidence?.scoreBuild, null);
    assert.ok(evidence?.loss);
  });

  it("shows the analyst technical evidence and hides loss", () => {
    const analyst = presentWorkspace("security_analyst", initialState());
    assert.equal(analyst.headline, null);
    assert.ok(analyst.trust);
    assert.equal(analyst.trust?.fresh, 35);
    assert.equal(analyst.queue?.items[0]?.kev, true);
    assert.equal(analyst.queue?.items[0]?.loss, null);
    assert.equal(analyst.whatif, null);
    const evidence = presentEvidence("security_analyst", "att");
    assert.equal(evidence?.raw, 76);
    assert.equal(evidence?.loss, null);
  });

  it("lets CxO fund what-if and approve, and refuses the board", () => {
    const denied = approveQueue(ORG, "board_member", "Board", "q1");
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);

    const approved = approveQueue(ORG, "cxo", "Omar Al Mansoori, CEO", "q1");
    assert.equal(approved.ok, true);
    const live = presentWorkspace("cxo", getState(ORG));
    assert.equal(live.queue?.items.find((item) => item.id === "q1")?.state, "approved");
    assert.equal(live.queue?.canAct, true);

    const boardVerify = verifyFix(ORG, "board_member", "f1");
    assert.equal(boardVerify.ok, false);
    const analystVerify = verifyFix(ORG, "security_analyst", "f1");
    assert.equal(analystVerify.ok, true);

    const sneak = updateWhatIf(ORG, "board_member", { preset: "A" });
    assert.equal(sneak.ok, false);
    const funded = updateWhatIf(ORG, "cxo", { preset: "A" });
    assert.equal(funded.ok, true);
    const saved = saveScenario(ORG, "cxo");
    assert.equal(saved.ok, true);
    const cxo = presentWorkspace("cxo", getState(ORG));
    assert.equal(cxo.whatif?.saved.length, 1);
    assert.ok(cxo.whatif?.rows.some((row) => row.label.includes("expected loss")));
  });
});
