import {
  WHATIF_PRESETS,
  WHATIF_TODAY,
  daysFromSnapshot,
  daysUntil,
  describeScenario,
  type GapKey,
} from "./model.js";
import { canAcceptRisk, hasPermission, isRoleCode, type RoleCode } from "./rbac.js";

export type QueueState = "open" | "approved" | "accepted" | "deferred";

export interface QueueItem {
  id: string;
  domainId: string;
  title: string;
  kev: boolean;
  epss: string;
  asset: string;
  priority: number;
  recommendation: string;
  owner: string;
  sla: string;
  state: QueueState;
  until?: string;
}

export interface Acceptance {
  id: string;
  title: string;
  reason: string;
  approver: string;
  expires: string;
}

export interface FixItem {
  id: string;
  title: string;
  state: "fix_reported" | "verified_closed" | "reopened";
  attempts: number;
  willPass: boolean;
}

export interface SavedScenario {
  name: string;
  score: string;
  lossAvoided: string;
  cost: string;
  gaps: Record<GapKey, number>;
}

export interface WhatIfState {
  edr: number;
  siem: number;
  imm: number;
  dr: number;
  cost: string;
  preset: string | null;
}

export interface CommandState {
  queue: QueueItem[];
  accept: Acceptance[];
  fixes: FixItem[];
  decisions: string[];
  scenarios: SavedScenario[];
  whatif: WhatIfState;
  packReviewedBy: string | null;
}

const byOrg = new Map<string, CommandState>();

export function initialState(): CommandState {
  return {
    queue: [
      {
        id: "q1",
        domainId: "att",
        title: "Two critical, internet-facing CVEs on the customer-facing payment gateway",
        kev: true,
        epss: "0.84",
        asset: "Payments gateway (crown jewel, internet-facing)",
        priority: 1,
        recommendation: "CxO approves an emergency patch window outside the standard change cycle.",
        owner: "Head of Payments Engineering",
        sla: "7 days",
        state: "open",
      },
      {
        id: "q2",
        domainId: "soc",
        title: "Network detection covers only part of the critical segments",
        kev: false,
        epss: "n/a",
        asset: "Core and payment network segments",
        priority: 0.6,
        recommendation: "Extend NDR and UEBA sensors to the uncovered critical segments.",
        owner: "SOC Manager",
        sla: "30 days",
        state: "open",
      },
      {
        id: "q3",
        domainId: "tpr",
        title: "Critical vendors without a current security assessment",
        kev: false,
        epss: "n/a",
        asset: "Tier 1 vendor register",
        priority: 0.5,
        recommendation: "Complete the overdue assessments and set contract security clauses.",
        owner: "Head of Procurement",
        sla: "30 days",
        state: "open",
      },
      {
        id: "q4",
        domainId: "ran",
        title: "Only 7 of 28 recovery tests met their target",
        kev: false,
        epss: "n/a",
        asset: "Backup and recovery estate",
        priority: 0.7,
        recommendation: "Fund a recovery-testing programme (see What-if, scenario B).",
        owner: "Head of Infrastructure",
        sla: "90 days",
        state: "open",
      },
    ],
    accept: [
      {
        id: "a1",
        title: "Legacy HR portal without MFA",
        reason: "Retirement planned; compensating network restriction in place",
        approver: "CFO",
        expires: daysFromSnapshot(24),
      },
      {
        id: "a2",
        title: "Unsupported OT historian software",
        reason: "Vendor replacement scheduled next quarter",
        approver: "COO",
        expires: daysFromSnapshot(71),
      },
    ],
    fixes: [
      { id: "f1", title: "CVE on internal file server (High)", state: "fix_reported", attempts: 0, willPass: true },
      { id: "f2", title: "Exposed admin interface on a test host", state: "fix_reported", attempts: 0, willPass: false },
      { id: "f3", title: "Outdated TLS on partner portal", state: "verified_closed", attempts: 1, willPass: true },
    ],
    decisions: [],
    scenarios: [],
    whatif: { ...WHATIF_TODAY, cost: "", preset: "now" },
    packReviewedBy: null,
  };
}

export function getState(orgId: string): CommandState {
  let state = byOrg.get(orgId);
  if (!state) {
    state = initialState();
    byOrg.set(orgId, state);
  }
  return state;
}

export function resetState(orgId: string) {
  byOrg.set(orgId, initialState());
}

export type ActionResult =
  | { ok: true; toast: string }
  | { ok: false; status: 400 | 403 | 404; message: string };

function forbid(role: string, permission: Parameters<typeof hasPermission>[1]): ActionResult | null {
  if (!isRoleCode(role) || !hasPermission(role, permission)) {
    return {
      ok: false,
      status: 403,
      message: `Role ${role || "unknown"} cannot perform this action.`,
    };
  }
  return null;
}

function findQueue(state: CommandState, id: string) {
  return state.queue.find((item) => item.id === id);
}

export function approveQueue(orgId: string, role: string, actor: string, id: string): ActionResult {
  const denied = forbid(role, "command.queue.act");
  if (denied) return denied;
  const state = getState(orgId);
  const item = findQueue(state, id);
  if (!item) return { ok: false, status: 404, message: "Decision not found." };
  if (item.state !== "open") return { ok: false, status: 400, message: "Decision is not open." };
  item.state = "approved";
  state.decisions.push(`Approved: ${item.title} (${actor})`);
  state.fixes.unshift({
    id: `f${Date.now()}`,
    title: item.title.length > 60 ? `${item.title.slice(0, 58)}…` : item.title,
    state: "fix_reported",
    attempts: 0,
    willPass: true,
  });
  return { ok: true, toast: "Approved. A fix is tracked in Closure and acceptance." };
}

export function deferQueue(orgId: string, role: string, actor: string, id: string): ActionResult {
  const denied = forbid(role, "command.queue.act");
  if (denied) return denied;
  const state = getState(orgId);
  const item = findQueue(state, id);
  if (!item) return { ok: false, status: 404, message: "Decision not found." };
  if (item.state !== "open") return { ok: false, status: 400, message: "Decision is not open." };
  item.state = "deferred";
  state.decisions.push(`Deferred: ${item.title} (${actor})`);
  return { ok: true, toast: "Decision deferred." };
}

export function reopenQueue(orgId: string, role: string, actor: string, id: string): ActionResult {
  const denied = forbid(role, "command.queue.act");
  if (denied) return denied;
  const state = getState(orgId);
  const item = findQueue(state, id);
  if (!item) return { ok: false, status: 404, message: "Decision not found." };
  item.state = "open";
  delete item.until;
  state.decisions.push(`Reopened: ${item.title} (${actor})`);
  return { ok: true, toast: "Decision reopened." };
}

export function acceptQueue(
  orgId: string,
  role: string,
  actor: string,
  id: string,
  input: { reason: string; approver: string; days: number },
): ActionResult {
  if (!canAcceptRisk(role)) {
    return { ok: false, status: 403, message: "This role cannot accept risk." };
  }
  const denied = forbid(role, "command.queue.accept");
  if (denied) return denied;
  const reason = input.reason.trim();
  if (!reason || reason.split(/\s+/).filter(Boolean).length < 2) {
    return { ok: false, status: 400, message: "A multi-word reason is required to accept a risk." };
  }
  if (![30, 90, 180, 365].includes(input.days)) {
    return { ok: false, status: 400, message: "Expiry must be 30, 90, 180, or 365 days." };
  }
  // Approver label is recorded for the pack; capability is enforced on the acting role.
  if (!["CFO", "COO", "CEO", "Risk Lead"].includes(input.approver)) {
    return { ok: false, status: 400, message: "Approver must be CEO, CFO, COO, or Risk Lead." };
  }
  const state = getState(orgId);
  const item = findQueue(state, id);
  if (!item) return { ok: false, status: 404, message: "Decision not found." };
  if (item.state !== "open") return { ok: false, status: 400, message: "Decision is not open." };
  const until = daysFromSnapshot(input.days);
  item.state = "accepted";
  item.until = until;
  state.accept.push({
    id: `a${Date.now()}`,
    title: item.title,
    reason,
    approver: input.approver,
    expires: until,
  });
  state.decisions.push(`Accepted until ${until} (approver ${input.approver}, recorded by ${actor}): ${item.title}`);
  return { ok: true, toast: "Risk accepted with expiry. Added to the register." };
}

export function updateWhatIf(
  orgId: string,
  role: string,
  input: Partial<WhatIfState> & { preset?: string | null },
): ActionResult {
  const denied = forbid(role, "command.whatif");
  if (denied) return denied;
  const state = getState(orgId);
  if (input.preset && WHATIF_PRESETS[input.preset]) {
    const preset = WHATIF_PRESETS[input.preset]!;
    state.whatif = { ...state.whatif, ...preset, preset: input.preset };
  }
  for (const key of ["edr", "siem", "imm", "dr"] as const) {
    if (input[key] == null) continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { ok: false, status: 400, message: "Control gaps must be between 0 and 100." };
    }
    state.whatif[key] = value;
    state.whatif.preset = null;
  }
  if (input.cost != null) state.whatif.cost = String(input.cost).slice(0, 12);
  return { ok: true, toast: "" };
}

export function saveScenario(orgId: string, role: string): ActionResult {
  const denied = forbid(role, "command.whatif.save");
  if (denied) return denied;
  const state = getState(orgId);
  const changed =
    state.whatif.edr !== WHATIF_TODAY.edr ||
    state.whatif.siem !== WHATIF_TODAY.siem ||
    state.whatif.imm !== WHATIF_TODAY.imm ||
    state.whatif.dr !== WHATIF_TODAY.dr;
  if (!changed) return { ok: false, status: 400, message: "Move a control gap before saving a scenario." };
  state.scenarios.push(
    describeScenario(
      {
        edr: state.whatif.edr,
        siem: state.whatif.siem,
        imm: state.whatif.imm,
        dr: state.whatif.dr,
      },
      state.whatif.cost,
      state.whatif.preset,
    ),
  );
  return { ok: true, toast: "Scenario saved." };
}

export function convertScenario(orgId: string, role: string, actor: string, index: number): ActionResult {
  const denied = forbid(role, "command.whatif.save");
  if (denied) return denied;
  const state = getState(orgId);
  const scenario = state.scenarios[index];
  if (!scenario) return { ok: false, status: 404, message: "Scenario not found." };
  state.decisions.push(
    `Funding decision from scenario "${scenario.name}" (ransomware score ${scenario.score}, AED ${scenario.lossAvoided}M expected loss avoided a year; ${actor})`,
  );
  return { ok: true, toast: "Converted to a decision and logged." };
}

export function verifyFix(orgId: string, role: string, id: string): ActionResult {
  const denied = forbid(role, "command.closure.verify");
  if (denied) return denied;
  const state = getState(orgId);
  const fix = state.fixes.find((item) => item.id === id);
  if (!fix) return { ok: false, status: 404, message: "Fix not found." };
  if (fix.state === "verified_closed") {
    return { ok: false, status: 400, message: "This finding is already verified closed." };
  }
  fix.attempts += 1;
  fix.state = fix.willPass ? "verified_closed" : "reopened";
  const closed = fix.state === "verified_closed";
  state.decisions.push(
    `${closed ? "Verified closed by re-scan: " : "Re-scan found weakness still present: "}${fix.title}`,
  );
  return {
    ok: true,
    toast: closed
      ? "Re-scan confirms the weakness is gone. Finding closed."
      : "Re-scan still finds the weakness. Finding stays open.",
  };
}

export function renewAcceptance(orgId: string, role: string, id: string): ActionResult {
  const denied = forbid(role, "command.closure.register");
  if (denied) return denied;
  const state = getState(orgId);
  const item = state.accept.find((row) => row.id === id);
  if (!item) return { ok: false, status: 404, message: "Acceptance not found." };
  item.expires = daysFromSnapshot(daysUntil(item.expires) + 90);
  state.decisions.push(`Renewed 90 days: ${item.title}`);
  return { ok: true, toast: "Renewed for 90 days." };
}

export function revokeAcceptance(orgId: string, role: string, id: string): ActionResult {
  const denied = forbid(role, "command.closure.register");
  if (denied) return denied;
  const state = getState(orgId);
  const item = state.accept.find((row) => row.id === id);
  if (!item) return { ok: false, status: 404, message: "Acceptance not found." };
  state.accept = state.accept.filter((row) => row.id !== id);
  state.decisions.push(`Acceptance revoked and reopened: ${item.title}`);
  return { ok: true, toast: "Acceptance revoked. The finding is open again." };
}

export function reviewPack(orgId: string, role: RoleCode | string, actor: string): ActionResult {
  const denied = forbid(role, "command.pack.review");
  if (denied) return denied;
  const state = getState(orgId);
  state.packReviewedBy = actor;
  state.decisions.push(`Board pack marked reviewed by ${actor}`);
  return { ok: true, toast: `Pack marked reviewed by ${actor} (logged to the audit trail).` };
}

export function roleCan(role: string): RoleCode | null {
  return isRoleCode(role) ? role : null;
}
