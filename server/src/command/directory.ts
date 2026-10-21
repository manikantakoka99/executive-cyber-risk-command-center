import { query } from "../db.js";
import { canonicalRole, isRoleCode, type RoleCode } from "./rbac.js";
import {
  DEMO_ORG_ID,
  DEMO_ORG_NAME,
  PERSONAS,
  TENANT_B_ORG_ID,
  TENANT_B_ORG_NAME,
  effectivePersonaRole,
  findPersona,
  personasForOrg,
  setRoleOverride,
  type Persona,
} from "./personas.js";

export interface DirectoryUser {
  userId: string;
  orgId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
  title: string;
}

export interface DirectoryOrg {
  orgId: string;
  name: string;
  industry: string | null;
  hqCountry: string | null;
}

const DEMO_ORGS: DirectoryOrg[] = [
  {
    orgId: DEMO_ORG_ID,
    name: DEMO_ORG_NAME,
    industry: "Holding company",
    hqCountry: "AE",
  },
  {
    orgId: TENANT_B_ORG_ID,
    name: TENANT_B_ORG_NAME,
    industry: "Banking",
    hqCountry: "AE",
  },
];

export async function listOrganizations(): Promise<{ organizations: DirectoryOrg[]; source: "database" | "demo" }> {
  try {
    const { rows } = await query<{
      org_id: string;
      name: string;
      industry: string | null;
      hq_country: string | null;
    }>(`SELECT org_id, name, industry, hq_country FROM organizations ORDER BY name`);
    if (rows.length) {
      const byId = new Map(
        rows.map((org) => [
          org.org_id,
          {
            orgId: org.org_id,
            name: org.name,
            industry: org.industry,
            hqCountry: org.hq_country,
          } satisfies DirectoryOrg,
        ]),
      );
      // Always surface both demo tenants for login / isolation testing.
      for (const demo of DEMO_ORGS) {
        if (!byId.has(demo.orgId)) byId.set(demo.orgId, demo);
      }
      return {
        source: "database",
        organizations: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    }
  } catch {
    /* demo directory */
  }
  return { source: "demo", organizations: DEMO_ORGS };
}

export async function listUsers(orgId: string): Promise<DirectoryUser[]> {
  const merged = new Map<string, DirectoryUser>();
  try {
    const { rows } = await query<{
      user_id: string;
      first_name: string;
      last_name: string | null;
      email: string;
      role: string;
    }>(
      `SELECT u.user_id, u.first_name, u.last_name, u.email,
              COALESCE(v.role_code, 'domain_analyst') AS role
       FROM users u
       LEFT JOIN v_user_primary_role v ON v.user_id = u.user_id
       WHERE u.org_id = $1
       ORDER BY u.first_name`,
      [orgId],
    );
    for (const row of rows) {
      const persona = findPersona(row.user_id);
      merged.set(row.user_id, {
        userId: row.user_id,
        orgId,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        role: effectivePersonaRole(row.user_id, canonicalRole(row.role)),
        title: persona?.title ?? titleFor(canonicalRole(row.role)),
      });
    }
  } catch {
    /* database unavailable */
  }
  for (const persona of personasForOrg(orgId)) {
    if ([...merged.values()].some((user) => user.email === persona.email || user.userId === persona.userId)) {
      continue;
    }
    merged.set(persona.userId, toDirectory(persona));
  }
  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title) || a.firstName.localeCompare(b.firstName));
}

function toDirectory(persona: Persona): DirectoryUser {
  return {
    userId: persona.userId,
    orgId: persona.orgId,
    firstName: persona.firstName,
    lastName: persona.lastName,
    email: persona.email,
    role: effectivePersonaRole(persona.userId, persona.role),
    title: persona.title,
  };
}

function titleFor(role: string): string {
  switch (canonicalRole(role)) {
    case "cxo":
      return "CxO";
    case "ciso":
      return "CISO";
    case "board_member":
      return "Board Member";
    case "admin":
      return "Admin";
    case "risk_lead":
      return "Risk Lead";
    case "domain_analyst":
      return "Domain Analyst";
    case "program_office":
      return "Program Office";
    case "auditor":
      return "Auditor";
  }
}

export async function assignRole(userId: string, orgId: string, role: RoleCode): Promise<boolean> {
  const users = await listUsers(orgId);
  const user = users.find((row) => row.userId === userId);
  if (!user) return false;
  setRoleOverride(userId, role);
  try {
    const { rows: roleRows } = await query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE code = $1`,
      [role],
    );
    if (!roleRows[0]) return true;
    await query(
      `UPDATE user_roles SET is_primary = false WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId],
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (user_id, role_id) DO UPDATE SET is_primary = true`,
      [userId, roleRows[0].role_id, orgId],
    );
    await query(
      `UPDATE org_memberships SET role_code = $1 WHERE user_id = $2 AND org_id = $3`,
      [role, userId, orgId],
    );
  } catch {
    /* override still applies for this process */
  }
  return true;
}

export async function seedCommandDirectory(): Promise<void> {
  try {
    await query(`SELECT 1`);
  } catch {
    return;
  }
  await query(
    `INSERT INTO roles (code, display_name, description) VALUES
      ('board_member', 'Board Member', 'Board oversight'),
      ('cxo', 'CxO', 'Executive decision maker'),
      ('ciso', 'CISO', 'Chief information security officer'),
      ('risk_lead', 'Risk Lead', 'Risk acceptance and register'),
      ('domain_analyst', 'Domain Analyst', 'Domain evidence analyst'),
      ('program_office', 'Program Office', 'PMO / compliance program'),
      ('auditor', 'Auditor', 'Read-only auditor'),
      ('admin', 'Admin', 'Organization administrator')
     ON CONFLICT (code) DO NOTHING`,
  );

  for (const org of DEMO_ORGS) {
    await query(
      `INSERT INTO organizations (org_id, name, industry, hq_country)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id) DO NOTHING`,
      [org.orgId, org.name, org.industry, org.hqCountry],
    );
  }

  for (const persona of PERSONAS) {
    await query(
      `INSERT INTO users (user_id, org_id, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET email = EXCLUDED.email,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name`,
      [persona.userId, persona.orgId, persona.firstName, persona.lastName, persona.email],
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
       SELECT u.user_id, r.role_id, u.org_id, true
       FROM users u
       JOIN roles r ON r.code = $2
       WHERE u.email = $1
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = u.user_id AND ur.is_primary = true
         )
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [persona.email, persona.role],
    );
  }
}
