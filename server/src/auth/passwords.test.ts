import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, hashSecret, passwordAccepted, verifyPassword } from "./passwords.js";

describe("password hashing", () => {
  it("stores a bcrypt hash, never the plaintext", async () => {
    const password = "local-demo-password";
    const hash = await hashPassword(password);
    assert.notEqual(hash, password);
    assert.match(hash, /^\$2[aby]\$/);
    assert.equal(hash.includes(password), false);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
  });

  it("rejects short passwords and hashes invite tokens", () => {
    assert.equal(passwordAccepted("short"), "Use at least 10 characters.");
    assert.equal(passwordAccepted("long-enough-password"), null);
    const token = "invite-token-value";
    assert.equal(hashSecret(token), hashSecret(token));
    assert.notEqual(hashSecret(token), token);
    assert.equal(hashSecret(token).length, 64);
  });
});
