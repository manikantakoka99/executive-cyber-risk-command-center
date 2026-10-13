import type { RoleCode } from "./rbac.js";

/** Al Dhabi Holdings — the reference command-center tenant. */
export const DEMO_ORG_ID = "2accc7de-f693-4b19-8fe8-6db501be05e2";
export const DEMO_ORG_NAME = "Al Dhabi Holdings";

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
  persona("01", "Layla", "Al Hashimi", "ciso", "CISO", "layla.hashimi"),
  persona("02", "Omar", "Al Mansoori", "cxo", "CEO", "omar.mansoori"),
  persona("03", "Fatima", "Al Nuaimi", "cxo", "CFO", "fatima.nuaimi"),
  persona("04", "Khalid", "Al Suwaidi", "cxo", "CIO", "khalid.suwaidi"),
  persona("05", "Mariam", "Al Dhaheri", "cxo", "COO", "mariam.dhaheri"),
  persona("06", "Hessa", "Al Ketbi", "board_member", "Board Member", "hessa.ketbi"),
  persona("07", "Yusuf", "Rahman", "security_analyst", "Security Analyst", "yusuf.rahman"),
  persona("08", "Aisha", "Khan", "soc_analyst", "SOC Analyst", "aisha.khan"),
  persona("09", "Nadia", "Farouk", "org_admin", "Admin", "nadia.farouk"),
  persona("0a", "Rashid", "Al Maktoum", "risk_manager", "Risk Lead", "rashid.maktoum"),
  persona("0b", "Sara", "Ibrahim", "compliance_manager", "Compliance Manager", "sara.ibrahim"),
  persona("0c", "James", "Okoye", "auditor", "Auditor", "james.okoye"),
];

function persona(
  suffix: string,
  firstName: string,
  lastName: string,
  role: RoleCode,
  title: string,
  email: string,
): Persona {
  return {
    userId: `c1500001-a090-41a0-8ecc-0000000000${suffix}`,
    orgId: DEMO_ORG_ID,
    firstName,
    lastName,
    email: `${email}@aldhabi.demo`,
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
  const persona = findPersona(userId);
  if (persona) return `${persona.firstName} ${persona.lastName}, ${persona.title}`;
  return role;
}
