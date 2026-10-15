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

export const PERSONAS: Persona[] = [
  ...aldhabiPersonas(),
  ...tenantBPersonas(),
];

function aldhabiPersonas(): Persona[] {
  return [
    persona(DEMO_ORG_ID, "01", "Layla", "Al Hashimi", "ciso", "CISO", "layla.hashimi", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "02", "Omar", "Al Mansoori", "cxo", "CEO", "omar.mansoori", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "03", "Fatima", "Al Nuaimi", "cxo", "CFO", "fatima.nuaimi", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "04", "Khalid", "Al Suwaidi", "cxo", "CIO", "khalid.suwaidi", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "05", "Mariam", "Al Dhaheri", "cxo", "COO", "mariam.dhaheri", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "06", "Hessa", "Al Ketbi", "board_member", "Board Member", "hessa.ketbi", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "07", "Yusuf", "Rahman", "security_analyst", "Security Analyst", "yusuf.rahman", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "08", "Aisha", "Khan", "soc_analyst", "SOC Analyst", "aisha.khan", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "09", "Nadia", "Farouk", "org_admin", "Admin", "nadia.farouk", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "0a", "Rashid", "Al Maktoum", "risk_manager", "Risk Lead", "rashid.maktoum", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "0b", "Sara", "Ibrahim", "compliance_manager", "Compliance Manager", "sara.ibrahim", "aldhabi.demo"),
    persona(DEMO_ORG_ID, "0c", "James", "Okoye", "auditor", "Auditor", "james.okoye", "aldhabi.demo"),
  ];
}

function tenantBPersonas(): Persona[] {
  // Distinct user-id prefix so they cannot collide with Al Dhabi personas.
  return [
    persona(TENANT_B_ORG_ID, "b1", "Nora", "Al Falasi", "ciso", "CISO", "nora.falasi", "falcon.demo"),
    persona(TENANT_B_ORG_ID, "b2", "Tariq", "Hassan", "board_member", "Board Member", "tariq.hassan", "falcon.demo"),
    persona(TENANT_B_ORG_ID, "b3", "Samira", "Qureshi", "cxo", "CEO", "samira.qureshi", "falcon.demo"),
  ];
}

function persona(
  orgId: string,
  suffix: string,
  firstName: string,
  lastName: string,
  role: RoleCode,
  title: string,
  emailLocal: string,
  domain: string,
): Persona {
  return {
    userId: `c1500001-a090-41a0-8ecc-0000000000${suffix}`,
    orgId,
    firstName,
    lastName,
    email: `${emailLocal}@${domain}`,
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
