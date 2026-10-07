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

let orgId = "";
let userId = "";

export function setAuthContext(nextOrgId: string, nextUserId: string) {
  orgId = nextOrgId;
  userId = nextUserId;
}

export function getAuthContext() {
  return { orgId, userId };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body) headers["Content-Type"] = "application/json";
  if (orgId) headers["X-Org-Id"] = orgId;
  if (userId) headers["X-User-Id"] = userId;

  const res = await fetch(path, { ...init, headers });
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

export const api = {
  organizations: () =>
    request<{ organizations: Organization[] }>("/api/ecc/organizations"),
  users: (oid: string) =>
    request<{ users: UserRef[] }>(`/api/ecc/organizations/${oid}/users`),
  me: () =>
    request<{
      user: {
        userId: string;
        orgId: string;
        orgName: string;
        role: string;
        name: string;
        email: string;
      };
    }>("/api/ecc/me"),
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
};
