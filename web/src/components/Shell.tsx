import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAppState } from "../context/AppState";
import { useTheme } from "../context/Theme";
import { initials, roleLabel } from "../lib/format";

const COMMAND = [
  { to: "/c/headline", label: "Board headline", perm: "command.headline" },
  { to: "/c/posture", label: "Domain posture", perm: "command.posture" },
  { to: "/c/trust", label: "Trust panel", perm: "command.trust" },
  { to: "/c/queue", label: "Decision queue", perm: "command.queue" },
  { to: "/c/whatif", label: "What-if", perm: "command.whatif" },
  { to: "/c/closure", label: "Closure", perm: "command.closure" },
  { to: "/c/changed", label: "What changed", perm: "command.changed" },
  { to: "/c/pack", label: "Board pack", perm: "command.pack" },
];

const WORK = [
  { to: "/operations", label: "Operations", perm: "ops.overview" },
  { to: "/intelligence", label: "Intelligence", perm: "scenarios.read" },
  { to: "/scenarios", label: "Risk scenarios", perm: "scenarios.read" },
  { to: "/ingestion", label: "Ingestion", perm: "ingestion.read" },
  { to: "/risk-domains", label: "Risk domains", perm: "domains.read" },
  { to: "/findings", label: "Findings", perm: "findings.read" },
  { to: "/decisions", label: "Decisions", perm: "decisions.read" },
  { to: "/compliance", label: "Compliance", perm: "compliance.read" },
  { to: "/reports", label: "Reports", perm: "reports.read" },
  { to: "/audit", label: "Audit", perm: "audit.read" },
  { to: "/admin", label: "Users and roles", perm: "admin.users" },
];

export function Shell({ children }: { children: ReactNode }) {
  const { organizations, orgId, setOrgId, users, userId, setUserId, me, signOut, error } =
    useAppState();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const previousUser = useRef(userId);
  const perms = new Set(me?.permissions ?? []);

  useEffect(() => {
    if (!me || me.userId !== userId) return;
    if (previousUser.current && previousUser.current !== userId) {
      navigate(me.home);
    }
    previousUser.current = userId;
  }, [userId, me, navigate]);

  const command = COMMAND.filter((item) => perms.has(item.perm));
  const work = WORK.filter((item) => perms.has(item.perm));

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M12 2l8 3.5v6c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5v-6L12 2z" stroke="currentColor" strokeWidth="1.7" />
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="brand-name">YVI DWAN</div>
            <div className="brand-tag">Cyber Command</div>
          </div>
        </div>
        {command.length > 0 && (
          <nav aria-label="Command">
            <p className="nav-label">Command</p>
            {command.map((item) => (
              <NavLink key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        {work.length > 0 && (
          <nav aria-label="Workspace">
            <p className="nav-label">Workspace</p>
            {work.map((item) => (
              <NavLink key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="sidebar-foot">
          <button className="btn sm" type="button" onClick={toggle}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-bar">
          <div>
            <div className="brand-name">Executive Cyber Risk</div>
            <div className="brand-tag">Sample snapshot 5 Sep 2026</div>
          </div>
          <div className="top-right">
            <label className="sr-only" htmlFor="org-select">Organization</label>
            <select id="org-select" className="org-select" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
              {organizations.map((org) => (
                <option key={org.orgId} value={org.orgId}>{org.name}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="user-select">Signed in as</label>
            <select
              id="user-select"
              className="org-select"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              {users.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.firstName} {user.lastName} · {user.title ?? roleLabel(user.role)}
                </option>
              ))}
            </select>
            {me && <span className="role-chip">{me.title || roleLabel(me.role)}</span>}
            <button className="btn sm" type="button" onClick={signOut}>Sign out</button>
            <div className="avatar" aria-hidden title={me?.email}>
              {me ? initials(me.name) : "—"}
            </div>
          </div>
        </header>
        <div className="demo-strip" role="note">
          <strong>DEMO</strong>
          {" · "}
          Illustrative reference model for Al Dhabi Holdings. Operational pages use the sample database when it is running.
          {" · "}
          {me?.capability}
        </div>
        {error && (
          <div className="banner-error" role="alert">{error}</div>
        )}
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
