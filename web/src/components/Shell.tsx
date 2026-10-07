import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAppState } from "../context/AppState";
import { initials, roleLabel } from "../lib/format";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/risk-domains", label: "Risk Domains" },
  { to: "/findings", label: "Findings" },
  { to: "/decisions", label: "Decisions" },
  { to: "/compliance", label: "Compliance" },
  { to: "/reports", label: "Reports" },
  { to: "/audit", label: "Audit" },
];

export function Shell({
  children,
  lastUpdated,
  refreshing,
  dataError,
}: {
  children: ReactNode;
  lastUpdated?: string | null;
  refreshing?: boolean;
  dataError?: string | null;
}) {
  const { organizations, orgId, setOrgId, users, userId, setUserId, me, error } =
    useAppState();

  const freshness = (() => {
    if (dataError) return "Data unavailable";
    if (refreshing) return "Refreshing…";
    if (lastUpdated) return `Updated ${lastUpdated} · polled`;
    return "Waiting for first update";
  })();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2l8 3.5v6c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5v-6L12 2z"
                stroke="#06222E"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M9 12l2 2 4-4"
                stroke="#06222E"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="brand-name">YVI DWAN Cyber Command Center</div>
            <div className="brand-tag">Executive Risk Intelligence</div>
          </div>
        </div>

        <nav className="topnav" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="top-right">
          <label className="sr-only" htmlFor="org-select">
            Organization
          </label>
          <select
            id="org-select"
            className="org-select"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          >
            {organizations.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="user-select">
            Acting as role
          </label>
          <select
            id="user-select"
            className="org-select"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            title="Demo authentication — user & role"
          >
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.firstName} · {roleLabel(u.role)}
              </option>
            ))}
          </select>
          {me && (
            <span className="role-chip" title={me.email}>
              {roleLabel(me.role)}
            </span>
          )}
          <div
            className={`live-dot ${dataError ? "stale" : ""}`}
            title="Overview uses HTTP polling (~45s), not a push live stream"
            role="status"
            aria-live="polite"
          >
            <span className={`d ${refreshing ? "pulse" : ""}`} />
            {freshness}
          </div>
          <div className="avatar" aria-hidden title={me?.email}>
            {me ? initials(me.name) : "—"}
          </div>
        </div>
      </header>
      {(error || dataError) && (
        <div className="banner-error" role="alert">
          {error || dataError}
        </div>
      )}
      <main className="main">{children}</main>
    </div>
  );
}
