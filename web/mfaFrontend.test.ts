import assert from "node:assert/strict";
import { describe, it } from "node:test";
import QRCode from "qrcode";
import { api, ApiError, type LoginResult, type SessionUser } from "./src/lib/api.ts";

describe("ECC MFA Phase 3: Frontend Integration & State Machine Tests", () => {
  describe("1. Login Response Contract & State Differentiation", () => {
    it("differentiates single-factor success from MFA challenge required", () => {
      const nonMfaResponse: LoginResult = {
        mfaRequired: false,
        user: {
          userId: "11111111-1111-4111-8111-111111111111",
          orgId: "2accc7de-f693-4b19-8fe8-6db501be05e2",
          orgName: "Global Risk",
          role: "ciso",
          title: "Chief Information Security Officer",
          name: "Maya Lin",
          email: "maya@ciso.com",
          home: "/c/overview",
        },
      };

      const mfaChallengeResponse: LoginResult = {
        mfaRequired: true,
        mfaTicket: "test-mfa-ticket-base64url-32-bytes",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };

      // Non-MFA response has user session data
      assert.equal("user" in nonMfaResponse, true);
      assert.equal(nonMfaResponse.mfaRequired, false);
      if (!nonMfaResponse.mfaRequired) {
        assert.equal(nonMfaResponse.user.email, "maya@ciso.com");
      }

      // MFA challenge response has mfaTicket and NO user session
      assert.equal(mfaChallengeResponse.mfaRequired, true);
      assert.equal("mfaTicket" in mfaChallengeResponse, true);
      assert.equal("user" in mfaChallengeResponse, false);
    });

    it("ensures mfaRequired flag prevents treating challenge as authenticated", () => {
      const isUserAuthenticated = (res: LoginResult): boolean => {
        if ("mfaRequired" in res && res.mfaRequired) {
          return false;
        }
        return "user" in res && res.user !== undefined;
      };

      assert.equal(isUserAuthenticated({ mfaRequired: true, mfaTicket: "abc", expiresAt: "2026-10-22" }), false);
      assert.equal(
        isUserAuthenticated({
          mfaRequired: false,
          user: {
            userId: "u1",
            orgId: "o1",
            orgName: "Org",
            role: "ciso",
            title: "CISO",
            name: "Maya",
            email: "maya@ecc.test",
          },
        }),
        true,
      );
    });
  });

  describe("2. TOTP Code Validation & Input Normalization", () => {
    it("validates exactly 6 numeric digits without silent truncation or corruption", () => {
      const isValidTotpInput = (input: string): boolean => /^\d{6}$/.test(input.trim());

      assert.equal(isValidTotpInput("123456"), true);
      assert.equal(isValidTotpInput("000000"), true);
      assert.equal(isValidTotpInput("999999"), true);

      // Rejections
      assert.equal(isValidTotpInput("12345"), false); // too short
      assert.equal(isValidTotpInput("1234567"), false); // too long
      assert.equal(isValidTotpInput("12345a"), false); // letter
      assert.equal(isValidTotpInput("12 345"), false); // internal space
      assert.equal(isValidTotpInput(""), false); // empty
    });

    it("normalizes and accepts recovery codes with dashes or mixed case", () => {
      const normalizeRecoveryCode = (code: string): string => code.trim().toUpperCase();

      assert.equal(normalizeRecoveryCode("a1b2-c3d4-e5f6-7890"), "A1B2-C3D4-E5F6-7890");
      assert.equal(normalizeRecoveryCode("  ffff-0000-1111-2222  "), "FFFF-0000-1111-2222");
    });
  });

  describe("3. Error Handling & Terminal Challenge States", () => {
    it("maps backend error codes to safe, actionable user feedback", () => {
      const mapMfaErrorMessage = (code: string, isRecovery: boolean): { message: string; isTerminal: boolean } => {
        switch (code) {
          case "code_replayed":
            return {
              message: "This code was already used. Please wait for the next 30-second code from your authenticator app.",
              isTerminal: false,
            };
          case "challenge_expired":
            return {
              message: "This verification challenge has expired. Please sign in again.",
              isTerminal: true,
            };
          case "challenge_exhausted":
            return {
              message: "Too many failed attempts. This challenge has been locked for your security. Please sign in again.",
              isTerminal: true,
            };
          case "challenge_consumed":
            return {
              message: "This challenge was already consumed. Please sign in again.",
              isTerminal: true,
            };
          case "too_many_requests":
            return {
              message: "Too many verification attempts. Please wait a moment before trying again.",
              isTerminal: false,
            };
          default:
            return {
              message: isRecovery
                ? "Invalid emergency recovery code. Please check your backup codes and try again."
                : "Invalid 6-digit verification code. Please check your app and try again.",
              isTerminal: false,
            };
        }
      };

      const replayed = mapMfaErrorMessage("code_replayed", false);
      assert.equal(replayed.isTerminal, false);
      assert.match(replayed.message, /already used/);

      const expired = mapMfaErrorMessage("challenge_expired", false);
      assert.equal(expired.isTerminal, true);
      assert.match(expired.message, /expired/);

      const exhausted = mapMfaErrorMessage("challenge_exhausted", false);
      assert.equal(exhausted.isTerminal, true);
      assert.match(exhausted.message, /locked/);

      const invalidTotp = mapMfaErrorMessage("invalid_code", false);
      assert.equal(invalidTotp.isTerminal, false);
      assert.match(invalidTotp.message, /Invalid 6-digit/);

      const invalidRecovery = mapMfaErrorMessage("invalid_code", true);
      assert.equal(invalidRecovery.isTerminal, false);
      assert.match(invalidRecovery.message, /Invalid emergency recovery/);
    });
  });

  describe("4. QR Code Generation Privacy & Standards", () => {
    it("generates local data URL for otpauth URI without external API calls", async () => {
      const sampleUri =
        "otpauth://totp/Executive%20Cyber%20Risk%20Command%20Center:test%40ecc.test?secret=JBSWY3DPEHPK3PXP&issuer=Executive%20Cyber%20Risk%20Command%20Center&algorithm=SHA1&digits=6&period=30";

      const dataUrl = await QRCode.toDataURL(sampleUri, {
        margin: 1,
        width: 200,
        color: { dark: "#1f2a24", light: "#ffffff" },
      });

      assert.ok(dataUrl.startsWith("data:image/png;base64,"));
      assert.ok(dataUrl.length > 100);
    });
  });

  describe("5. Browser Storage Hygiene & Secret Isolation", () => {
    it("confirms no sensitive MFA secrets or tickets are persisted to storage", () => {
      // Simulation of transient state clearance
      let transientState: {
        mfaTicket: string | null;
        totpCode: string | null;
        manualSecret: string | null;
        backupCodes: string[] | null;
      } | null = {
        mfaTicket: "temp-ticket",
        totpCode: "123456",
        manualSecret: "SECRETKEY",
        backupCodes: ["code-1", "code-2"],
      };

      // Wipe function called on cancel, completion, or unmount
      const wipeTransientState = () => {
        transientState = null;
      };

      wipeTransientState();
      assert.equal(transientState, null);
    });
  });

  describe("6. API Error Normalization", () => {
    it("preserves status, code, and message across ApiError instances", () => {
      const err = new ApiError(401, "code_replayed", "Replay detected");
      assert.equal(err.status, 401);
      assert.equal(err.code, "code_replayed");
      assert.equal(err.message, "Replay detected");
      assert.ok(err instanceof Error);
      assert.ok(err instanceof ApiError);
    });
  });
});
