import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { app } from "../index.js";
import { query } from "../db.js";
import { ensureAuthSchema } from "./schema.js";
import { hashPassword } from "./passwords.js";
import { resetLoginThrottle } from "./loginThrottle.js";
import {
  decryptTotpSecret,
  generateTotpCode,
  generateTotpForStep,
  getTotpStep,
} from "./totp.js";

const MFA_USER_EMAIL = "mfa-test-user@ecc.test";
const MFA_USER_PASSWORD = "ValidMfaPassword123!";
const ORG_ID = "2accc7de-f693-4b19-8fe8-6db501be05e2";

function cookieFrom(raw: string | string[] | undefined): string {
  const line = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(line, "Expected session cookie to be present in response headers");
  return line.split(";")[0];
}

describe("ECC MFA Phase 2: Backend Authentication Flow & State Machine", () => {
  let userAccountId = "";
  let userUserId = "";
  let activeSessionCookie = "";
  let currentBase32Secret = "";
  let issuedBackupCodes: string[] = [];

  before(async () => {
    // Set a known 32-byte hex encryption key for test execution
    process.env.MFA_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    await ensureAuthSchema();
    resetLoginThrottle();

    // Clean up any previous test artifacts for this email
    await query(`DELETE FROM users WHERE lower(email) = lower($1)`, [MFA_USER_EMAIL]);
    await query(`DELETE FROM auth_accounts WHERE lower(email) = lower($1)`, [MFA_USER_EMAIL]);

    // Create fresh test user
    const passwordHash = await hashPassword(MFA_USER_PASSWORD);
    const userRes = await query<{ user_id: string }>(
      `INSERT INTO users (org_id, first_name, last_name, email)
       VALUES ($1, 'MFA', 'Tester', $2) RETURNING user_id`,
      [ORG_ID, MFA_USER_EMAIL],
    );
    userUserId = userRes.rows[0].user_id;

    const accountRes = await query<{ account_id: string }>(
      `INSERT INTO auth_accounts (email, password_hash, first_name, last_name, mfa_enabled)
       VALUES ($1, $2, 'MFA', 'Tester', false) RETURNING account_id`,
      [MFA_USER_EMAIL, passwordHash],
    );
    userAccountId = accountRes.rows[0].account_id;

    // Assign active membership
    await query(
      `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
       VALUES ($1, $2, $3, 'ciso', 'active')`,
      [userAccountId, ORG_ID, userUserId],
    );
  });

  describe("1. Password Authentication without MFA Enabled", () => {
    it("rejects wrong passwords with uniform 401 error (no state leakage)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: "IncorrectPassword123!" },
      });
      assert.equal(res.statusCode, 401);
      const json = res.json() as { error: { code: string; message: string } };
      assert.equal(json.error.code, "unauthorized");
      assert.equal(res.headers["set-cookie"], undefined);
    });

    it("logs in successfully and returns session cookie directly when MFA is disabled", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      assert.equal(res.statusCode, 200);
      const json = res.json() as { user: { email: string; role: string }; mfaRequired?: boolean };
      assert.equal(json.mfaRequired, undefined);
      assert.equal(json.user.email, MFA_USER_EMAIL);

      // Save cookie for authenticated MFA management endpoints
      activeSessionCookie = cookieFrom(res.headers["set-cookie"]);
      assert.ok(activeSessionCookie.includes("ecc_session="));
    });
  });

  describe("2. MFA Setup and Enrollment Flow", () => {
    it("rejects unauthenticated MFA setup calls", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/setup",
        body: { password: MFA_USER_PASSWORD },
      });
      assert.equal(res.statusCode, 401);
    });

    it("rejects MFA setup if password reauthentication fails", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/setup",
        headers: { cookie: activeSessionCookie },
        body: { password: "WrongReauthPassword" },
      });
      assert.equal(res.statusCode, 401);
      const json = res.json() as { error: { message: string } };
      assert.match(json.error.message, /Wrong password/i);
    });

    it("starts enrollment, generates encrypted secret, and returns provisioning URI", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/setup",
        headers: { cookie: activeSessionCookie },
        body: { password: MFA_USER_PASSWORD },
      });
      assert.equal(res.statusCode, 200);
      const json = res.json() as {
        provisioningUri: string;
        manualSecret: string;
        expiresAt: string;
      };
      assert.ok(json.provisioningUri.startsWith("otpauth://totp/"));
      assert.ok(json.manualSecret.length >= 16);
      currentBase32Secret = json.manualSecret;

      // Verify MFA is NOT enabled yet on the account record
      const { rows } = await query<{ mfa_enabled: boolean }>(
        `SELECT mfa_enabled FROM auth_accounts WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(rows[0].mfa_enabled, false);

      // Verify pending enrollment record exists in database
      const { rows: pending } = await query<{ account_id: string }>(
        `SELECT account_id FROM auth_mfa_pending_enrollments WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(pending.length, 1);
    });

    it("rejects confirmation if an invalid 6-digit TOTP code is submitted", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/confirm-setup",
        headers: { cookie: activeSessionCookie },
        body: { code: "000000" },
      });
      assert.equal(res.statusCode, 400);

      // Still disabled
      const { rows } = await query<{ mfa_enabled: boolean }>(
        `SELECT mfa_enabled FROM auth_accounts WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(rows[0].mfa_enabled, false);
    });

    it("confirms enrollment with valid TOTP code, enables MFA, and returns recovery codes", async () => {
      const validCode = generateTotpCode(currentBase32Secret);
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/confirm-setup",
        headers: { cookie: activeSessionCookie },
        body: { code: validCode },
      });
      assert.equal(res.statusCode, 200);
      const json = res.json() as { ok: boolean; backupCodes: string[] };
      assert.equal(json.ok, true);
      assert.equal(json.backupCodes.length, 8);
      issuedBackupCodes = json.backupCodes;

      // Verify MFA is now officially enabled on the account
      const { rows } = await query<{ mfa_enabled: boolean; backup_codes_hashes: string[] }>(
        `SELECT mfa_enabled, backup_codes_hashes FROM auth_accounts WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(rows[0].mfa_enabled, true);
      assert.equal(rows[0].backup_codes_hashes.length, 8);

      // Verify pending enrollment row was cleaned up
      const { rows: pending } = await query(
        `SELECT account_id FROM auth_mfa_pending_enrollments WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(pending.length, 0);
    });

    it("reports mfaEnabled: true via GET /api/ecc/auth/mfa/status", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/ecc/auth/mfa/status",
        headers: { cookie: activeSessionCookie },
      });
      assert.equal(res.statusCode, 200);
      const json = res.json() as { mfaEnabled: boolean; enrolledAt: string | null };
      assert.equal(json.mfaEnabled, true);
      assert.ok(json.enrolledAt);
    });
  });

  describe("3. Login Interception for MFA-Enabled Account", () => {
    let capturedMfaTicket = "";

    it("intercepts login with valid password and returns MFA challenge ticket without session cookie", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      assert.equal(res.statusCode, 200);
      const json = res.json() as { mfaRequired: boolean; mfaTicket: string; expiresAt: string };
      assert.equal(json.mfaRequired, true);
      assert.ok(json.mfaTicket);
      capturedMfaTicket = json.mfaTicket;

      // CRITICAL SECURITY ASSERTION: No session cookie issued!
      assert.equal(res.headers["set-cookie"], undefined);
    });

    it("rejects verification with wrong code and tracks attempt count", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket: capturedMfaTicket, code: "999999" },
      });
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers["set-cookie"], undefined);

      // Verify attempt count in DB
      const { rows } = await query<{ attempts: number }>(
        `SELECT attempts FROM auth_mfa_challenges WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userAccountId],
      );
      assert.equal(rows[0].attempts, 1);
    });

    it("locks the challenge after 5 failed attempts", async () => {
      // Exhaust remaining 4 attempts
      for (let i = 0; i < 4; i++) {
        await app.inject({
          method: "POST",
          url: "/api/ecc/auth/mfa/verify",
          body: { mfaTicket: capturedMfaTicket, code: "999999" },
        });
      }

      // 6th attempt must be rejected as exhausted
      const res = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket: capturedMfaTicket, code: "123456" },
      });
      assert.equal(res.statusCode, 401);
      const json = res.json() as { error: { code: string } };
      assert.equal(json.error.code, "challenge_exhausted");
    });
  });

  describe("4. Replay Prevention & Single-Use Challenge Verification", () => {
    let freshTicket = "";
    let validCode = "";

    it("completes MFA verification with valid TOTP code and issues session cookie", async () => {
      // Step 1: Login to get a fresh challenge
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const loginJson = loginRes.json() as { mfaTicket: string };
      freshTicket = loginJson.mfaTicket;

      // Step 2: Generate current valid TOTP code
      validCode = generateTotpCode(currentBase32Secret);

      // Step 3: Verify challenge
      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket: freshTicket, code: validCode },
      });
      assert.equal(verifyRes.statusCode, 200);
      assert.ok(verifyRes.headers["set-cookie"]);

      // Verify challenge is marked consumed in DB
      const { rows } = await query<{ consumed_at: Date | null }>(
        `SELECT consumed_at FROM auth_mfa_challenges WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userAccountId],
      );
      assert.ok(rows[0].consumed_at != null);

      // Verify challenge cannot be reused
      const reuseRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket: freshTicket, code: validCode },
      });
      assert.equal(reuseRes.statusCode, 401);
    });

    it("rejects replayed TOTP code within the same or earlier time step", async () => {
      // Step 1: Get another fresh challenge ticket
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const loginJson = loginRes.json() as { mfaTicket: string };
      const secondTicket = loginJson.mfaTicket;

      // Re-use the EXACT SAME valid code that was just accepted
      const replayRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket: secondTicket, code: validCode },
      });
      assert.equal(replayRes.statusCode, 401);
      const json = replayRes.json() as { error: { code: string } };
      assert.equal(json.error.code, "code_replayed");

      // Also verify historical step is rejected
      const loginRes2 = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const thirdTicket = (loginRes2.json() as { mfaTicket: string }).mfaTicket;
      const historicalCode = generateTotpForStep(currentBase32Secret, 1);
      const historicalRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket: thirdTicket, code: historicalCode },
      });
      assert.equal(historicalRes.statusCode, 401);
    });

    it("prevents concurrent requests from consuming the same challenge twice", async () => {
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const ticket = (loginRes.json() as { mfaTicket: string }).mfaTicket;

      // Use a valid recovery code for race condition test
      const testCode = issuedBackupCodes[7]; // use last backup code

      const [res1, res2] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/ecc/auth/mfa/verify",
          body: { mfaTicket: ticket, code: testCode },
        }),
        app.inject({
          method: "POST",
          url: "/api/ecc/auth/mfa/verify",
          body: { mfaTicket: ticket, code: testCode },
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      assert.deepEqual(statuses, [200, 401]);
    });
  });

  describe("5. Emergency Recovery Code Verification", () => {
    it("authenticates via a single-use backup recovery code and consumes it", async () => {
      // Login to get challenge
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const { mfaTicket } = loginRes.json() as { mfaTicket: string };

      // Use the first issued recovery code
      const recoveryCode = issuedBackupCodes[0];
      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket, code: recoveryCode },
      });
      assert.equal(verifyRes.statusCode, 200);
      const json = verifyRes.json() as { usedRecoveryCode: boolean };
      assert.equal(json.usedRecoveryCode, true);
      assert.ok(verifyRes.headers["set-cookie"]);

      // Verify that this recovery code was consumed from the DB array (6 remaining because code 7 was consumed in race test)
      const { rows } = await query<{ backup_codes_hashes: string[] }>(
        `SELECT backup_codes_hashes FROM auth_accounts WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(rows[0].backup_codes_hashes.length, 6);

      // Verify reusing the same recovery code on a new challenge fails
      const loginRes2 = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const { mfaTicket: ticket2 } = loginRes2.json() as { mfaTicket: string };

      const reuseRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket: ticket2, code: recoveryCode },
      });
      assert.equal(reuseRes.statusCode, 401);
    });
  });

  describe("6. Recovery Code Regeneration", () => {
    it("regenerates recovery codes when authenticated with password and valid TOTP code", async () => {
      // Get fresh session cookie using recovery code 1
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const { mfaTicket } = loginRes.json() as { mfaTicket: string };
      const recoveryCode = issuedBackupCodes[1];
      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket, code: recoveryCode },
      });
      const sessionCookie = cookieFrom(verifyRes.headers["set-cookie"]);

      // Regenerate using password and a valid current TOTP code
      const validCode = generateTotpCode(currentBase32Secret);

      const regenRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/regenerate-recovery-codes",
        headers: { cookie: sessionCookie },
        body: { password: MFA_USER_PASSWORD, code: validCode },
      });
      assert.equal(regenRes.statusCode, 200);
      const json = regenRes.json() as { ok: boolean; backupCodes: string[] };
      assert.equal(json.ok, true);
      assert.equal(json.backupCodes.length, 8);
      issuedBackupCodes = json.backupCodes; // save newly regenerated codes

      // 8 new codes in DB
      const { rows } = await query<{ backup_codes_hashes: string[] }>(
        `SELECT backup_codes_hashes FROM auth_accounts WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(rows[0].backup_codes_hashes.length, 8);
    });
  });

  describe("7. Disabling MFA", () => {
    it("disables MFA when provided with correct password and valid TOTP code", async () => {
      // Get session using newly regenerated recovery code 0
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      const { mfaTicket } = loginRes.json() as { mfaTicket: string };
      const recoveryCode = issuedBackupCodes[0];

      const verifyRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/verify",
        body: { mfaTicket, code: recoveryCode },
      });
      const sessionCookie = cookieFrom(verifyRes.headers["set-cookie"]);

      // Disable MFA with password and current TOTP code
      const disableCode = generateTotpCode(currentBase32Secret);
      const disableRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/mfa/disable",
        headers: { cookie: sessionCookie },
        body: { password: MFA_USER_PASSWORD, code: disableCode },
      });
      assert.equal(disableRes.statusCode, 200);

      // Verify DB record has mfa_enabled = false
      const { rows } = await query<{ mfa_enabled: boolean; totp_secret_encrypted: string | null }>(
        `SELECT mfa_enabled, totp_secret_encrypted FROM auth_accounts WHERE account_id = $1`,
        [userAccountId],
      );
      assert.equal(rows[0].mfa_enabled, false);
      assert.equal(rows[0].totp_secret_encrypted, null);

      // Subsequent login now goes straight through without requiring MFA challenge!
      const directLoginRes = await app.inject({
        method: "POST",
        url: "/api/ecc/auth/login",
        body: { email: MFA_USER_EMAIL, password: MFA_USER_PASSWORD },
      });
      assert.equal(directLoginRes.statusCode, 200);
      const directJson = directLoginRes.json() as { user: { email: string }; mfaRequired?: boolean };
      assert.equal(directJson.mfaRequired, undefined);
      assert.ok(directLoginRes.headers["set-cookie"]);
    });
  });
});
