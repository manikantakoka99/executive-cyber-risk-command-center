/**
 * Role-based access aligned to DWAN consolidated schema `role_capabilities`
 * and ECC product context. Demo HTML permissions that conflict with the DB
 * are overridden — see docs/CONFLICT_RESOLUTIONS.md.
 */

export const ROLE_CODES = [
  "board_member",
  "cxo",
  "ciso",
  "risk_lead",
  "domain_analyst",
  "program_office",
  "auditor",
  "admin",
  // Legacy aliases mapped at the edge for older seeded users
  "risk_manager",
  "security_analyst",
  "soc_analyst",
  "org_admin",
  "super_admin",
  "platform_admin",
  "compliance_manager",
  "business_owner",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/** Canonical 8 DWAN roles. */
export const DWAN_ROLES = [
  "board_member",
  "cxo",
  "ciso",
  "risk_lead",
  "domain_analyst",
  "program_office",
  "auditor",
  "admin",
] as const;

export type DwanRole = (typeof DWAN_ROLES)[number];

export const PERMISSIONS = [
  "command.headline",
  "command.posture",
  "command.posture.technical",
  "command.trust",
  "command.loss",
  "command.queue",
  "command.queue.act",
  "command.whatif",
  "command.whatif.save",
  "command.closure",
  "command.closure.verify",
  "command.closure.register",
  "command.changed",
  "command.pack",
  "command.pack.review",
  "command.pack.approve",
  "ops.overview",
  "domains.read",
  "domains.technical",
  "findings.read",
  "findings.technical",
  "decisions.read",
  "decisions.act",
  "compliance.read",
  "reports.read",
  "reports.generate",
  "audit.read",
  "ingestion.read",
  "scenarios.read",
  "scenarios.act",
  "policy.read",
  "policy.propose",
  "policy.approve",
  "command.queue.accept",
  "admin.users",
  "admin.roles",
  "register.read",
  "remediation.read",
  "remediation.act",
  "connectors.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type ViewId =
  | "headline"
  | "posture"
  | "trust"
  | "queue"
  | "whatif"
  | "closure"
  | "changed"
  | "pack";

export const VIEW_PERMISSION: Record<ViewId, Permission> = {
  headline: "command.headline",
  posture: "command.posture",
  trust: "command.trust",
  queue: "command.queue",
  whatif: "command.whatif",
  closure: "command.closure",
  changed: "command.changed",
  pack: "command.pack",
};

export const VIEW_LABEL: Record<ViewId, string> = {
  headline: "Headline",
  posture: "Posture",
  trust: "Trust",
  queue: "Queue",
  whatif: "What-if",
  closure: "Closure",
  changed: "Changed",
  pack: "Pack",
};

/** Map legacy / alternate role codes onto the DWAN eight. */
export function canonicalRole(role: string): DwanRole {
  switch (role) {
    case "risk_manager":
    case "risk_lead":
      return "risk_lead";
    case "security_analyst":
    case "soc_analyst":
    case "domain_analyst":
      return "domain_analyst";
    case "org_admin":
    case "super_admin":
    case "platform_admin":
    case "admin":
      return "admin";
    case "compliance_manager":
    case "program_office":
      return "program_office";
    case "business_owner":
      return "cxo";
    case "board_member":
    case "cxo":
    case "ciso":
    case "auditor":
      return role;
    default:
      return "domain_analyst";
  }
}

/**
 * Who may sign risk acceptances.
 * Default matches DB role_capabilities: CxO and Risk Lead.
 * Override with ACCEPT_RISK_ROLES=cxo (comma-separated) if needed.
 */
export function acceptRiskRoles(): DwanRole[] {
  const raw = process.env.ACCEPT_RISK_ROLES?.trim();
  if (!raw) return ["cxo", "risk_lead"];
  return raw
    .split(",")
    .map((r) => canonicalRole(r.trim()))
    .filter((r, i, arr) => arr.indexOf(r) === i);
}

export function canAcceptRisk(role: string): boolean {
  return acceptRiskRoles().includes(canonicalRole(role));
}

/** DB role_capabilities → app permissions. */
const DWAN_PERMISSIONS: Record<DwanRole, Permission[]> = {
  board_member: [
    "command.headline",
    "command.posture",
    "command.loss",
    "command.changed",
    "command.pack",
    "command.pack.review",
    "ops.overview",
    "compliance.read",
    "reports.read",
    "decisions.read",
    "policy.read",
    "policy.approve",
  ],
  cxo: [
    "command.headline",
    "command.posture",
    "command.loss",
    "command.queue",
    "command.queue.act",
    "command.whatif",
    "command.whatif.save",
    "command.closure",
    "command.closure.register",
    "command.changed",
    "command.pack",
    "command.pack.review",
    "command.pack.approve",
    "ops.overview",
    "domains.read",
    "findings.read",
    "decisions.read",
    "decisions.act",
    "compliance.read",
    "reports.read",
    "reports.generate",
    "scenarios.read",
    "scenarios.act",
    "audit.read",
    "policy.read",
    "policy.approve",
    "register.read",
    "remediation.read",
  ],
  ciso: [
    "command.headline",
    "command.posture",
    "command.posture.technical",
    "command.trust",
    "command.loss",
    "command.queue",
    "command.queue.act",
    "command.whatif",
    "command.whatif.save",
    "command.closure",
    "command.closure.verify",
    "command.changed",
    "command.pack",
    "command.pack.review",
    "ops.overview",
    "domains.read",
    "domains.technical",
    "findings.read",
    "findings.technical",
    "decisions.read",
    "decisions.act",
    "compliance.read",
    "reports.read",
    "reports.generate",
    "audit.read",
    "ingestion.read",
    "scenarios.read",
    "scenarios.act",
    "policy.read",
    "policy.propose",
    "register.read",
    "remediation.read",
    "remediation.act",
    "connectors.read",
  ],
  risk_lead: [
    "command.headline",
    "command.posture",
    "command.posture.technical",
    "command.trust",
    "command.loss",
    "command.queue",
    "command.closure",
    "command.closure.verify",
    "command.changed",
    "command.pack",
    "command.pack.review",
    "ops.overview",
    "domains.read",
    "domains.technical",
    "findings.read",
    "findings.technical",
    "decisions.read",
    "compliance.read",
    "reports.read",
    "audit.read",
    "ingestion.read",
    "scenarios.read",
    "policy.read",
    "register.read",
    "remediation.read",
    "remediation.act",
    "connectors.read",
  ],
  domain_analyst: [
    "command.posture",
    "command.posture.technical",
    "command.trust",
    "command.queue",
    "command.closure",
    "command.closure.verify",
    "ops.overview",
    "domains.read",
    "domains.technical",
    "findings.read",
    "findings.technical",
    "ingestion.read",
    "scenarios.read",
    "register.read",
    "remediation.read",
    "remediation.act",
    "connectors.read",
  ],
  program_office: [
    "command.headline",
    "command.changed",
    "command.pack",
    "command.pack.review",
    "ops.overview",
    "compliance.read",
    "reports.read",
    "reports.generate",
    "decisions.read",
    "policy.read",
  ],
  auditor: [
    "command.headline",
    "command.posture",
    "command.posture.technical",
    "command.loss",
    "command.changed",
    "command.pack",
    "ops.overview",
    "audit.read",
    "compliance.read",
    "reports.read",
    "decisions.read",
    "register.read",
    "policy.read",
  ],
  admin: ["admin.users", "admin.roles", "audit.read"],
};

/** Grant accept-risk permissions only (not general Decide / queue.act). */
function withAccept(role: DwanRole, perms: Permission[]): Permission[] {
  const out = new Set(perms);
  if (canAcceptRisk(role)) {
    out.add("command.closure.register");
    out.add("command.queue.accept");
  }
  return [...out];
}

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  board_member: DWAN_PERMISSIONS.board_member,
  cxo: withAccept("cxo", DWAN_PERMISSIONS.cxo),
  ciso: DWAN_PERMISSIONS.ciso,
  risk_lead: withAccept("risk_lead", DWAN_PERMISSIONS.risk_lead),
  domain_analyst: DWAN_PERMISSIONS.domain_analyst,
  program_office: DWAN_PERMISSIONS.program_office,
  auditor: DWAN_PERMISSIONS.auditor,
  admin: DWAN_PERMISSIONS.admin,
  risk_manager: withAccept("risk_lead", DWAN_PERMISSIONS.risk_lead),
  security_analyst: DWAN_PERMISSIONS.domain_analyst,
  soc_analyst: DWAN_PERMISSIONS.domain_analyst,
  org_admin: DWAN_PERMISSIONS.admin,
  super_admin: [...new Set([...DWAN_PERMISSIONS.ciso, ...DWAN_PERMISSIONS.admin])],
  platform_admin: [...new Set([...DWAN_PERMISSIONS.ciso, ...DWAN_PERMISSIONS.admin])],
  compliance_manager: DWAN_PERMISSIONS.program_office,
  business_owner: withAccept("cxo", DWAN_PERMISSIONS.cxo),
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  board_member: "Board Member",
  cxo: "CxO",
  ciso: "CISO",
  risk_lead: "Risk Lead",
  domain_analyst: "Analyst",
  program_office: "Program Office",
  auditor: "Auditor",
  admin: "Admin",
  risk_manager: "Risk Lead",
  security_analyst: "Analyst",
  soc_analyst: "SOC Analyst",
  org_admin: "Admin",
  super_admin: "Super Admin",
  platform_admin: "Platform Admin",
  compliance_manager: "Compliance",
  business_owner: "Business Owner",
};

export const CAPABILITY: Record<RoleCode, string> = {
  board_member:
    "You can view risk posture, trends, financial exposure and the board pack. You approve scoring policy and appetite proposals. Technical feeds and what-if are outside this role.",
  cxo: "You can approve decisions, accept risk with an expiry, and run what-if funding against expected loss.",
  ciso: "You can see technical evidence, assign owners, propose scoring policy and appetite, and verify closures. Board locks approved versions.",
  risk_lead:
    "You can accept risk with an expiry, manage the acceptance register, run verification scans and the audit trail. General Decide stays with CxO/CISO.",
  domain_analyst:
    "You can verify findings, inspect feed confidence and open technical evidence. Money and approvals are outside this role.",
  program_office: "You prepare the board pack and compliance reports. Technical verification stays with security.",
  auditor: "You can read the audit trail, compliance evidence and packs. You cannot change decisions.",
  admin: "You manage users and roles for this organization. Cyber decisions are outside this role.",
  risk_manager:
    "You manage the acceptance register, verification scans and the audit trail.",
  security_analyst:
    "You can verify findings, inspect feed confidence and open technical evidence. Money is masked.",
  soc_analyst: "You can verify findings and inspect feed confidence. Money is masked.",
  org_admin: "You manage users and roles for this organization.",
  super_admin: "Full platform access including administration.",
  platform_admin: "Full platform access including administration.",
  compliance_manager: "You review framework posture and the board pack.",
  business_owner: "You can see business-impact exposure and funding what-if.",
};

export const LANDING: Record<RoleCode, ViewId> = {
  board_member: "headline",
  cxo: "queue",
  ciso: "posture",
  risk_lead: "closure",
  domain_analyst: "trust",
  program_office: "pack",
  auditor: "changed",
  admin: "headline",
  risk_manager: "closure",
  security_analyst: "trust",
  soc_analyst: "trust",
  org_admin: "headline",
  super_admin: "headline",
  platform_admin: "headline",
  compliance_manager: "headline",
  business_owner: "headline",
};

export function isRoleCode(value: string): value is RoleCode {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value);
}

export function hasPermission(role: string, permission: Permission): boolean {
  const canon = canonicalRole(role);
  // Prefer canonical DWAN matrix so legacy aliases stay consistent
  const list = ROLE_PERMISSIONS[canon] ?? ROLE_PERMISSIONS[role as RoleCode];
  return !!list?.includes(permission);
}

export function permissionsFor(role: string): Permission[] {
  const canon = canonicalRole(role);
  return [...(ROLE_PERMISSIONS[canon] ?? [])];
}

export function viewsFor(role: string): ViewId[] {
  return (Object.keys(VIEW_PERMISSION) as ViewId[]).filter((view) =>
    hasPermission(role, VIEW_PERMISSION[view]),
  );
}

export function landingFor(role: string): ViewId {
  const views = viewsFor(role);
  const canon = canonicalRole(role);
  if (views.includes(LANDING[canon])) return LANDING[canon];
  return views[0] ?? "headline";
}

export function homeFor(role: string): string {
  if (hasPermission(role, "admin.users") && viewsFor(role).length === 0) return "/admin";
  const landing = landingFor(role);
  if (!hasPermission(role, VIEW_PERMISSION[landing])) {
    if (hasPermission(role, "admin.users")) return "/admin";
    if (hasPermission(role, "compliance.read")) return "/compliance";
    if (hasPermission(role, "audit.read")) return "/audit";
    return "/";
  }
  return `/c/${landing}`;
}

export function capabilityFor(role: string): string {
  const canon = canonicalRole(role);
  return CAPABILITY[canon] ?? "This role has no command-center permissions.";
}

export function maxAcceptanceDays(severity: string): number {
  return severity === "critical" || severity === "Critical" ? 90 : 365;
}

export function requiredPermission(method: string, path: string): Permission | "self" | null {
  const url = path.split("?")[0] ?? path;
  if (url === "/health" || url.startsWith("/api/ecc/organizations") || url === "/api/ecc/me") {
    return null;
  }
  if (url.startsWith("/api/ecc/command") || url.startsWith("/api/ecc/admin") || url.startsWith("/api/ecc/dwan")) {
    return "self";
  }
  if (url.startsWith("/api/ecc/findings")) return "findings.read";
  if (url.startsWith("/api/ecc/register")) return "register.read";
  if (url.startsWith("/api/ecc/risk-domains")) return "domains.read";
  if (url.startsWith("/api/ecc/decisions")) {
    return method === "GET" ? "decisions.read" : "decisions.act";
  }
  if (url.startsWith("/api/ecc/compliance") || url.startsWith("/api/ecc/controls")) {
    return "compliance.read";
  }
  if (url.startsWith("/api/ecc/audit")) return "audit.read";
  if (url.startsWith("/api/ecc/policy") || url.startsWith("/api/ecc/appetite")) {
    if (method === "GET") return "policy.read";
    // Approve / lock endpoints require approve_policy; drafts use propose.
    if (/\/(approve|lock)\b/i.test(url) || /[?&]action=approve\b/i.test(path)) {
      return "policy.approve";
    }
    return "policy.propose";
  }
  if (url.startsWith("/api/ecc/remediation")) {
    return method === "GET" ? "remediation.read" : "remediation.act";
  }
  if (url.startsWith("/api/ecc/reports")) {
    return method === "GET" ? "reports.read" : "reports.generate";
  }
  if (url.startsWith("/api/ecc/connectors")) return "connectors.read";
  if (url.startsWith("/api/ecc/ingestion") || url.startsWith("/api/ecc/signals")) {
    return "ingestion.read";
  }
  if (url.startsWith("/api/ecc/scenarios") || url.startsWith("/api/ecc/portfolio")) {
    return method === "GET" ? "scenarios.read" : "scenarios.act";
  }
  if (url.startsWith("/api/ecc/actions")) return "remediation.act";
  if (
    url === "/api/ecc/overview" ||
    url.startsWith("/api/ecc/trends") ||
    url.startsWith("/api/ecc/hotspots") ||
    url.startsWith("/api/ecc/decision-center") ||
    url.startsWith("/api/ecc/executive-briefing") ||
    url.startsWith("/api/ecc/material-changes") ||
    url.startsWith("/api/ecc/activity") ||
    url.startsWith("/api/ecc/org/") ||
    url.startsWith("/api/ecc/demo")
  ) {
    return method === "GET" ? "ops.overview" : "scenarios.act";
  }
  if (url.startsWith("/api/ecc")) return "ops.overview";
  return null;
}

const FINANCIAL_KEY = /(aed|financial|exposure|^loss$|loss[A-Z]|expectedLoss|ale|p90|p95)/i;

export function redactFinancial<T>(role: string, value: T): T {
  // command.loss mirrors view_financials
  if (hasPermission(role, "command.loss")) return value;
  return stripFinancial(value) as T;
}

function stripFinancial(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFinancial);
  if (!value || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = FINANCIAL_KEY.test(key) ? null : stripFinancial(child);
  }
  return copy;
}

export function redactFinding<T extends Record<string, unknown>>(role: string, finding: T): T {
  const copy: Record<string, unknown> = { ...redactFinancial(role, finding) };
  if (!hasPermission(role, "findings.technical")) {
    delete copy.rawPayload;
    delete copy.description;
    if (copy.affectedAsset) copy.affectedAsset = "Restricted";
  }
  return copy as T;
}
