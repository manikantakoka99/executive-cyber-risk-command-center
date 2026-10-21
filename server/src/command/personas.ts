import type { RoleCode } from "./rbac.js";

/** Al Dhabi Holdings — the reference command-center tenant. */
export const DEMO_ORG_ID = "2accc7de-f693-4b19-8fe8-6db501be05e2";
export const DEMO_ORG_NAME = "Al Dhabi Holdings";

/** Second demo tenant for cross-tenant isolation tests (matches sample DB org). */
export const TENANT_B_ORG_ID = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";
export const TENANT_B_ORG_NAME = "Falcon National Bank";

export interface Persona {
  userId: string;
  orgId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: RoleCode;
  title: string;
}

/**
 * One demo login per schema role. The local part is the person's first name.
 * These domains are real and public; outbound mail to them stays log-only.
 * Danielle Johnson is the manager-demo scenario actor and is not a ninth login:
 * the CxO account is Mariam.
 */
export const ROLE_LOGIN_DOMAIN: Record<RoleCode, string> = {
  ciso: "ciso.com",
  cxo: "cxo.com",
  board_member: "board.com",
  risk_lead: "risklead.com",
  domain_analyst: "domainanalyst.com",
  auditor: "auditor.com",
  program_office: "programoffice.com",
  admin: "admin.com",
};

const ROLE_LOGIN_USER: Record<RoleCode, string> = {
  ciso: "c1500001-a090-41a0-8ecc-000000000001",
  cxo: "c1500001-a090-41a0-8ecc-000000000005",
  board_member: "c1500001-a090-41a0-8ecc-000000000006",
  risk_lead: "c1500001-a090-41a0-8ecc-00000000000a",
  domain_analyst: "c1500001-a090-41a0-8ecc-000000000007",
  auditor: "c1500001-a090-41a0-8ecc-00000000000c",
  program_office: "c1500001-a090-41a0-8ecc-00000000000b",
  admin: "c1500001-a090-41a0-8ecc-000000000009",
};

export function roleLoginEmail(firstName: string, role: RoleCode): string {
  return `${firstName.trim().toLowerCase()}@${ROLE_LOGIN_DOMAIN[role]}`;
}

export function roleLogins(): Persona[] {
  return (Object.keys(ROLE_LOGIN_USER) as RoleCode[]).map((role) => {
    const persona = PERSONAS.find((item) => item.userId === ROLE_LOGIN_USER[role]);
    if (!persona) throw new Error(`Missing demo person for ${role}`);
    return persona;
  });
}

export const PERSONAS: Persona[] = [
  ...aldhabiPersonas(),
  ...tenantBPersonas(),
];

function aldhabiPersonas(): Persona[] {
  return [
    persona(DEMO_ORG_ID, "01", "Layla", "Al Hashimi", "ciso", "CISO"),
    persona(DEMO_ORG_ID, "02", "Omar", "Al Mansoori", "cxo", "CEO"),
    persona(DEMO_ORG_ID, "03", "Fatima", "Al Nuaimi", "cxo", "CFO"),
    persona(DEMO_ORG_ID, "04", "Khalid", "Al Suwaidi", "cxo", "CIO"),
    persona(DEMO_ORG_ID, "05", "Mariam", "Al Dhaheri", "cxo", "COO"),
    persona(DEMO_ORG_ID, "06", "Hessa", "Al Ketbi", "board_member", "Board Member"),
    // Schema role domain_analyst (job titles differ for demo clarity).
    persona(DEMO_ORG_ID, "07", "Yusuf", "Rahman", "domain_analyst", "Security Analyst"),
    persona(DEMO_ORG_ID, "08", "Aisha", "Khan", "domain_analyst", "SOC Analyst"),
    persona(DEMO_ORG_ID, "09", "Nadia", "Farouk", "admin", "Admin"),
    persona(DEMO_ORG_ID, "0a", "Rashid", "Al Maktoum", "risk_lead", "Risk Lead"),
    persona(DEMO_ORG_ID, "0b", "Sara", "Ibrahim", "program_office", "Compliance Manager"),
    persona(DEMO_ORG_ID, "0c", "James", "Okoye", "auditor", "Auditor"),
  ];
}

function tenantBPersonas(): Persona[] {
  return [
    persona(TENANT_B_ORG_ID, "b1", "Nora", "Al Falasi", "ciso", "CISO"),
    persona(TENANT_B_ORG_ID, "b2", "Tariq", "Hassan", "board_member", "Board Member"),
    persona(TENANT_B_ORG_ID, "b3", "Samira", "Qureshi", "cxo", "CEO"),
  ];
}

function persona(
  orgId: string,
  suffix: string,
  firstName: string,
  lastName: string,
  role: RoleCode,
  title: string,
): Persona {
  const userId = `c1500001-a090-41a0-8ecc-0000000000${suffix}`;
  const isRoleLogin = Object.values(ROLE_LOGIN_USER).includes(userId);
  const local = isRoleLogin ? firstName.toLowerCase() : `${firstName}.${lastName}`.toLowerCase().replace(/\s+/g, "");
  const domain = isRoleLogin ? ROLE_LOGIN_DOMAIN[role] : "example.com";
  return {
    userId,
    orgId,
    firstName,
    lastName,
    email: `${local}@${domain}`,
    role,
    title,
  };
}

const roleOverrides = new Map<string, RoleCode>();

export function findPersona(userId: string): Persona | undefined {
  return PERSONAS.find((p) => p.userId === userId);
}

export function personasForOrg(orgId: string): Persona[] {
  return PERSONAS.filter((p) => p.orgId === orgId);
}

export function roleOverride(userId: string): RoleCode | undefined {
  return roleOverrides.get(userId);
}

export function setRoleOverride(userId: string, role: RoleCode) {
  roleOverrides.set(userId, role);
}

export function effectivePersonaRole(userId: string, fallback: RoleCode): RoleCode {
  return roleOverrides.get(userId) ?? fallback;
}

export function actorLabel(userId: string, role: string): string {
  const p = findPersona(userId);
  if (p) return `${p.firstName} ${p.lastName}, ${p.title}`;
  return role;
}

export function orgNameFor(orgId: string): string {
  if (orgId === DEMO_ORG_ID) return DEMO_ORG_NAME;
  if (orgId === TENANT_B_ORG_ID) return TENANT_B_ORG_NAME;
  return "Organization";
}
