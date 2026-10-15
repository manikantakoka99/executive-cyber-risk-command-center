import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approveAppetite,
  approvePolicy,
  listPolicyBundle,
  proposeAppetite,
  proposePolicy,
} from "./policyStore.js";

const ORG = "org-policy-test";

describe("policy / appetite propose-approve lock", () => {
  it("lets CISO propose and Board approve; blocks self-approve and CISO approve", () => {
    const proposed = proposePolicy(
      ORG,
      "ciso",
      { userId: "ciso-1", name: "CISO" },
      { notes: "Tighten critical band", bandCriticalMin: 68 },
    );
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;

    const self = approvePolicy(ORG, "ciso", { userId: "ciso-1", name: "CISO" }, proposed.policy.policyId);
    assert.equal(self.ok, false);

    const board = approvePolicy(
      ORG,
      "board_member",
      { userId: "board-1", name: "Board" },
      proposed.policy.policyId,
    );
    assert.equal(board.ok, true);
    if (!board.ok) return;
    assert.equal(board.policy.status, "approved");

    const again = approvePolicy(
      ORG,
      "board_member",
      { userId: "board-1", name: "Board" },
      proposed.policy.policyId,
    );
    assert.equal(again.ok, false);

    const bundle = listPolicyBundle(ORG);
    assert.equal(bundle.active?.policyId, proposed.policy.policyId);
  });

  it("locks appetite with proposer ≠ approver", () => {
    const draft = proposeAppetite(
      ORG,
      "ciso",
      { userId: "ciso-1", name: "CISO" },
      { domainCode: "soc", maxScore: 42 },
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const denied = approveAppetite(ORG, "ciso", { userId: "ciso-1", name: "CISO" }, draft.appetite.appetiteId);
    assert.equal(denied.ok, false);
    const ok = approveAppetite(
      ORG,
      "board_member",
      { userId: "board-1", name: "Board" },
      draft.appetite.appetiteId,
    );
    assert.equal(ok.ok, true);
  });
});
