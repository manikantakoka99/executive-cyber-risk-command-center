import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  approveAppetite,
  approvePolicy,
  editPolicy,
  listPolicyBundle,
  proposeAppetite,
  proposePolicy,
  resetPolicyStoreForTests,
  withdrawPolicy,
} from "./policyStore.js";

const CISO = { userId: "c1500001-a090-41a0-8ecc-000000000001", name: "Layla Al Hashimi, CISO" };
const BOARD = { userId: "c1500001-a090-41a0-8ecc-000000000006", name: "Hessa Al Ketbi, Board Member" };
const CXO = { userId: "c1500001-a090-41a0-8ecc-000000000002", name: "Omar Al Mansoori, CEO" };

describe("policy approval rule (Board + CxO; no self-approve; immutable)", () => {
  beforeEach(() => {
    resetPolicyStoreForTests();
  });

  it("board approve ok", () => {
    const org = "org-policy-board";
    const proposed = proposePolicy(org, "ciso", CISO, { notes: "Board path", bandCriticalMin: 68 });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;

    const board = approvePolicy(org, "board_member", BOARD, proposed.policy.policyId);
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.equal(board.policy.status, "approved");
    assert.equal(board.policy.approvedByUserId, BOARD.userId);
    assert.equal(listPolicyBundle(org).active?.policyId, proposed.policy.policyId);
  });

  it("CxO approve ok", () => {
    const org = "org-policy-cxo";
    const proposed = proposePolicy(org, "ciso", CISO, { notes: "CxO path", bandHighMin: 56 });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;

    const cxo = approvePolicy(org, "cxo", CXO, proposed.policy.policyId);
    assert.equal(cxo.ok, true);
    if (!cxo.ok) return;
    assert.equal(cxo.policy.status, "approved");
    assert.equal(cxo.policy.approvedByUserId, CXO.userId);
  });

  it("CISO self-approve 403", () => {
    const org = "org-policy-self";
    const proposed = proposePolicy(org, "ciso", CISO, { notes: "Self-approve attempt" });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;

    // CISO lacks approve_policy → 403
    const asCiso = approvePolicy(org, "ciso", CISO, proposed.policy.policyId);
    assert.equal(asCiso.ok, false);
    if (asCiso.ok) return;
    assert.equal(asCiso.status, 403);

    // Same userId as proposer cannot approve even when calling with an approve role
    const sameUser = approvePolicy(
      org,
      "board_member",
      { userId: CISO.userId, name: "Impersonated" },
      proposed.policy.policyId,
    );
    assert.equal(sameUser.ok, false);
    if (sameUser.ok) return;
    assert.equal(sameUser.status, 403);
    assert.match(sameUser.message, /proposer cannot approve/i);
  });

  it("edit approved version rejected", () => {
    const org = "org-policy-immutable";
    const proposed = proposePolicy(org, "ciso", CISO, { notes: "Will lock" });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;

    // Draft edit is allowed
    const draftEdit = editPolicy(org, "ciso", CISO, proposed.policy.policyId, {
      notes: "Draft tweak",
      bandCriticalMin: 72,
    });
    assert.equal(draftEdit.ok, true);

    const locked = approvePolicy(org, "board_member", BOARD, proposed.policy.policyId);
    assert.equal(locked.ok, true);
    if (!locked.ok) return;

    const editApproved = editPolicy(org, "ciso", CISO, proposed.policy.policyId, {
      notes: "Illegal mutation",
      bandCriticalMin: 80,
    });
    assert.equal(editApproved.ok, false);
    if (editApproved.ok) return;
    assert.equal(editApproved.status, 400);
    assert.match(editApproved.message, /immutable|locked/i);

    // Re-approve → 409 already approved and locked
    const reApprove = approvePolicy(org, "cxo", CXO, proposed.policy.policyId);
    assert.equal(reApprove.ok, false);
    if (reApprove.ok) return;
    assert.equal(reApprove.status, 409);
    assert.match(reApprove.message, /already approved and locked/i);
  });

  it("rejects empty proposals and out-of-order bands; allows withdraw/replace draft", () => {
    const org = "org-policy-draft";
    const empty = proposePolicy(org, "ciso", CISO, {});
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.equal(empty.status, 400);

    const badBands = proposePolicy(org, "ciso", CISO, {
      notes: "Bad bands",
      bandMediumMin: 70,
      bandHighMin: 55,
      bandCriticalMin: 40,
    });
    assert.equal(badBands.ok, false);
    if (badBands.ok) return;
    assert.equal(badBands.status, 400);

    const first = proposePolicy(org, "ciso", CISO, { notes: "First draft", bandCriticalMin: 71 });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const blocked = proposePolicy(org, "ciso", CISO, { notes: "Second without replace" });
    assert.equal(blocked.ok, false);

    const replaced = proposePolicy(org, "ciso", CISO, {
      notes: "Replacement draft",
      bandHighMin: 56,
      replaceDraft: true,
    });
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    assert.notEqual(replaced.policy.policyId, first.policy.policyId);

    const withdrawn = withdrawPolicy(org, "ciso", CISO, replaced.policy.policyId);
    assert.equal(withdrawn.ok, true);
    assert.equal(listPolicyBundle(org).versions.some((p) => p.status === "draft"), false);
  });

  it("locks appetite with proposer ≠ approver (Board or CxO)", () => {
    const org = "org-appetite";
    const draft = proposeAppetite(org, "ciso", CISO, { domainCode: "soc", maxScore: 42 });
    assert.equal(draft.ok, true);
    if (!draft.ok) return;

    const denied = approveAppetite(org, "ciso", CISO, draft.appetite.appetiteId);
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.status, 403);

    const ok = approveAppetite(org, "cxo", CXO, draft.appetite.appetiteId);
    assert.equal(ok.ok, true);
  });
});
