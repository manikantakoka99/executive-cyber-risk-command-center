/**
 * In-memory scoring policy + appetite (DWAN rules for the command demo path).
 * CISO proposes; Board (approve_policy) locks; proposer ≠ approver; approved versions immutable.
 */
import { hasPermission } from "./rbac.js";

export type PolicyStatus = "draft" | "approved" | "retired";

export interface PolicyVersion {
  policyId: string;
  version: number;
  status: PolicyStatus;
  unobservedDefault: number;
  bandMediumMin: number;
  bandHighMin: number;
  bandCriticalMin: number;
  floorEnabled: boolean;
  floorBand: "high" | "critical";
  notes: string;
  proposedByUserId: string | null;
  proposedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  effectiveFrom: string | null;
  createdAt: string;
}

export interface AppetiteRow {
  appetiteId: string;
  domainCode: string | null; // null = enterprise
  domainName: string;
  maxScore: number;
  status: "draft" | "approved";
  proposedByUserId: string | null;
  proposedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  effectiveFrom: string;
  reviewDate: string;
  rationale: string;
}

interface OrgPolicyState {
  policies: PolicyVersion[];
  appetites: AppetiteRow[];
  nextPolicyVersion: number;
}

const byOrg = new Map<string, OrgPolicyState>();

const DOMAIN_APPETITE: { code: string | null; name: string; max: number }[] = [
  { code: null, name: "Enterprise", max: 50 },
  { code: "att", name: "Attack Surface (VAPT/ASM)", max: 40 },
  { code: "soc", name: "SOC / MDR", max: 45 },
  { code: "tpr", name: "Third-Party Risk", max: 50 },
  { code: "ran", name: "Ransomware Readiness", max: 40 },
  { code: "pci", name: "PCI DSS / Data Trust", max: 35 },
  { code: "ai", name: "AI Governance", max: 55 },
  { code: "iam", name: "IAM / PAM", max: 45 },
  { code: "phish", name: "Phishing / BEC", max: 40 },
];

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function seed(_orgId: string): OrgPolicyState {
  const approved: PolicyVersion = {
    policyId: id("pol"),
    version: 1,
    status: "approved",
    unobservedDefault: 60,
    bandMediumMin: 35,
    bandHighMin: 55,
    bandCriticalMin: 70,
    floorEnabled: true,
    floorBand: "high",
    notes: "Board-approved baseline (sample).",
    proposedByUserId: "c1500001-a090-41a0-8ecc-000000000001",
    proposedByName: "Layla Al Hashimi, CISO",
    approvedByUserId: "c1500001-a090-41a0-8ecc-000000000006",
    approvedByName: "Hessa Al Ketbi, Board Member",
    approvedAt: "2026-08-06T00:00:00.000Z",
    effectiveFrom: "2026-08-06T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  return {
    nextPolicyVersion: 2,
    policies: [approved],
    appetites: DOMAIN_APPETITE.map((d) => ({
      appetiteId: id("app"),
      domainCode: d.code,
      domainName: d.name,
      maxScore: d.max,
      status: "approved" as const,
      proposedByUserId: "c1500001-a090-41a0-8ecc-000000000001",
      proposedByName: "Layla Al Hashimi, CISO",
      approvedByUserId: "c1500001-a090-41a0-8ecc-000000000006",
      approvedByName: "Hessa Al Ketbi, Board Member",
      approvedAt: "2026-01-01T00:00:00.000Z",
      effectiveFrom: "2026-01-01",
      reviewDate: "2027-01-01",
      rationale: "Board appetite for Al Dhabi Holdings (sample).",
    })),
  };
}

function getOrg(orgId: string): OrgPolicyState {
  let state = byOrg.get(orgId);
  if (!state) {
    state = seed(orgId);
    byOrg.set(orgId, state);
  }
  return state;
}

export function listPolicyBundle(orgId: string) {
  const state = getOrg(orgId);
  const active = state.policies.find((p) => p.status === "approved") ?? null;
  return {
    active,
    versions: [...state.policies].sort((a, b) => b.version - a.version),
    appetites: state.appetites,
    rules: {
      proposeRoles: ["ciso"],
      approveRoles: ["board_member", "cxo"],
      proposerCannotApprove: true,
      approvedVersionsImmutable: true,
    },
  };
}

export function proposePolicy(
  orgId: string,
  role: string,
  actor: { userId: string; name: string },
  input: Partial<Pick<PolicyVersion, "notes" | "unobservedDefault" | "bandCriticalMin" | "bandHighMin" | "bandMediumMin" | "floorEnabled" | "floorBand">>,
): { ok: true; policy: PolicyVersion } | { ok: false; status: 403 | 400; message: string } {
  if (!hasPermission(role, "policy.propose")) {
    return { ok: false, status: 403, message: "Only roles with policy.propose (CISO) can draft scoring policy." };
  }
  const state = getOrg(orgId);
  if (state.policies.some((p) => p.status === "draft")) {
    return { ok: false, status: 400, message: "A draft policy already exists. Approve or retire it before proposing another." };
  }
  const base = state.policies.find((p) => p.status === "approved") ?? state.policies[0];
  const policy: PolicyVersion = {
    policyId: id("pol"),
    version: state.nextPolicyVersion++,
    status: "draft",
    unobservedDefault: input.unobservedDefault ?? base?.unobservedDefault ?? 60,
    bandMediumMin: input.bandMediumMin ?? base?.bandMediumMin ?? 35,
    bandHighMin: input.bandHighMin ?? base?.bandHighMin ?? 55,
    bandCriticalMin: input.bandCriticalMin ?? base?.bandCriticalMin ?? 70,
    floorEnabled: input.floorEnabled ?? base?.floorEnabled ?? true,
    floorBand: input.floorBand ?? base?.floorBand ?? "high",
    notes: input.notes?.trim() || "Draft scoring policy proposal.",
    proposedByUserId: actor.userId,
    proposedByName: actor.name,
    approvedByUserId: null,
    approvedByName: null,
    approvedAt: null,
    effectiveFrom: null,
    createdAt: new Date().toISOString(),
  };
  if (!(policy.bandMediumMin < policy.bandHighMin && policy.bandHighMin < policy.bandCriticalMin)) {
    return { ok: false, status: 400, message: "Band thresholds must satisfy medium < high < critical." };
  }
  state.policies.unshift(policy);
  return { ok: true, policy };
}

export function approvePolicy(
  orgId: string,
  role: string,
  actor: { userId: string; name: string },
  policyId: string,
): { ok: true; policy: PolicyVersion } | { ok: false; status: 403 | 400 | 404; message: string } {
  if (!hasPermission(role, "policy.approve")) {
    return { ok: false, status: 403, message: "Only roles with approve_policy (Board/CxO) can lock a policy version." };
  }
  const state = getOrg(orgId);
  const policy = state.policies.find((p) => p.policyId === policyId);
  if (!policy) return { ok: false, status: 404, message: "Policy version not found." };
  if (policy.status !== "draft") {
    return { ok: false, status: 400, message: "Only draft policies can be approved. Approved versions are immutable." };
  }
  if (!policy.proposedByUserId) {
    return { ok: false, status: 400, message: "proposed_by is required (CISO proposes, Board approves)." };
  }
  if (policy.proposedByUserId === actor.userId) {
    return { ok: false, status: 403, message: "The proposer cannot approve their own policy proposal." };
  }
  // Retire previous approved overlapping window
  for (const p of state.policies) {
    if (p.status === "approved") p.status = "retired";
  }
  const now = new Date().toISOString();
  policy.status = "approved";
  policy.approvedByUserId = actor.userId;
  policy.approvedByName = actor.name;
  policy.approvedAt = now;
  policy.effectiveFrom = now;
  return { ok: true, policy };
}

export function proposeAppetite(
  orgId: string,
  role: string,
  actor: { userId: string; name: string },
  input: { domainCode: string | null; maxScore: number; rationale?: string; reviewDate?: string },
): { ok: true; appetite: AppetiteRow } | { ok: false; status: 403 | 400; message: string } {
  if (!hasPermission(role, "policy.propose")) {
    return { ok: false, status: 403, message: "Only roles with policy.propose (CISO) can propose appetite." };
  }
  if (input.maxScore < 0 || input.maxScore > 100) {
    return { ok: false, status: 400, message: "maxScore must be between 0 and 100." };
  }
  const state = getOrg(orgId);
  const meta = DOMAIN_APPETITE.find((d) => d.code === input.domainCode) ?? {
    code: input.domainCode,
    name: input.domainCode ?? "Enterprise",
    max: input.maxScore,
  };
  // Replace any existing draft for same domain
  state.appetites = state.appetites.filter(
    (a) => !(a.status === "draft" && a.domainCode === input.domainCode),
  );
  const appetite: AppetiteRow = {
    appetiteId: id("app"),
    domainCode: input.domainCode,
    domainName: meta.name,
    maxScore: input.maxScore,
    status: "draft",
    proposedByUserId: actor.userId,
    proposedByName: actor.name,
    approvedByUserId: null,
    approvedByName: null,
    approvedAt: null,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    reviewDate: input.reviewDate ?? "2027-01-01",
    rationale: input.rationale?.trim() || "Proposed board appetite change.",
  };
  state.appetites.unshift(appetite);
  return { ok: true, appetite };
}

export function approveAppetite(
  orgId: string,
  role: string,
  actor: { userId: string; name: string },
  appetiteId: string,
): { ok: true; appetite: AppetiteRow } | { ok: false; status: 403 | 400 | 404; message: string } {
  if (!hasPermission(role, "policy.approve")) {
    return { ok: false, status: 403, message: "Only roles with approve_policy (Board/CxO) can lock appetite." };
  }
  const state = getOrg(orgId);
  const appetite = state.appetites.find((a) => a.appetiteId === appetiteId);
  if (!appetite) return { ok: false, status: 404, message: "Appetite proposal not found." };
  if (appetite.status !== "draft") {
    return { ok: false, status: 400, message: "Only draft appetite proposals can be approved." };
  }
  if (appetite.proposedByUserId && appetite.proposedByUserId === actor.userId) {
    return { ok: false, status: 403, message: "The proposer cannot approve their own appetite proposal." };
  }
  // Drop prior approved for same domain
  state.appetites = state.appetites.filter(
    (a) => !(a.status === "approved" && a.domainCode === appetite.domainCode && a.appetiteId !== appetite.appetiteId),
  );
  appetite.status = "approved";
  appetite.approvedByUserId = actor.userId;
  appetite.approvedByName = actor.name;
  appetite.approvedAt = new Date().toISOString();
  return { ok: true, appetite };
}
