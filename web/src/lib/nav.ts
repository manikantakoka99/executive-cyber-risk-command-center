/**
 * Nav built from role permissions, ordered by prefer lists.
 * Decisions ← queue+decisions; Posture keeps domain detail via /risk-domains when permitted.
 * Labels must match command VIEW_LABEL (Decisions, Remediation & closure).
 */
export type NavItem = {
  to: string;
  label: string;
  perm: string;
  hint: string;
};

const ALL: NavItem[] = [
  { to: "/c/headline", label: "Headline", perm: "command.headline", hint: "Are we OK?" },
  { to: "/c/posture", label: "Posture", perm: "command.posture", hint: "Weakest domains" },
  { to: "/c/trust", label: "Trust", perm: "command.trust", hint: "Feed confidence" },
  { to: "/c/queue", label: "Decisions", perm: "command.queue", hint: "Approvals" },
  { to: "/c/whatif", label: "What-if", perm: "command.whatif", hint: "Funding scenarios" },
  { to: "/c/closure", label: "Remediation & closure", perm: "command.closure", hint: "Verify fixes" },
  { to: "/c/changed", label: "Changed", perm: "command.changed", hint: "Since last board" },
  { to: "/c/pack", label: "Pack", perm: "command.pack", hint: "Export brief" },
  { to: "/operations", label: "Operations", perm: "ops.overview", hint: "Live overview" },
  { to: "/intelligence", label: "Intelligence", perm: "intelligence.read", hint: "Enterprise intel" },
  { to: "/scenarios", label: "Scenarios", perm: "scenarios.read", hint: "Correlated risk" },
  { to: "/findings", label: "Findings", perm: "findings.read", hint: "Open findings" },
  { to: "/risk-domains", label: "Risk domains", perm: "domains.read", hint: "Domain detail" },
  { to: "/register", label: "Register", perm: "register.read", hint: "Combined register" },
  { to: "/connectors", label: "Connectors", perm: "connectors.read", hint: "Feed health" },
  { to: "/ingestion", label: "Ingestion", perm: "ingestion.read", hint: "Sample workbook" },
  { to: "/policy", label: "Policy & appetite", perm: "policy.read", hint: "Scoring policy" },
  { to: "/compliance", label: "Compliance", perm: "compliance.read", hint: "Frameworks" },
  { to: "/reports", label: "Reports", perm: "reports.read", hint: "Generated reports" },
  { to: "/audit", label: "Audit", perm: "audit.read", hint: "Audit trail" },
  { to: "/admin", label: "Users and roles", perm: "admin.users", hint: "RBAC admin" },
];

/** Legacy paths merged into command views — never show as separate nav. */
const MERGED_AWAY = new Set(["/decisions", "/remediation"]);

/** Prefer order only; Board/CxO stay strict + capped. Others list all permitted items. */
const ROLE_NAV: Record<string, { max?: number; prefer: string[]; strict?: boolean }> = {
  board_member: {
    max: 4,
    prefer: ["/c/headline", "/c/posture", "/c/changed", "/c/pack"],
    strict: true,
  },
  cxo: {
    max: 6,
    prefer: ["/c/headline", "/operations", "/c/queue", "/c/whatif", "/c/pack", "/c/changed"],
    strict: true,
  },
  ciso: {
    prefer: [
      "/c/posture",
      "/c/trust",
      "/c/queue",
      "/c/whatif",
      "/c/closure",
      "/c/headline",
      "/operations",
      "/intelligence",
      "/scenarios",
      "/findings",
      "/risk-domains",
      "/register",
      "/ingestion",
      "/compliance",
      "/reports",
      "/audit",
      "/c/changed",
      "/c/pack",
      "/connectors",
      "/policy",
    ],
  },
  risk_lead: {
    prefer: [
      "/c/posture",
      "/c/trust",
      "/c/queue",
      "/c/closure",
      "/c/headline",
      "/findings",
      "/register",
      "/connectors",
      "/c/changed",
      "/c/pack",
    ],
  },
  domain_analyst: {
    prefer: [
      "/c/trust",
      "/c/posture",
      "/c/queue",
      "/c/closure",
      "/findings",
      "/risk-domains",
      "/connectors",
      "/ingestion",
      "/register",
      "/scenarios",
    ],
  },
  program_office: {
    prefer: [
      "/c/pack",
      "/c/headline",
      "/c/changed",
      "/compliance",
      "/reports",
      "/policy",
      "/operations",
      "/audit",
    ],
  },
  auditor: {
    prefer: [
      "/c/changed",
      "/c/headline",
      "/c/posture",
      "/c/pack",
      "/audit",
      "/compliance",
      "/findings",
      "/risk-domains",
      "/scenarios",
      "/connectors",
    ],
  },
  admin: {
    max: 4,
    prefer: ["/admin", "/audit", "/operations", "/c/headline"],
    strict: true,
  },
};

export function navForRole(role: string, permissions: string[]): NavItem[] {
  const perms = new Set(permissions);
  const allowed = ALL.filter((item) => perms.has(item.perm) && !MERGED_AWAY.has(item.to));
  const plan = ROLE_NAV[role];
  if (!plan) return allowed;

  const byPath = new Map(allowed.map((item) => [item.to, item]));
  const picked: NavItem[] = [];
  for (const path of plan.prefer) {
    const item = byPath.get(path);
    if (item) {
      picked.push(item);
      byPath.delete(path);
    }
    if (plan.max != null && picked.length >= plan.max) return picked;
  }
  if (plan.strict) return picked;
  // Remaining permitted items (permission-built nav).
  for (const item of byPath.values()) {
    if (plan.max != null && picked.length >= plan.max) break;
    picked.push(item);
  }
  return picked;
}
