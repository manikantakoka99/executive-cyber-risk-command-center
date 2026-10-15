/**
 * Quiet Command nav: one list per role, duplicates merged, hard caps.
 * Decisions ← queue+decisions; Posture ← posture+risk-domains;
 * Remediation & closure ← closure+remediation.
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
  { to: "/intelligence", label: "Intelligence", perm: "scenarios.read", hint: "Enterprise intel" },
  { to: "/scenarios", label: "Risk scenarios", perm: "scenarios.read", hint: "Correlated risk" },
  { to: "/findings", label: "Findings", perm: "findings.read", hint: "Open findings" },
  { to: "/register", label: "Risk register", perm: "register.read", hint: "Combined register" },
  { to: "/connectors", label: "Connectors", perm: "connectors.read", hint: "Feed health" },
  { to: "/policy", label: "Policy & appetite", perm: "policy.read", hint: "Scoring policy" },
  { to: "/compliance", label: "Compliance", perm: "compliance.read", hint: "Frameworks" },
  { to: "/reports", label: "Reports", perm: "reports.read", hint: "Generated reports" },
  { to: "/audit", label: "Audit", perm: "audit.read", hint: "Audit trail" },
  { to: "/ingestion", label: "Ingestion", perm: "ingestion.read", hint: "Sample workbook" },
  { to: "/admin", label: "Users and roles", perm: "admin.users", hint: "RBAC admin" },
];

const MERGED_AWAY = new Set(["/decisions", "/risk-domains", "/remediation"]);

/** Pep + Quiet Command: Board 4, CxO 5 (money/decisions), CISO ≤10. */
const ROLE_NAV: Record<string, { max: number; prefer: string[]; strict?: boolean }> = {
  board_member: {
    max: 4,
    prefer: ["/c/headline", "/c/posture", "/c/changed", "/c/pack"],
    strict: true,
  },
  cxo: {
    max: 5,
    // Money + decisions only — strict prefer list, no filler items.
    prefer: ["/c/headline", "/c/queue", "/c/whatif", "/c/pack", "/c/changed"],
    strict: true,
  },
  ciso: {
    max: 10,
    prefer: [
      "/c/posture",
      "/c/trust",
      "/c/queue",
      "/c/whatif",
      "/c/closure",
      "/c/headline",
      "/c/changed",
      "/c/pack",
      "/connectors",
      "/policy",
    ],
  },
  risk_lead: {
    max: 10,
    prefer: [
      "/c/posture",
      "/c/trust",
      "/c/queue",
      "/c/closure",
      "/c/headline",
      "/c/changed",
      "/c/pack",
      "/findings",
      "/connectors",
      "/register",
    ],
  },
  domain_analyst: {
    max: 8,
    prefer: [
      "/c/trust",
      "/c/posture",
      "/c/queue",
      "/c/closure",
      "/findings",
      "/connectors",
      "/ingestion",
      "/register",
    ],
  },
  program_office: {
    max: 8,
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
    max: 8,
    prefer: [
      "/c/changed",
      "/c/headline",
      "/c/posture",
      "/c/pack",
      "/audit",
      "/compliance",
      "/findings",
      "/connectors",
    ],
  },
  admin: {
    max: 4,
    prefer: ["/admin", "/audit", "/operations", "/c/headline"],
  },
};

export function navForRole(role: string, permissions: string[]): NavItem[] {
  const perms = new Set(permissions);
  const allowed = ALL.filter((item) => perms.has(item.perm) && !MERGED_AWAY.has(item.to));
  const plan = ROLE_NAV[role];
  if (!plan) return allowed.slice(0, 10);

  const byPath = new Map(allowed.map((item) => [item.to, item]));
  const picked: NavItem[] = [];
  for (const path of plan.prefer) {
    const item = byPath.get(path);
    if (item) {
      picked.push(item);
      byPath.delete(path);
    }
    if (picked.length >= plan.max) return picked;
  }
  if (plan.strict) return picked;
  for (const item of byPath.values()) {
    if (picked.length >= plan.max) break;
    picked.push(item);
  }
  return picked;
}
