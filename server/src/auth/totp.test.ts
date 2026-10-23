import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodeBase32,
  decryptTotpSecret,
  encodeBase32,
  encryptTotpSecret,
  generateMfaChallengeTicket,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpForStep,
  generateTotpSecret,
  generateTotpUri,
  getEncryptionKey,
  getTotpStep,
  hashMfaChallengeTicket,
  hashRecoveryCode,
  isTotpStepReplayed,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "./totp.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "./schema.js";

// RFC 6238 Appendix B test vector seed: "12345678901234567890" (20 bytes)
const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const TEST_AES_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
// Equivalent 32-byte key in Base64 (44 chars)
const TEST_AES_KEY_B64 = Buffer.from(TEST_AES_KEY_HEX, "hex").toString("base64");

describe("Google Authenticator TOTP Foundation & Hardening (Phase 1)", () => {
  describe("Base32 Encoding and Decoding (RFC 4648)", () => {
    it("round-trips arbitrary buffers through Base32", () => {
      const buffer = Buffer.from("Hello ECC Security Hardened World!", "utf8");
      const encoded = encodeBase32(buffer);
      const decoded = decodeBase32(encoded);
      assert.deepEqual(decoded, buffer);
    });

    it("handles whitespace, dashes, and lowercase in Base32 input", () => {
      const buffer = Buffer.from("TestSecret", "utf8");
      const encoded = encodeBase32(buffer);
      const formatted = `${encoded.slice(0, 4).toLowerCase()}-${encoded.slice(4, 8)} ${encoded.slice(8)}`;
      const decoded = decodeBase32(formatted);
      assert.deepEqual(decoded, buffer);
    });

    it("correctly handles and strips RFC 4648 trailing padding characters (=)", () => {
      const buffer = Buffer.from("SecureData", "utf8");
      const encoded = encodeBase32(buffer);
      const padded = `${encoded}====`;
      const decoded = decodeBase32(padded);
      assert.deepEqual(decoded, buffer);
    });

    it("rejects invalid Base32 characters safely", () => {
      assert.throws(() => decodeBase32("INVALID189!"), /Invalid Base32 character/);
    });
  });

  describe("Secret Generation & Bounds", () => {
    it("generates valid 32-character Base32 secrets for default 20 bytes", () => {
      const secret = generateTotpSecret(20);
      assert.equal(secret.length, 32);
      assert.match(secret, /^[A-Z2-7]{32}$/);
      const decoded = decodeBase32(secret);
      assert.equal(decoded.length, 20);
    });

    it("generates distinct secrets on successive calls", () => {
      const secret1 = generateTotpSecret();
      const secret2 = generateTotpSecret();
      assert.notEqual(secret1, secret2);
    });

    it("enforces minimum entropy bounds (rejects byteLength < 16)", () => {
      assert.throws(() => generateTotpSecret(15), /at least 16 bytes/);
    });
  });

  describe("RFC 6238 Deterministic Test Vectors (HMAC-SHA1)", () => {
    // Official test vector values from RFC 6238 Appendix B for SHA1 (6-digit)
    const vectors = [
      { timeSec: 59, step: 1, expected: "287082" },
      { timeSec: 1111111109, step: 37037036, expected: "081804" },
      { timeSec: 1111111111, step: 37037037, expected: "050471" },
      { timeSec: 1234567890, step: 41152263, expected: "005924" },
      { timeSec: 2000000000, step: 66666666, expected: "279037" },
    ];

    for (const v of vectors) {
      it(`matches RFC 6238 vector for time ${v.timeSec}s (step ${v.step}) -> ${v.expected}`, () => {
        const generated = generateTotpCode(RFC_SECRET_BASE32, v.timeSec * 1000);
        assert.equal(generated, v.expected);

        const byStep = generateTotpForStep(RFC_SECRET_BASE32, v.step);
        assert.equal(byStep, v.expected);
      });
    }
  });

  describe("TOTP Verification, Clock Skew, and Malformed Input Rejection", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const fixedTime = 1700000000000; // Deterministic epoch ms
    const currentStep = getTotpStep(fixedTime);

    it("accepts a valid code for current time step", () => {
      const code = generateTotpCode(secret, fixedTime);
      const result = verifyTotpCode({ secret, code, timestampMs: fixedTime, toleranceSteps: 1 });
      assert.equal(result.valid, true);
      assert.equal(result.matchedStep, currentStep);
    });

    it("accepts a code from 1 step in the past (clock skew = 1)", () => {
      const pastTime = fixedTime - 30_000;
      const pastCode = generateTotpCode(secret, pastTime);
      const result = verifyTotpCode({ secret, code: pastCode, timestampMs: fixedTime, toleranceSteps: 1 });
      assert.equal(result.valid, true);
      assert.equal(result.matchedStep, currentStep - 1);
    });

    it("accepts a code from 1 step in the future (clock skew = 1)", () => {
      const futureTime = fixedTime + 30_000;
      const futureCode = generateTotpCode(secret, futureTime);
      const result = verifyTotpCode({ secret, code: futureCode, timestampMs: fixedTime, toleranceSteps: 1 });
      assert.equal(result.valid, true);
      assert.equal(result.matchedStep, currentStep + 1);
    });

    it("strictly bounds clock skew tolerance (caps at max 2 steps to protect against brute force)", () => {
      // 3 steps away must be rejected even if an excessively large tolerance is requested
      const farFutureTime = fixedTime + 90_000;
      const farFutureCode = generateTotpCode(secret, farFutureTime);
      const result = verifyTotpCode({ secret, code: farFutureCode, timestampMs: fixedTime, toleranceSteps: 10 });
      assert.equal(result.valid, false);
    });

    it("rejects codes with whitespace or newline variants without partial match", () => {
      const validCode = generateTotpCode(secret, fixedTime);
      assert.equal(verifyTotpCode({ secret, code: ` ${validCode}`, timestampMs: fixedTime }).valid, false);
      assert.equal(verifyTotpCode({ secret, code: `${validCode} `, timestampMs: fixedTime }).valid, false);
      assert.equal(verifyTotpCode({ secret, code: `${validCode}\n`, timestampMs: fixedTime }).valid, false);
      assert.equal(verifyTotpCode({ secret, code: validCode.slice(0, 5), timestampMs: fixedTime }).valid, false);
    });

    it("rejects non-numeric characters and empty inputs", () => {
      assert.equal(verifyTotpCode({ secret, code: "12345a", timestampMs: fixedTime }).valid, false);
      assert.equal(verifyTotpCode({ secret, code: "", timestampMs: fixedTime }).valid, false);
    });

    it("safely handles negative or invalid timestamps without throwing unhandled errors", () => {
      const result = verifyTotpCode({ secret, code: "123456", timestampMs: -1000 });
      assert.equal(result.valid, false);
    });
  });

  describe("Replay Prevention Checks", () => {
    it("flags previously accepted or older time steps as replayed", () => {
      const currentStep = 50000;
      assert.equal(isTotpStepReplayed(currentStep, 50000), true);
      assert.equal(isTotpStepReplayed(currentStep, 50001), true);
      assert.equal(isTotpStepReplayed(currentStep, BigInt(50000)), true);
    });

    it("allows newer, unconsumed time steps", () => {
      const currentStep = 50002;
      assert.equal(isTotpStepReplayed(currentStep, 50001), false);
      assert.equal(isTotpStepReplayed(currentStep, null), false);
      assert.equal(isTotpStepReplayed(currentStep, undefined), false);
    });
  });

  describe("Provisioning URI Format", () => {
    it("generates a standards-compliant otpauth:// URI with safe label encoding", () => {
      const uri = generateTotpUri({
        secret: "JBSWY3DPEHPK3PXP",
        email: "ciso+qa@aldhabi.ae",
        issuer: "Al Dhabi Bank ECC",
      });

      assert.ok(uri.startsWith("otpauth://totp/"));
      assert.ok(uri.includes("secret=JBSWY3DPEHPK3PXP"));
      assert.ok(uri.includes("issuer=Al+Dhabi+Bank+ECC"));
      assert.ok(uri.includes("algorithm=SHA1"));
      assert.ok(uri.includes("digits=6"));
      assert.ok(uri.includes("period=30"));
      assert.ok(uri.includes("ciso%2Bqa%40aldhabi.ae"));
    });

    it("rejects invalid emails or empty secrets", () => {
      assert.throws(
        () => generateTotpUri({ secret: "JBSWY3DPEHPK3PXP", email: "invalid-email" }),
        /valid account email/,
      );
      assert.throws(
        () => generateTotpUri({ secret: "short", email: "user@ecc.test" }),
        /valid Base32 secret/,
      );
    });
  });

  describe("AES-256-GCM Secret Encryption & Key Management", () => {
    it("encrypts and decrypts secrets using 64-character hex key", () => {
      const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      const encrypted = encryptTotpSecret(secret, TEST_AES_KEY_HEX);

      assert.ok(encrypted.ciphertextHex);
      assert.equal(encrypted.ivHex.length, 24); // 12 bytes * 2
      assert.equal(encrypted.tagHex.length, 32); // 16 bytes * 2

      const decrypted = decryptTotpSecret(encrypted, TEST_AES_KEY_HEX);
      assert.equal(decrypted, secret);
    });

    it("encrypts and decrypts secrets using 44-character Base64 key", () => {
      const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      const encrypted = encryptTotpSecret(secret, TEST_AES_KEY_B64);
      const decrypted = decryptTotpSecret(encrypted, TEST_AES_KEY_B64);
      assert.equal(decrypted, secret);
    });

    it("generates a fresh unpredictable IV for each encryption operation", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const enc1 = encryptTotpSecret(secret, TEST_AES_KEY_HEX);
      const enc2 = encryptTotpSecret(secret, TEST_AES_KEY_HEX);

      assert.notEqual(enc1.ivHex, enc2.ivHex);
      assert.notEqual(enc1.ciphertextHex, enc2.ciphertextHex);
    });

    it("rejects tampered ciphertext with safe error (no plaintext leakage)", () => {
      const encrypted = encryptTotpSecret("MYSECRET", TEST_AES_KEY_HEX);
      const tamperedHex =
        (encrypted.ciphertextHex[0] === "a" ? "b" : "a") + encrypted.ciphertextHex.slice(1);

      assert.throws(
        () => decryptTotpSecret({ ...encrypted, ciphertextHex: tamperedHex }, TEST_AES_KEY_HEX),
        /authentication tag mismatch/,
      );
    });

    it("rejects tampered authentication tags", () => {
      const encrypted = encryptTotpSecret("MYSECRET", TEST_AES_KEY_HEX);
      const tamperedTag = (encrypted.tagHex[0] === "0" ? "1" : "0") + encrypted.tagHex.slice(1);

      assert.throws(
        () => decryptTotpSecret({ ...encrypted, tagHex: tamperedTag }, TEST_AES_KEY_HEX),
        /authentication tag mismatch/,
      );
    });

    it("rejects malformed payload hex values", () => {
      const encrypted = encryptTotpSecret("MYSECRET", TEST_AES_KEY_HEX);
      assert.throws(
        () => decryptTotpSecret({ ...encrypted, ivHex: "not-hex-at-all" }, TEST_AES_KEY_HEX),
        /Malformed hexadecimal/,
      );
    });

    it("fails safely when key is invalid without exposing key contents in error", () => {
      assert.throws(() => getEncryptionKey("bad-key"), /Invalid MFA_ENCRYPTION_KEY/);
    });
  });

  describe("Ephemeral MFA Challenge Tickets", () => {
    it("generates 32-byte base64url challenge ticket and matching SHA-256 hash", () => {
      const { ticket, ticketHash } = generateMfaChallengeTicket();
      assert.ok(ticket.length >= 42); // 32 bytes in base64url is 43 chars
      assert.equal(ticketHash.length, 64);
      assert.equal(hashMfaChallengeTicket(ticket), ticketHash);
    });

    it("generates distinct challenge tickets on successive calls", () => {
      const t1 = generateMfaChallengeTicket();
      const t2 = generateMfaChallengeTicket();
      assert.notEqual(t1.ticket, t2.ticket);
      assert.notEqual(t1.ticketHash, t2.ticketHash);
    });
  });

  describe("Recovery Codes (64-bit Entropy & One-Time Consumption)", () => {
    it("generates 8 formatted plaintext codes (16 hex chars in 4 blocks) and hashes", () => {
      const bundle = generateRecoveryCodes(8);
      assert.equal(bundle.plaintextCodes.length, 8);
      assert.equal(bundle.hashedCodes.length, 8);

      for (let i = 0; i < 8; i++) {
        const plain = bundle.plaintextCodes[i];
        const hash = bundle.hashedCodes[i];
        assert.match(plain, /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
        assert.equal(hashRecoveryCode(plain), hash);
      }
    });

    it("verifies and consumes a recovery code for one-time use", () => {
      const bundle = generateRecoveryCodes(4);
      const codeToUse = bundle.plaintextCodes[1];

      const result = verifyAndConsumeRecoveryCode(codeToUse, bundle.hashedCodes);
      assert.equal(result.matched, true);
      assert.equal(result.remainingHashes.length, 3);
      assert.ok(!result.remainingHashes.includes(hashRecoveryCode(codeToUse)));

      // Reusing consumed code fails
      const reuseResult = verifyAndConsumeRecoveryCode(codeToUse, result.remainingHashes);
      assert.equal(reuseResult.matched, false);
      assert.equal(reuseResult.remainingHashes.length, 3);
    });

    it("handles whitespace, dashes, and case normalization during recovery verification", () => {
      const bundle = generateRecoveryCodes(2);
      const plain = bundle.plaintextCodes[0];
      const normalizedInput = `  ${plain.replace(/-/g, " ").toUpperCase()}  `;

      const result = verifyAndConsumeRecoveryCode(normalizedInput, bundle.hashedCodes);
      assert.equal(result.matched, true);
    });
  });

  describe("Database Migration Verification", () => {
    it("confirms 013_ecc_mfa_totp schema is applied without affecting existing accounts", async () => {
      await ensureAuthSchema();

      // Verify columns in auth_accounts
      const { rows: cols } = await query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'auth_accounts'
           AND column_name IN ('mfa_enabled', 'totp_secret_encrypted', 'totp_secret_iv', 'totp_secret_tag', 'mfa_enrolled_at', 'backup_codes_hashes', 'last_totp_timestamp')`,
      );
      assert.equal(cols.length, 7, "All 7 MFA columns must exist in auth_accounts");

      // Verify all existing accounts have mfa_enabled = false
      const { rows: mfaStatus } = await query<{ mfa_enabled: boolean }>(
        `SELECT mfa_enabled FROM auth_accounts WHERE mfa_enabled = true`,
      );
      assert.equal(mfaStatus.length, 0, "No account should have MFA enabled by default");

      // Verify auth_mfa_challenges table exists
      const { rows: tableCheck } = await query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_name = 'auth_mfa_challenges'`,
      );
      assert.equal(tableCheck.length, 1, "auth_mfa_challenges table must exist");
    });
  });
});
