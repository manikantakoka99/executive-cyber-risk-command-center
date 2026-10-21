import { query } from "../db.js";
import { canonicalRole, isRoleCode, ROLE_LABEL, type RoleCode } from "../command/rbac.js";
import { findPersona } from "../command/personas.js";
import { hashPassword, hashSecret, newSecret, passwordAccepted, verifyPasswordOrDummy } from "./passwords.js";
import { ensureAuthSchema } from "./schema.js";

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

export async function login(email: string, password: string): Promise<{ token: string; principal: SessionPrincipal } | null> {
  await ensureAuthSchema();
  const normalized = email.trim().toLowerCase();
  const { rows } = await query<AccountRow>(
    `SELECT account_id, email, password_hash, first_name, last_name
     FROM auth_accounts WHERE lower(email) = $1`,
    [normalized],
  );
  const account = rows[0] ?? null;
  const ok = await verifyPasswordOrDummy(password, account?.password_hash ?? null);
  if (!account || !ok) return null;
  const memberships = await membershipsFor(account.account_id);
  const home = memberships[0];
  if (!home) return null;
  const token = newSecret();
  const expires = new Date(Date.now() + SESSION_MS);
  await query(
    `INSERT INTO auth_sessions (token_hash, account_id, user_id, org_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [hashSecret(token), account.account_id, home.userId, home.orgId, expires.toISOString()],
  );
  const principal = await principalFromToken(token);
  if (!principal) return null;
  return { token, principal };
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
