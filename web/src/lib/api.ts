import type { CommandMutation, CommandWorkspace, EvidenceView } from "../data/commandTypes";
import type { Organization, OverviewResponse, UserRef } from "../data/types";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SessionUser {
  userId: string;
  orgId: string;
  orgName: string;
  role: string;
  title: string;
  name: string;
  email: string;
  permissions?: string[];
  views?: string[];
  landing?: string;
  capability?: string;
  home?: string;
  memberships?: { orgId: string; orgName: string; role: string; userId: string }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body) headers["Content-Type"] = "application/json";

  const res = await fetch(path, { ...init, headers, credentials: "include" });
  if (!res.ok) {
    let code = "http_error";
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.headers.get("content-type")?.includes("text/markdown")) {
    return (await res.text()) as T;
  }
  return res.json() as Promise<T>;
}

export type LoginResult =
  | { mfaRequired: true; mfaTicket: string; expiresAt: string }
  | { mfaRequired?: false; user: SessionUser };

export interface MfaStatusResponse {
  mfaEnabled: boolean;
  enrolledAt: string | null;
}

export interface MfaSetupResponse {
  provisioningUri: string;
  manualSecret: string;
  expiresAt: string;
}

export interface MfaConfirmResponse {
  ok: true;
  backupCodes: string[];
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResult>("/api/ecc/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  mfaVerify: (mfaTicket: string, code: string) =>
    request<{ user: SessionUser; usedRecoveryCode?: boolean }>("/api/ecc/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ mfaTicket, code }),
    }),
  mfaStatus: () =>
    request<MfaStatusResponse>("/api/ecc/auth/mfa/status"),
  mfaSetup: (password: string) =>
    request<MfaSetupResponse>("/api/ecc/auth/mfa/setup", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  mfaConfirmSetup: (code: string) =>
    request<MfaConfirmResponse>("/api/ecc/auth/mfa/confirm-setup", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  mfaDisable: (password: string, code?: string, recoveryCode?: string) =>
    request<{ ok: true }>("/api/ecc/auth/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ password, code, recoveryCode }),
    }),
  mfaRegenerateRecoveryCodes: (password: string, code: string) =>
    request<MfaConfirmResponse>("/api/ecc/auth/mfa/regenerate-recovery-codes", {
      method: "POST",
      body: JSON.stringify({ password, code }),
    }),
  logout: () => request<{ ok: boolean }>("/api/ecc/auth/logout", { method: "POST" }),
  switchOrg: (orgId: string) =>
    request<{ user: SessionUser }>("/api/ecc/auth/switch-org", {
      method: "POST",
      body: JSON.stringify({ orgId }),
    }),
  invitePreview: (token: string) =>
    request<{ email: string; orgId: string; orgName: string; role: string; roleLabel: string }>(
      `/api/ecc/auth/invite/${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string, password: string) =>
    request<{ user: SessionUser }>(`/api/ecc/auth/invite/${encodeURIComponent(token)}`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  createInvite: (email: string, role: string) =>
    request<{ email: string; role: string; roleLabel: string; expiresAt: string; invitePath: string }>(
      "/api/ecc/admin/invites",
      { method: "POST", body: JSON.stringify({ email, role }) },
    ),
  organizations: () =>
    request<{ organizations: Organization[] }>("/api/ecc/organizations"),
  users: (oid: string) =>
    request<{ users: UserRef[] }>(`/api/ecc/organizations/${oid}/users`),
  me: () => request<{ user: SessionUser & { permissions: string[]; views: string[]; landing: string; capability: string; home: string } }>("/api/ecc/me"),
  commandWorkspace: () => request<CommandWorkspace>("/api/ecc/command/workspace"),
  commandDomain: (id: string) =>
    request<{ evidence: EvidenceView }>(`/api/ecc/command/domains/${id}`),
  commandWhatIf: (body: Record<string, unknown>) =>
    request<CommandMutation>("/api/ecc/command/whatif", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  commandPost: (path: string, body?: Record<string, unknown>) =>
    request<CommandMutation>(`/api/ecc/command/${path}`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  adminUsers: () => request<{ users: UserRef[] }>("/api/ecc/admin/users"),
  adminSetRole: (userId: string, role: string) =>
    request<{ ok: boolean; users: UserRef[] }>(`/api/ecc/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  overview: () => request<OverviewResponse>("/api/ecc/overview"),
  domains: () => request<{ domains: unknown[] }>("/api/ecc/risk-domains"),
  domain: (id: string) => request<any>(`/api/ecc/risk-domains/${id}`),
  findings: () => request<{ findings: any[] }>("/api/ecc/findings"),
  finding: (id: string) => request<any>(`/api/ecc/findings/${id}`),
  decisions: (status?: string) =>
    request<{ decisions: any[] }>(
      `/api/ecc/decisions${status ? `?status=${status}` : ""}`,
    ),
  decision: (id: string) => request<any>(`/api/ecc/decisions/${id}`),
  decisionAction: (
    id: string,
    action: "approve" | "request-info" | "decline" | "close",
    notes?: string,
  ) =>
    request<any>(`/api/ecc/decisions/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    }),
  compliance: () => request<any>("/api/ecc/compliance"),
  activity: () => request<{ activity: any[] }>("/api/ecc/activity"),
  reports: () => request<{ reports: any[] }>("/api/ecc/reports"),
  generateReport: (reportType: "board_briefing" | "regulator_submission") =>
    request<any>("/api/ecc/reports/generate", {
      method: "POST",
      body: JSON.stringify({ reportType }),
    }),
  audit: () => request<{ audit: any[] }>("/api/ecc/audit"),
  scenarios: (params?: Record<string, string>) => {
    const qs = params
      ? "?" + new URLSearchParams(params).toString()
      : "";
    return request<{ scenarios: any[] }>(`/api/ecc/scenarios${qs}`);
  },
  scenario: (id: string) => request<{ scenario: any }>(`/api/ecc/scenarios/${id}`),
  recalculateScenario: (id: string) =>
    request<any>(`/api/ecc/scenarios/${id}/recalculate`, { method: "POST" }),
  seedDemoScenarios: () =>
    request<{ scenarioIds: string[]; heroScenarioId?: string | null }>(
      "/api/ecc/scenarios/demo/seed",
      { method: "POST" },
    ),
  seedClosedLoopDemos: () =>
    request<any>("/api/ecc/scenarios/demo/closed-loop", { method: "POST" }),
  prepareManagerDemo: () =>
    request<any>("/api/ecc/demo/prepare", { method: "POST" }),
  demoHero: () =>
    request<{
      heroScenarioId: string | null;
      heroTitle: string;
      demoAsOf: string;
      demoDueDate: string;
      demoOwnerLabel: string;
      ownerUserId: string;
      path: string | null;
    }>("/api/ecc/demo/hero"),
  demoVerify: () => request<any>("/api/ecc/demo/verify"),
  scenarioDecision: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/ecc/scenarios/${id}/decision`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchAction: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/ecc/actions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  verifyAction: (id: string, body: Record<string, unknown>) =>
    request<{ verification: any }>(`/api/ecc/actions/${id}/verification`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  portfolio: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return request<any>(`/api/ecc/portfolio${qs}`);
  },
  trends: (window = "30d") =>
    request<any>(`/api/ecc/trends?window=${encodeURIComponent(window)}`),
  hotspots: () => request<any>("/api/ecc/hotspots"),
  decisionCenter: () => request<any>("/api/ecc/decision-center"),
  compliancePosture: () => request<any>("/api/ecc/compliance/posture"),
  controlPosture: () => request<any>("/api/ecc/controls/posture"),
  executiveBriefing: () => request<any>("/api/ecc/executive-briefing"),
  materialChanges: () => request<{ changes: any[] }>("/api/ecc/material-changes"),
  connectorCatalog: () => request<any>("/api/ecc/connectors/catalog"),
  connectorHealth: () => request<any>("/api/ecc/connectors/health"),
  policyBundle: () =>
    request<{
      active: any;
      versions: any[];
      appetites: any[];
      rules: Record<string, unknown>;
      policy?: any;
    }>("/api/ecc/policy"),
  proposePolicy: (body: Record<string, unknown>) =>
    request<any>("/api/ecc/policy", { method: "POST", body: JSON.stringify(body) }),
  approvePolicy: (id: string) =>
    request<any>(`/api/ecc/policy/${id}/approve`, { method: "POST", body: "{}" }),
  proposeAppetite: (body: Record<string, unknown>) =>
    request<any>("/api/ecc/appetite", { method: "POST", body: JSON.stringify(body) }),
  approveAppetite: (id: string) =>
    request<any>(`/api/ecc/appetite/${id}/approve`, { method: "POST", body: "{}" }),
  register: () => request<any>("/api/ecc/register"),
  remediation: () => request<any>("/api/ecc/remediation"),
  orgSettings: () => request<any>("/api/ecc/org/settings"),
  reportSnapshots: () =>
    request<{ reports: any[] }>("/api/ecc/reports/snapshots"),
  reportSnapshot: (id: string) =>
    request<{ report: any }>(`/api/ecc/reports/${id}`),
  generateExecutiveReport: (window = "30d") =>
    request<any>("/api/ecc/reports/generate", {
      method: "POST",
      body: JSON.stringify({
        reportType: "executive_report",
        window,
        snapshot: true,
      }),
    }),
  sampleWorkbookReset: () =>
    request<any>("/api/ecc/ingestion/sample-workbook/reset", { method: "POST" }),
  sampleWorkbookRun: () =>
    request<any>("/api/ecc/ingestion/sample-workbook/run", {
      method: "POST",
      body: JSON.stringify({ correlate: true }),
    }),
  sampleWorkbookStatus: () =>
    request<any>("/api/ecc/ingestion/sample-workbook/status"),
  sampleWorkbookResults: () =>
    request<any>("/api/ecc/ingestion/sample-workbook/results"),
  sampleWorkbookTrace: (signalId: string) =>
    request<any>(`/api/ecc/ingestion/sample-workbook/trace/${signalId}`),
};
