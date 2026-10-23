import { query } from "../db.js";
import { canonicalRole, homeFor, isRoleCode, ROLE_LABEL, type RoleCode } from "../command/rbac.js";
import { findPersona } from "../command/personas.js";
import { deliverMail } from "./outboundMail.js";
import { hashPassword, hashSecret, newSecret, passwordAccepted, verifyPasswordOrDummy } from "./passwords.js";
import { ensureAuthSchema } from "./schema.js";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateMfaChallengeTicket,
  generateRecoveryCodes,
  generateTotpSecret,
  generateTotpUri,
  hashMfaChallengeTicket,
  isTotpStepReplayed,
  verifyAndConsumeRecoveryCode,
  verifyTotpCode,
} from "./totp.js";

export const SESSION_COOKIE = "ecc_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;

export interface Membership {
  orgId: string;
  orgName: string;
  role: RoleCode;
  userId: string;
}

export interface SessionPrincipal {
  accountId: string;
  userId: string;
  orgId: string;
  orgName: string;
  role: RoleCode;
  firstName: string;
  lastName: string | null;
  email: string;
  title: string;
  memberships: Membership[];
}

type AccountRow = {
  account_id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string | null;
  mfa_enabled?: boolean;
  totp_secret_encrypted?: string | null;
  totp_secret_iv?: string | null;
  totp_secret_tag?: string | null;
  backup_codes_hashes?: string[] | null;
  last_totp_timestamp?: string | number | bigint | null;
};

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return undefined;
}

export function sessionCookie(token: string, clear = false): string {
  const maxAge = clear ? 0 : Math.floor(SESSION_MS / 1000);
  const value = clear ? "" : encodeURIComponent(token);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

/**
 * Runs after the password matches and before a session is issued.
 * Today it accepts everyone. A later emailed OTP can return false here.
 */
export async function verifySecondFactor(_input: { email: string; accountId: string }): Promise<boolean> {
  return true;
}

export type LoginSuccessResult = {
  mfaRequired: false;
  token: string;
  principal: SessionPrincipal;
};

export type LoginMfaRequiredResult = {
  mfaRequired: true;
  mfaTicket: string;
  expiresAt: string;
};

export type LoginResult = LoginSuccessResult | LoginMfaRequiredResult;

export async function createSessionForAccount(
  accountId: string,
): Promise<{ token: string; principal: SessionPrincipal } | null> {
  const memberships = await membershipsFor(accountId);
  const home = memberships[0];
  if (!home) return null;
  const token = newSecret();
  const expires = new Date(Date.now() + SESSION_MS);
  await query(
    `INSERT INTO auth_sessions (token_hash, account_id, user_id, org_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashSecret(token), accountId, home.userId, home.orgId, expires.toISOString()],
  );
  const principal = await principalFromToken(token);
  if (!principal) return null;
  return { token, principal };
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  await ensureAuthSchema();
  const normalized = email.trim().toLowerCase();
  const { rows } = await query<AccountRow>(
    `SELECT account_id, email, password_hash, first_name, last_name, mfa_enabled
     FROM auth_accounts WHERE lower(email) = $1`,
    [normalized],
  );
  const account = rows[0] ?? null;
  const ok = await verifyPasswordOrDummy(password, account?.password_hash ?? null);
  if (!account || !ok) return null;
  const secondFactor = await verifySecondFactor({ email: account.email, accountId: account.account_id });
  if (!secondFactor) return null;

  // If MFA is enabled on this account, issue an ephemeral 5-minute challenge ticket
  // and do NOT issue an authenticated session cookie yet.
  if (account.mfa_enabled) {
    const { ticket, ticketHash } = generateMfaChallengeTicket();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await query(
      `INSERT INTO auth_mfa_challenges (ticket_hash, account_id, expires_at)
       VALUES ($1, $2, $3)`,
      [ticketHash, account.account_id, expiresAt.toISOString()],
    );
    return {
      mfaRequired: true,
      mfaTicket: ticket,
      expiresAt: expiresAt.toISOString(),
    };
  }

  const session = await createSessionForAccount(account.account_id);
  if (!session) return null;
  return {
    mfaRequired: false,
    token: session.token,
    principal: session.principal,
  };
}

export async function principalFromToken(token: string): Promise<SessionPrincipal | null> {
  await ensureAuthSchema();
  const { rows } = await query<{
    account_id: string;
    user_id: string;
    org_id: string;
    org_name: string;
    email: string;
    first_name: string;
    last_name: string | null;
    role_code: string | null;
  }>(
    `SELECT s.account_id, s.user_id, s.org_id, o.name AS org_name,
            a.email, a.first_name, a.last_name,
            COALESCE(m.role_code, v.role_code) AS role_code
     FROM auth_sessions s
     JOIN auth_accounts a ON a.account_id = s.account_id
     JOIN organizations o ON o.org_id = s.org_id
     LEFT JOIN org_memberships m
       ON m.account_id = s.account_id AND m.org_id = s.org_id AND m.status = 'active'
     LEFT JOIN v_user_primary_role v ON v.user_id = s.user_id AND v.org_id = s.org_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > now()`,
    [hashSecret(token)],
  );
  const row = rows[0];
  if (!row || !row.role_code) return null;
  const memberships = await membershipsFor(row.account_id);
  if (!memberships.some((m) => m.orgId === row.org_id)) return null;
  return toPrincipal(row, memberships);
}

export async function revokeToken(token: string): Promise<void> {
  await ensureAuthSchema();
  await query(
    `UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSecret(token)],
  );
}

export async function switchOrg(token: string, orgId: string): Promise<SessionPrincipal | null> {
  await ensureAuthSchema();
  const current = await principalFromToken(token);
  if (!current) return null;
  const next = current.memberships.find((m) => m.orgId === orgId);
  if (!next) return null;
  await query(
    `UPDATE auth_sessions SET org_id = $2, user_id = $3 WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSecret(token), next.orgId, next.userId],
  );
  return principalFromToken(token);
}

async function seedDefaultRiskPolicies(orgId: string): Promise<void> {
  await query(`SELECT seed_org_default_risk_policies($1::uuid)`, [orgId]);
}

export async function createInvite(input: {
  orgId: string;
  email: string;
  role: string;
  invitedBy: string;
}): Promise<{ token: string; email: string; role: RoleCode; expiresAt: string }> {
  await ensureAuthSchema();
  await seedDefaultRiskPolicies(input.orgId);
  if (!isRoleCode(input.role)) {
    throw Object.assign(new Error("A known role is required."), { status: 400 });
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  }
  const { rows: existing } = await query<{ user_id: string }>(
    `SELECT u.user_id
     FROM users u
     WHERE u.org_id = $1 AND lower(u.email) = $2
     UNION
     SELECT m.user_id
     FROM org_memberships m
     JOIN auth_accounts a ON a.account_id = m.account_id
     WHERE m.org_id = $1 AND lower(a.email) = $2 AND m.status = 'active'`,
    [input.orgId, email],
  );
  if (existing[0]) {
    throw Object.assign(new Error("That person is already in this organization."), { status: 409 });
  }
  const token = newSecret();
  const expires = new Date(Date.now() + INVITE_MS);
  await query(`DELETE FROM org_invites WHERE org_id = $1 AND lower(email) = $2 AND accepted_at IS NULL`, [
    input.orgId,
    email,
  ]);
  await query(
    `INSERT INTO org_invites (org_id, email, role_code, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.orgId, email, input.role, hashSecret(token), input.invitedBy, expires.toISOString()],
  );
  deliverMail({
    to: email,
    subject: "You are invited to the Executive Cyber Risk Command Center",
  });
  return { token, email, role: input.role, expiresAt: expires.toISOString() };
}

export async function previewInvite(token: string): Promise<{
  email: string;
  orgId: string;
  orgName: string;
  role: RoleCode;
} | null> {
  await ensureAuthSchema();
  const row = await openInvite(token);
  if (!row) return null;
  return {
    email: row.email,
    orgId: row.org_id,
    orgName: row.org_name,
    role: canonicalRole(row.role_code),
  };
}

export async function acceptInvite(
  token: string,
  password: string,
): Promise<{ token: string; principal: SessionPrincipal } | { error: string }> {
  await ensureAuthSchema();
  const problem = passwordAccepted(password);
  if (problem) return { error: problem };
  const invite = await openInvite(token);
  if (!invite) return { error: "This invite is invalid or has expired." };
  await seedDefaultRiskPolicies(invite.org_id);
  const passwordHash = await hashPassword(password);
  const email = invite.email.trim().toLowerCase();
  const names = nameFromEmail(email);

  const { rows: users } = await query<{ user_id: string; org_id: string; first_name: string; last_name: string | null }>(
    `SELECT user_id, org_id, first_name, last_name FROM users WHERE lower(email) = $1`,
    [email],
  );
  let userId = users.find((u) => u.org_id === invite.org_id)?.user_id ?? users[0]?.user_id;
  let firstName = users[0]?.first_name ?? names.firstName;
  let lastName = users[0]?.last_name ?? names.lastName;
  if (!users.find((u) => u.org_id === invite.org_id)) {
    if (!userId) {
      const inserted = await query<{ user_id: string }>(
        `INSERT INTO users (org_id, first_name, last_name, email)
         VALUES ($1, $2, $3, $4)
         RETURNING user_id`,
        [invite.org_id, firstName, lastName, email],
      );
      userId = inserted.rows[0].user_id;
    }
  }
  if (!userId) return { error: "Could not create the user." };

  await query(
    `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
     SELECT $1, r.role_id, $2, true
     FROM roles r
     WHERE r.code = $3
       AND NOT EXISTS (
         SELECT 1 FROM user_roles ur WHERE ur.user_id = $1 AND ur.org_id = $2 AND ur.is_primary
       )
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, invite.org_id, invite.role_code],
  );

  const { rows: accounts } = await query<{ account_id: string }>(
    `SELECT account_id FROM auth_accounts WHERE lower(email) = $1`,
    [email],
  );
  let accountId = accounts[0]?.account_id;
  if (accountId) {
    await query(`UPDATE auth_accounts SET password_hash = $2, first_name = $3, last_name = $4 WHERE account_id = $1`, [
      accountId,
      passwordHash,
      firstName,
      lastName,
    ]);
  } else {
    const created = await query<{ account_id: string }>(
      `INSERT INTO auth_accounts (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING account_id`,
      [email, passwordHash, firstName, lastName],
    );
    accountId = created.rows[0].account_id;
  }

  await query(
    `INSERT INTO org_memberships (account_id, org_id, user_id, role_code, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (account_id, org_id)
     DO UPDATE SET user_id = EXCLUDED.user_id, role_code = EXCLUDED.role_code, status = 'active'`,
    [accountId, invite.org_id, userId, invite.role_code],
  );
  await query(`UPDATE org_invites SET accepted_at = now() WHERE invite_id = $1`, [invite.invite_id]);

  const sessionToken = newSecret();
  const expires = new Date(Date.now() + SESSION_MS);
  await query(
    `INSERT INTO auth_sessions (token_hash, account_id, user_id, org_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashSecret(sessionToken), accountId, userId, invite.org_id, expires.toISOString()],
  );
  const principal = await principalFromToken(sessionToken);
  if (!principal) return { error: "Could not start a session." };
  return { token: sessionToken, principal };
}

export interface AccessRow {
  userId: string | null;
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
  title: string;
  status: "active" | "invited" | "disabled";
}

export async function listAccess(orgId: string): Promise<AccessRow[]> {
  await ensureAuthSchema();
  const { rows } = await query<{
    user_id: string;
    first_name: string;
    last_name: string | null;
    email: string;
    role_code: string;
    status: string;
  }>(
    `SELECT u.user_id, u.first_name, u.last_name, u.email,
            COALESCE(m.role_code, v.role_code, 'domain_analyst') AS role_code,
            COALESCE(m.status, 'active') AS status
     FROM users u
     LEFT JOIN v_user_primary_role v ON v.user_id = u.user_id
     LEFT JOIN org_memberships m ON m.user_id = u.user_id AND m.org_id = u.org_id
     WHERE u.org_id = $1
     UNION
     SELECT u.user_id, u.first_name, u.last_name, COALESCE(a.email, u.email),
            m.role_code, m.status
     FROM org_memberships m
     JOIN users u ON u.user_id = m.user_id
     JOIN auth_accounts a ON a.account_id = m.account_id
     WHERE m.org_id = $1 AND u.org_id <> $1`,
    [orgId],
  );
  const { rows: invites } = await query<{ email: string; role_code: string }>(
    `SELECT email, role_code FROM org_invites
     WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [orgId],
  );
  const people: AccessRow[] = rows.map((row) => {
    const role = canonicalRole(row.role_code);
    const persona = findPersona(row.user_id);
    const status = row.status === "disabled" || row.status === "invited" ? row.status : "active";
    return {
      userId: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      role,
      title: persona?.title ?? ROLE_LABEL[role],
      status,
    };
  });
  for (const invite of invites) {
    if (people.some((p) => p.email.toLowerCase() === invite.email.toLowerCase())) continue;
    const role = canonicalRole(invite.role_code);
    const local = nameFromEmail(invite.email);
    people.push({
      userId: null,
      firstName: local.firstName,
      lastName: local.lastName,
      email: invite.email,
      role,
      title: ROLE_LABEL[role],
      status: "invited",
    });
  }
  return people.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.email.localeCompare(b.email));
}

async function membershipsFor(accountId: string): Promise<Membership[]> {
  const { rows } = await query<{
    org_id: string;
    org_name: string;
    role_code: string;
    user_id: string;
  }>(
    `SELECT m.org_id, o.name AS org_name, m.role_code, m.user_id
     FROM org_memberships m
     JOIN organizations o ON o.org_id = m.org_id
     WHERE m.account_id = $1 AND m.status = 'active'
     ORDER BY o.name`,
    [accountId],
  );
  return rows.map((row) => ({
    orgId: row.org_id,
    orgName: row.org_name,
    role: canonicalRole(row.role_code),
    userId: row.user_id,
  }));
}

function toPrincipal(
  row: {
    account_id: string;
    user_id: string;
    org_id: string;
    org_name: string;
    email: string;
    first_name: string;
    last_name: string | null;
    role_code: string | null;
  },
  memberships: Membership[],
): SessionPrincipal {
  const role = canonicalRole(row.role_code ?? "domain_analyst");
  const persona = findPersona(row.user_id);
  return {
    accountId: row.account_id,
    userId: row.user_id,
    orgId: row.org_id,
    orgName: row.org_name,
    role,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    title: persona?.title ?? ROLE_LABEL[role],
    memberships,
  };
}

async function openInvite(token: string): Promise<{
  invite_id: string;
  org_id: string;
  org_name: string;
  email: string;
  role_code: string;
} | null> {
  if (!token) return null;
  const { rows } = await query<{
    invite_id: string;
    org_id: string;
    org_name: string;
    email: string;
    role_code: string;
  }>(
    `SELECT i.invite_id, i.org_id, o.name AS org_name, i.email, i.role_code
     FROM org_invites i
     JOIN organizations o ON o.org_id = i.org_id
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
    [hashSecret(token)],
  );
  return rows[0] ?? null;
}

function nameFromEmail(email: string): { firstName: string; lastName: string | null } {
  const local = email.split("@")[0] ?? "New";
  const parts = local.split(/[._-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  if (parts.length === 0) return { firstName: "New", lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function accountIdForEmail(email: string): Promise<string | null> {
  const { rows } = await query<{ account_id: string }>(
    `SELECT account_id FROM auth_accounts WHERE lower(email) = lower($1)`,
    [email.trim()],
  );
  return rows[0]?.account_id ?? null;
}

export async function getMfaStatus(accountId: string): Promise<{ mfaEnabled: boolean; enrolledAt: string | null }> {
  await ensureAuthSchema();
  const { rows } = await query<{ mfa_enabled: boolean; mfa_enrolled_at: Date | null }>(
    `SELECT mfa_enabled, mfa_enrolled_at FROM auth_accounts WHERE account_id = $1`,
    [accountId],
  );
  const row = rows[0];
  return {
    mfaEnabled: row?.mfa_enabled ?? false,
    enrolledAt: row?.mfa_enrolled_at ? new Date(row.mfa_enrolled_at).toISOString() : null,
  };
}

export async function verifyMfaChallengeAndLogin(
  mfaTicket: string,
  code: string,
): Promise<
  | { ok: true; token: string; principal: SessionPrincipal; usedRecoveryCode?: boolean }
  | { ok: false; status: number; code: string; message: string }
> {
  await ensureAuthSchema();
  if (!mfaTicket || typeof mfaTicket !== "string") {
    return { ok: false, status: 400, code: "invalid_body", message: "mfaTicket is required." };
  }
  if (!code || typeof code !== "string") {
    return { ok: false, status: 400, code: "invalid_body", message: "Verification code is required." };
  }

  const cleanTicket = mfaTicket.trim();
  const cleanCode = code.trim();
  const ticketHash = hashMfaChallengeTicket(cleanTicket);

  const { rows: challengeRows } = await query<{
    challenge_id: string;
    account_id: string;
    attempts: number;
    consumed_at: Date | null;
    expires_at: Date;
  }>(
    `SELECT challenge_id, account_id, attempts, consumed_at, expires_at
     FROM auth_mfa_challenges
     WHERE ticket_hash = $1`,
    [ticketHash],
  );

  const challenge = challengeRows[0];
  if (!challenge) {
    return { ok: false, status: 401, code: "invalid_challenge", message: "Invalid MFA challenge. Sign in again." };
  }

  if (challenge.consumed_at != null) {
    return { ok: false, status: 401, code: "challenge_consumed", message: "This challenge has already been consumed. Sign in again." };
  }

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, code: "challenge_expired", message: "MFA challenge has expired. Sign in again." };
  }

  if (challenge.attempts >= 5) {
    return { ok: false, status: 401, code: "challenge_exhausted", message: "Too many failed verification attempts. Sign in again." };
  }

  const { rows: accountRows } = await query<AccountRow>(
    `SELECT account_id, email, mfa_enabled, totp_secret_encrypted, totp_secret_iv, totp_secret_tag,
            backup_codes_hashes, last_totp_timestamp
     FROM auth_accounts WHERE account_id = $1`,
    [challenge.account_id],
  );
  const account = accountRows[0];
  if (!account || !account.mfa_enabled || !account.totp_secret_encrypted || !account.totp_secret_iv || !account.totp_secret_tag) {
    return { ok: false, status: 401, code: "mfa_not_configured", message: "MFA is not configured for this account." };
  }

  let totpMatchedStep: number | undefined;
  let usedRecoveryCode = false;

  // 1. Try 6-digit TOTP code
  if (/^\d{6}$/.test(cleanCode)) {
    try {
      const secret = decryptTotpSecret({
        ciphertextHex: account.totp_secret_encrypted,
        ivHex: account.totp_secret_iv,
        tagHex: account.totp_secret_tag,
      });
      const totpResult = verifyTotpCode({ secret, code: cleanCode, toleranceSteps: 1 });
      if (totpResult.valid && totpResult.matchedStep !== undefined) {
        // Enforce replay prevention against last_totp_timestamp
        if (isTotpStepReplayed(totpResult.matchedStep, account.last_totp_timestamp)) {
          await query(`UPDATE auth_mfa_challenges SET attempts = attempts + 1 WHERE challenge_id = $1`, [challenge.challenge_id]);
          return {
            ok: false,
            status: 401,
            code: "code_replayed",
            message: "This code was already used. Please wait for the next 30-second code.",
          };
        }
        totpMatchedStep = totpResult.matchedStep;
      }
    } catch {
      /* ignore decryption error, proceed to check recovery code or fail */
    }
  }

  // 2. Try emergency recovery code if TOTP didn't match
  let updatedRecoveryHashes: string[] | undefined;
  if (totpMatchedStep === undefined && account.backup_codes_hashes?.length) {
    const recoveryResult = verifyAndConsumeRecoveryCode(cleanCode, account.backup_codes_hashes);
    if (recoveryResult.matched) {
      usedRecoveryCode = true;
      updatedRecoveryHashes = recoveryResult.remainingHashes;
    }
  }

  if (totpMatchedStep === undefined && !usedRecoveryCode) {
    await query(`UPDATE auth_mfa_challenges SET attempts = attempts + 1 WHERE challenge_id = $1`, [challenge.challenge_id]);
    return { ok: false, status: 401, code: "invalid_code", message: "Invalid verification code." };
  }

  // 3. Atomic consumption of the challenge (prevents concurrent race conditions)
  const { rowCount: consumedCount } = await query(
    `UPDATE auth_mfa_challenges
     SET consumed_at = now()
     WHERE challenge_id = $1 AND consumed_at IS NULL`,
    [challenge.challenge_id],
  );
  if (consumedCount === 0) {
    return { ok: false, status: 401, code: "challenge_consumed", message: "This challenge has already been consumed." };
  }

  // 4. Update replay step or remaining recovery codes atomically in DB
  if (totpMatchedStep !== undefined) {
    const { rowCount: replayCount } = await query(
      `UPDATE auth_accounts
       SET last_totp_timestamp = $2
       WHERE account_id = $1
         AND (last_totp_timestamp IS NULL OR last_totp_timestamp < $2)`,
      [account.account_id, totpMatchedStep],
    );
    if (replayCount === 0) {
      return { ok: false, status: 401, code: "code_replayed", message: "This code was already accepted in a concurrent session." };
    }
  } else if (usedRecoveryCode && updatedRecoveryHashes) {
    await query(
      `UPDATE auth_accounts
       SET backup_codes_hashes = $2
       WHERE account_id = $1`,
      [account.account_id, updatedRecoveryHashes],
    );
  }

  // 5. Issue session
  const sessionResult = await createSessionForAccount(account.account_id);
  if (!sessionResult) {
    return { ok: false, status: 500, code: "session_failed", message: "Failed to establish authenticated session." };
  }

  return {
    ok: true,
    token: sessionResult.token,
    principal: sessionResult.principal,
    usedRecoveryCode,
  };
}

export async function setupMfa(
  accountId: string,
  passwordConfirm: string,
): Promise<{ provisioningUri: string; manualSecret: string; expiresAt: string }> {
  await ensureAuthSchema();
  const { rows } = await query<AccountRow>(
    `SELECT account_id, email, password_hash FROM auth_accounts WHERE account_id = $1`,
    [accountId],
  );
  const account = rows[0];
  if (!account) {
    const err = new Error("Account not found.") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  const ok = await verifyPasswordOrDummy(passwordConfirm, account.password_hash);
  if (!ok) {
    const err = new Error("Wrong password.") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  const secret = generateTotpSecret(20);
  const encrypted = encryptTotpSecret(secret);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  await query(
    `INSERT INTO auth_mfa_pending_enrollments (account_id, secret_encrypted, secret_iv, secret_tag, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account_id) DO UPDATE SET
       secret_encrypted = EXCLUDED.secret_encrypted,
       secret_iv = EXCLUDED.secret_iv,
       secret_tag = EXCLUDED.secret_tag,
       expires_at = EXCLUDED.expires_at,
       created_at = now()`,
    [account.account_id, encrypted.ciphertextHex, encrypted.ivHex, encrypted.tagHex, expiresAt.toISOString()],
  );

  const provisioningUri = generateTotpUri({
    secret,
    email: account.email,
    issuer: "Executive Cyber Risk Command Center",
  });

  return {
    provisioningUri,
    manualSecret: secret,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function confirmMfaSetup(
  accountId: string,
  code: string,
): Promise<{ ok: true; backupCodes: string[] }> {
  await ensureAuthSchema();
  const { rows: pendingRows } = await query<{
    secret_encrypted: string;
    secret_iv: string;
    secret_tag: string;
    expires_at: Date;
  }>(
    `SELECT secret_encrypted, secret_iv, secret_tag, expires_at
     FROM auth_mfa_pending_enrollments
     WHERE account_id = $1`,
    [accountId],
  );

  const pending = pendingRows[0];
  if (!pending) {
    const err = new Error("Pending MFA enrollment expired or not found. Start setup again.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await query(`DELETE FROM auth_mfa_pending_enrollments WHERE account_id = $1`, [accountId]);
    const err = new Error("Pending MFA enrollment expired. Start setup again.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const decryptedSecret = decryptTotpSecret({
    ciphertextHex: pending.secret_encrypted,
    ivHex: pending.secret_iv,
    tagHex: pending.secret_tag,
  });

  const totpResult = verifyTotpCode({
    secret: decryptedSecret,
    code: code.trim(),
    toleranceSteps: 1,
  });

  if (!totpResult.valid || totpResult.matchedStep === undefined) {
    const err = new Error("Invalid verification code. Check Google Authenticator and try again.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const recoveryBundle = generateRecoveryCodes(8);

  // Atomically promote pending secret, mark MFA enabled, record initial step, and set recovery codes
  await query(
    `UPDATE auth_accounts
     SET mfa_enabled = true,
         totp_secret_encrypted = $2,
         totp_secret_iv = $3,
         totp_secret_tag = $4,
         mfa_enrolled_at = now(),
         backup_codes_hashes = $5,
         last_totp_timestamp = $6
     WHERE account_id = $1`,
    [
      accountId,
      pending.secret_encrypted,
      pending.secret_iv,
      pending.secret_tag,
      recoveryBundle.hashedCodes,
      totpResult.matchedStep - 1,
    ],
  );

  await query(`DELETE FROM auth_mfa_pending_enrollments WHERE account_id = $1`, [accountId]);

  return {
    ok: true,
    backupCodes: recoveryBundle.plaintextCodes,
  };
}

export async function disableMfa(
  accountId: string,
  passwordConfirm: string,
  code?: string,
  recoveryCode?: string,
): Promise<{ ok: true }> {
  await ensureAuthSchema();
  const { rows } = await query<AccountRow>(
    `SELECT account_id, email, password_hash, mfa_enabled,
            totp_secret_encrypted, totp_secret_iv, totp_secret_tag,
            backup_codes_hashes
     FROM auth_accounts WHERE account_id = $1`,
    [accountId],
  );
  const account = rows[0];
  if (!account) {
    const err = new Error("Account not found.") as Error & { status?: number };
    err.status = 404;
    throw err;
  }

  if (!account.mfa_enabled) {
    return { ok: true };
  }

  const passwordOk = await verifyPasswordOrDummy(passwordConfirm, account.password_hash);
  if (!passwordOk) {
    const err = new Error("Wrong password.") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  // Factor verification: requires either valid TOTP code or valid recovery code
  let factorVerified = false;
  if (code && account.totp_secret_encrypted && account.totp_secret_iv && account.totp_secret_tag) {
    try {
      const secret = decryptTotpSecret({
        ciphertextHex: account.totp_secret_encrypted,
        ivHex: account.totp_secret_iv,
        tagHex: account.totp_secret_tag,
      });
      const result = verifyTotpCode({ secret, code: code.trim(), toleranceSteps: 1 });
      if (result.valid) {
        factorVerified = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (!factorVerified && recoveryCode && account.backup_codes_hashes) {
    const recoveryResult = verifyAndConsumeRecoveryCode(recoveryCode, account.backup_codes_hashes);
    if (recoveryResult.matched) {
      factorVerified = true;
    }
  }

  if (!factorVerified) {
    const err = new Error("A valid TOTP code or recovery code is required to disable MFA.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  await query(
    `UPDATE auth_accounts
     SET mfa_enabled = false,
         totp_secret_encrypted = NULL,
         totp_secret_iv = NULL,
         totp_secret_tag = NULL,
         mfa_enrolled_at = NULL,
         backup_codes_hashes = NULL,
         last_totp_timestamp = NULL
     WHERE account_id = $1`,
    [accountId],
  );

  await query(`DELETE FROM auth_mfa_pending_enrollments WHERE account_id = $1`, [accountId]);
  await query(`UPDATE auth_mfa_challenges SET consumed_at = now() WHERE account_id = $1 AND consumed_at IS NULL`, [accountId]);

  return { ok: true };
}

export async function regenerateRecoveryCodes(
  accountId: string,
  passwordConfirm: string,
  code: string,
): Promise<{ ok: true; backupCodes: string[] }> {
  await ensureAuthSchema();
  const { rows } = await query<AccountRow>(
    `SELECT account_id, password_hash, mfa_enabled,
            totp_secret_encrypted, totp_secret_iv, totp_secret_tag
     FROM auth_accounts WHERE account_id = $1`,
    [accountId],
  );
  const account = rows[0];
  if (!account || !account.mfa_enabled || !account.totp_secret_encrypted || !account.totp_secret_iv || !account.totp_secret_tag) {
    const err = new Error("MFA is not enabled for this account.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const passwordOk = await verifyPasswordOrDummy(passwordConfirm, account.password_hash);
  if (!passwordOk) {
    const err = new Error("Wrong password.") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  const secret = decryptTotpSecret({
    ciphertextHex: account.totp_secret_encrypted,
    ivHex: account.totp_secret_iv,
    tagHex: account.totp_secret_tag,
  });
  const result = verifyTotpCode({ secret, code: code.trim(), toleranceSteps: 1 });
  if (!result.valid) {
    const err = new Error("Invalid TOTP verification code.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  const bundle = generateRecoveryCodes(8);
  await query(
    `UPDATE auth_accounts SET backup_codes_hashes = $2 WHERE account_id = $1`,
    [accountId, bundle.hashedCodes],
  );

  return { ok: true, backupCodes: bundle.plaintextCodes };
}
