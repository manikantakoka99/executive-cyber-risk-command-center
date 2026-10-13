/**
 * Role-based access for the command center and operational APIs.
 * Code is the enforcement source of truth (demo and hosted).
 */

export const ROLE_CODES = [
  "ciso",
  "cxo",
  "board_member",
  "security_analyst",
  "soc_analyst",
  "risk_manager",
  "org_admin",
  "super_admin",
  "platform_admin",
  "compliance_manager",
  "program_office",
  "domain_analyst",
  "auditor",
  "business_owner",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

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
  "admin.users",
  "admin.roles",
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
  headline: "Board headline",
  posture: "Domain posture",
  trust: "Trust panel",
  queue: "Decision queue",
  whatif: "What-if",
  closure: "Closure and acceptance",
  changed: "What changed",
  pack: "Board pack",
};

const ALL = [...PERMISSIONS];

const CISO: Permission[] = ALL.filter(
  (p) => p !== "admin.users" && p !== "admin.roles",
);

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ciso: CISO,
  super_admin: ALL,
  platform_admin: ALL,
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
  ],
  board_member: [
    "command.headline",
    "command.posture",
    "command.loss",
    "command.changed",
    "command.pack",
    "ops.overview",
    "compliance.read",
    "reports.read",
    "decisions.read",
  ],
  security_analyst: [
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
  ],
  soc_analyst: [
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
  ],
  risk_manager: [
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
    "ops.overview",
    "domains.read",
    "domains.technical",
    "findings.read",
    "findings.technical",
    "decisions.read",
    "decisions.act",
    "compliance.read",
    "reports.read",
    "audit.read",
    "ingestion.read",
    "scenarios.read",
    "scenarios.act",
  ],
  org_admin: ["admin.users", "admin.roles", "audit.read"],
  compliance_manager: [
    "command.headline",
    "command.posture",
    "command.changed",
    "command.pack",
    "ops.overview",
    "compliance.read",
    "reports.read",
    "reports.generate",
    "audit.read",
    "decisions.read",
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
    "decisions.act",
    "scenarios.read",
  ],
  domain_analyst: [
    "command.posture",
    "command.posture.technical",
    "command.trust",
    "ops.overview",
    "domains.read",
    "domains.technical",
    "findings.read",
    "findings.technical",
    "ingestion.read",
  ],
  auditor: [
    "command.headline",
    "command.changed",
    "command.pack",
    "ops.overview",
    "audit.read",
    "compliance.read",
    "reports.read",
    "decisions.read",
  ],
  business_owner: [
    "command.headline",
    "command.loss",
    "command.whatif",
    "ops.overview",
    "decisions.read",
    "domains.read",
  ],
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  ciso: "CISO",
  cxo: "CxO",
  board_member: "Board Member",
  security_analyst: "Security Analyst",
  soc_analyst: "SOC Analyst",
  risk_manager: "Risk Lead",
  org_admin: "Admin",
  super_admin: "Super Admin",
  platform_admin: "Platform Admin",
  compliance_manager: "Compliance",
  program_office: "Program Office",
  domain_analyst: "Domain Analyst",
  auditor: "Auditor",
  business_owner: "Business Owner",
};

export const CAPABILITY: Record<RoleCode, string> = {
  board_member:
    "You can view risk posture, trends, financial exposure and the compliance summary. Approvals and technical evidence are outside this role.",
  cxo: "You can approve, accept risk with an expiry, and run what-if funding against expected loss. Feed-level evidence stays with the security team.",
  ciso: "You can see full operational and technical detail, incidents, vulnerabilities, controls, and you can assign owners or propose policy changes.",
  risk_manager:
    "You can manage the acceptance register, act on the decision queue, run what-if, and view the audit trail.",
  security_analyst:
    "You can verify findings, inspect feed confidence, and open technical evidence. Financial approvals are outside this role.",
  soc_analyst:
    "You can work detection coverage, the decision queue, and verification scans. Board financials and approvals are outside this role.",
  org_admin:
    "You manage users and roles for this organization. Cyber decisions and vulnerability detail are outside this role.",
  super_admin: "You have full platform access, including user administration and every command view.",
  platform_admin: "You have full platform access, including user administration and every command view.",
  compliance_manager:
    "You can review framework posture, the board pack, and what changed since the last meeting.",
  program_office:
    "You can prepare the board pack and regulatory reports. Technical verification stays with the security team.",
  domain_analyst:
    "You can drill into domain scores, coverage, and findings. Executive approvals are outside this role.",
  auditor:
    "You can read the audit trail, compliance evidence, and the board pack. You cannot change decisions.",
  business_owner:
    "You can see business-impact exposure and funding what-if for your enterprise view.",
};

export const LANDING: Record<RoleCode, ViewId> = {
  board_member: "headline",
  cxo: "queue",
  ciso: "posture",
  risk_manager: "closure",
  security_analyst: "trust",
  soc_analyst: "queue",
  org_admin: "headline",
  super_admin: "headline",
  platform_admin: "headline",
  compliance_manager: "headline",
  program_office: "pack",
  domain_analyst: "posture",
  auditor: "changed",
  business_owner: "headline",
};

export function isRoleCode(value: string): value is RoleCode {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value);
}

export function hasPermission(role: string, permission: Permission): boolean {
  if (!isRoleCode(role)) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: string): Permission[] {
  if (!isRoleCode(role)) return [];
  return [...ROLE_PERMISSIONS[role]];
}

export function viewsFor(role: string): ViewId[] {
  return (Object.keys(VIEW_PERMISSION) as ViewId[]).filter((view) =>
    hasPermission(role, VIEW_PERMISSION[view]),
  );
}

export function landingFor(role: string): ViewId {
  const views = viewsFor(role);
  if (isRoleCode(role) && views.includes(LANDING[role])) return LANDING[role];
  return views[0] ?? "headline";
}

export function homeFor(role: string): string {
  if (hasPermission(role, "admin.users") && viewsFor(role).length === 0) return "/admin";
  const landing = landingFor(role);
  if (!hasPermission(role, VIEW_PERMISSION[landing])) return "/admin";
  return `/c/${landing}`;
}

export function capabilityFor(role: string): string {
  if (!isRoleCode(role)) return "This role has no command-center permissions.";
  return CAPABILITY[role];
}

/** Map an HTTP path to the permission required to call it. Null means the route enforces itself. */
export function requiredPermission(method: string, path: string): Permission | "self" | null {
  const url = path.split("?")[0] ?? path;
  if (url === "/health" || url.startsWith("/api/ecc/organizations") || url === "/api/ecc/me") {
    return null;
  }
  if (url.startsWith("/api/ecc/command") || url.startsWith("/api/ecc/admin")) return "self";
  if (url.startsWith("/api/ecc/findings")) return "findings.read";
  if (url.startsWith("/api/ecc/risk-domains")) return "domains.read";
  if (url.startsWith("/api/ecc/decisions")) {
    return method === "GET" ? "decisions.read" : "decisions.act";
  }
  if (url.startsWith("/api/ecc/compliance") || url.startsWith("/api/ecc/controls")) {
    return "compliance.read";
  }
  if (url.startsWith("/api/ecc/audit")) return "audit.read";
  if (url.startsWith("/api/ecc/reports")) {
    return method === "GET" ? "reports.read" : "reports.generate";
  }
  if (
    url.startsWith("/api/ecc/ingestion") ||
    url.startsWith("/api/ecc/connectors") ||
    url.startsWith("/api/ecc/signals")
  ) {
    return "ingestion.read";
  }
  if (url.startsWith("/api/ecc/scenarios") || url.startsWith("/api/ecc/portfolio")) {
    return method === "GET" ? "scenarios.read" : "scenarios.act";
  }
  if (url.startsWith("/api/ecc/actions")) return "findings.technical";
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

const FINANCIAL_KEY = /(aed|financial|exposure|^loss$|loss[A-Z]|expectedLoss)/i;

export function redactFinancial<T>(role: string, value: T): T {
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
