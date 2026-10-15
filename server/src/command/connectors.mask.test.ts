import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getConnectorHealth } from "./workspaceExtras.js";

describe("connector credential masking", () => {
  it("never returns credential references or secret:// URIs", async () => {
    const health = await getConnectorHealth(
      "2accc7de-f693-4b19-8fe8-6db501be05e2",
      "ciso",
    );
    assert.ok(health);
    assert.ok(health.connectors.length > 0);
    const blob = JSON.stringify(health);
    assert.doesNotMatch(blob, /secret:\/\//i);
    assert.doesNotMatch(blob, /vault:secret/i);
    assert.doesNotMatch(blob, /credentialsReference/i);
    for (const row of health.connectors as Array<Record<string, unknown>>) {
      assert.equal("credentialsReference" in row, false);
      assert.equal(typeof row.credentialsConfigured, "boolean");
    }
  });
});
