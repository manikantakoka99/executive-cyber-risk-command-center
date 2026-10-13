import { useAppState } from "../context/AppState";
import { useTheme } from "../context/Theme";
import type { UserRef } from "../data/types";
import { initials, roleLabel } from "../lib/format";

const GROUPS: { title: string; match: (user: UserRef) => boolean }[] = [
  { title: "Executive committee", match: (user) => user.role === "cxo" },
  { title: "Security leadership", match: (user) => user.role === "ciso" || user.role === "risk_manager" },
  { title: "Board and assurance", match: (user) => ["board_member", "compliance_manager", "auditor"].includes(user.role) },
  { title: "Security operations", match: (user) => ["security_analyst", "soc_analyst", "domain_analyst"].includes(user.role) },
  { title: "Administration", match: (user) => user.role === "org_admin" || user.role === "super_admin" || user.role === "platform_admin" },
];

export function LoginPage() {
  const { users, organizations, orgId, setOrgId, setUserId, error } = useAppState();
  const { theme, toggle } = useTheme();
  const grouped = GROUPS.map((group) => ({
    ...group,
    users: users.filter(group.match),
  })).filter((group) => group.users.length > 0);
  const leftovers = users.filter((user) => !GROUPS.some((group) => group.match(user)));

  return (
    <div className="login">
      <section className="login-brand">
        <div className="brand-mark" aria-hidden>
          <Shield />
        </div>
        <p className="eyebrow">YVI DWAN</p>
        <h1>Executive Cyber Risk Command Center</h1>
        <p>
          Sign in as a demo role. Each persona receives a different command center: board posture and
          financial exposure, CxO funding decisions, CISO technical evidence, or administration.
        </p>
        <p className="note">Demo sign-in has no password. Production uses SSO. Sample snapshot 5 Sep 2026.</p>
      </section>
      <section className="login-panel">
        <div className="login-tools">
          <label>
            Organization
            <select value={orgId} onChange={(event) => setOrgId(event.target.value)}>
              {organizations.map((org) => (
                <option key={org.orgId} value={org.orgId}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn sm" type="button" onClick={toggle}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </div>
        {error && <p className="banner-error" role="alert">{error}</p>}
        {grouped.map((group) => (
          <div key={group.title}>
            <h2>{group.title}</h2>
            <div className="persona-grid">
              {group.users.map((user) => (
                <button key={user.userId} className="persona" type="button" onClick={() => setUserId(user.userId)}>
                  <span className="avatar" aria-hidden>
                    {initials(`${user.firstName} ${user.lastName ?? ""}`)}
                  </span>
                  <span>
                    <strong>
                      {user.firstName} {user.lastName}
                    </strong>
                    <span className="note">
                      {user.title ?? roleLabel(user.role)} · {roleLabel(user.role)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {leftovers.length > 0 && (
          <div>
            <h2>Directory</h2>
            <div className="persona-grid">
              {leftovers.map((user) => (
                <button key={user.userId} className="persona" type="button" onClick={() => setUserId(user.userId)}>
                  <span className="avatar" aria-hidden>
                    {initials(`${user.firstName} ${user.lastName ?? ""}`)}
                  </span>
                  <span>
                    <strong>
                      {user.firstName} {user.lastName}
                    </strong>
                    <span className="note">{user.title ?? roleLabel(user.role)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Shield() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
      <path d="M12 2l8 3.5v6c0 5-3.4 8.7-8 10.5-4.6-1.8-8-5.5-8-10.5v-6L12 2z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
