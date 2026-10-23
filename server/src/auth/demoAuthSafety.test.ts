import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoHeaderAuthEnabled, isPublicEccPath } from "../middleware/tenant.js";
import { app } from "../index.js";

describe("Production Safety & Demo Authentication Isolation", () => {
  const originalEnv = { ...process.env };

  function restoreEnv() {
    process.env = { ...originalEnv };
  }

  describe("1. demoHeaderAuthEnabled Environment Combinations", () => {
    it("strictly disables demo headers in production even if DEMO_AUTH is explicitly true", () => {
      try {
        process.env.NODE_ENV = "production";
        process.env.DEMO_AUTH = "true";
        assert.equal(demoHeaderAuthEnabled(), false);

        process.env.DEMO_AUTH = "1";
        assert.equal(demoHeaderAuthEnabled(), false);

        process.env.DEMO_AUTH = "TRUE";
        assert.equal(demoHeaderAuthEnabled(), false);

        delete process.env.DEMO_AUTH;
        assert.equal(demoHeaderAuthEnabled(), false);
      } finally {
        restoreEnv();
      }
    });

    it("requires exact DEMO_AUTH=true in non-production environments", () => {
      try {
        process.env.NODE_ENV = "development";
        process.env.DEMO_AUTH = "true";
        assert.equal(demoHeaderAuthEnabled(), true);

        process.env.DEMO_AUTH = "false";
        assert.equal(demoHeaderAuthEnabled(), false);

        process.env.DEMO_AUTH = "1";
        assert.equal(demoHeaderAuthEnabled(), false);

        process.env.DEMO_AUTH = "TRUE";
        assert.equal(demoHeaderAuthEnabled(), false);

        process.env.DEMO_AUTH = "yes";
        assert.equal(demoHeaderAuthEnabled(), false);

        delete process.env.DEMO_AUTH;
        assert.equal(demoHeaderAuthEnabled(), false);
      } finally {
        restoreEnv();
      }
    });
  });

  describe("2. Public vs. Protected Path Whitelist", () => {
    it("allows only designated public endpoints without authentication", () => {
      assert.equal(isPublicEccPath("/health"), true);
      assert.equal(isPublicEccPath("/api/ecc/auth/login"), true);
      assert.equal(isPublicEccPath("/api/ecc/auth/logout"), true);
      assert.equal(isPublicEccPath("/api/ecc/auth/mfa/verify"), true);
    });

    it("strictly requires session authentication for MFA management and tenant operations", () => {
      assert.equal(isPublicEccPath("/api/ecc/auth/mfa/status"), false);
      assert.equal(isPublicEccPath("/api/ecc/auth/mfa/setup"), false);
      assert.equal(isPublicEccPath("/api/ecc/auth/mfa/confirm-setup"), false);
      assert.equal(isPublicEccPath("/api/ecc/auth/mfa/disable"), false);
      assert.equal(isPublicEccPath("/api/ecc/auth/mfa/regenerate-recovery-codes"), false);
      assert.equal(isPublicEccPath("/api/ecc/auth/switch-org"), false);
    });
  });

  describe("3. HTTP Enforcement in Production Mode", () => {
    it("rejects demo headers with 401 when NODE_ENV is production", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDemoAuth = process.env.DEMO_AUTH;
      try {
        process.env.NODE_ENV = "production";
        process.env.DEMO_AUTH = "true";

        const res = await app.inject({
          method: "GET",
          url: "/api/ecc/me",
          headers: {
            "x-org-id": "2accc7de-f693-4b19-8fe8-6db501be05e2",
            "x-user-id": "11111111-1111-4111-8111-111111111111",
          },
        });

        assert.equal(res.statusCode, 401);
        const json = res.json() as { error: { code: string; message: string } };
        assert.equal(json.error.code, "unauthorized");
        assert.equal(json.error.message, "Sign in required.");
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        process.env.DEMO_AUTH = prevDemoAuth;
      }
    });

    it("rejects MFA setup attempt via demo headers in production", async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevDemoAuth = process.env.DEMO_AUTH;
      try {
        process.env.NODE_ENV = "production";
        process.env.DEMO_AUTH = "true";

        const res = await app.inject({
          method: "POST",
          url: "/api/ecc/auth/mfa/setup",
          headers: {
            "x-org-id": "2accc7de-f693-4b19-8fe8-6db501be05e2",
            "x-user-id": "11111111-1111-4111-8111-111111111111",
          },
          body: { password: "SomePassword123!" },
        });

        assert.equal(res.statusCode, 401);
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        process.env.DEMO_AUTH = prevDemoAuth;
      }
    });
  });
});
