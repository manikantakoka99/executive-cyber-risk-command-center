import { motion } from "framer-motion";
import { Moon, Shield, Sun } from "lucide-react";
import { useAppState } from "../context/AppState";
import { useTheme } from "../context/Theme";
import type { UserRef } from "../data/types";
import { initials, roleLabel } from "../lib/format";

const GROUPS: { title: string; match: (user: UserRef) => boolean }[] = [
  { title: "Executive committee", match: (user) => user.role === "cxo" },
  {
    title: "Security leadership",
    match: (user) => user.role === "ciso" || user.role === "risk_manager",
  },
  {
    title: "Board and assurance",
    match: (user) => ["board_member", "compliance_manager", "auditor"].includes(user.role),
  },
  {
    title: "Security operations",
    match: (user) =>
      ["security_analyst", "soc_analyst", "domain_analyst"].includes(user.role),
  },
  {
    title: "Administration",
    match: (user) =>
      user.role === "org_admin" || user.role === "super_admin" || user.role === "platform_admin",
  },
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
        <motion.div
          className="brand-mark"
          aria-hidden
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Shield size={22} />
        </motion.div>
        <p className="eyebrow">YVI DWAN</p>
        <h1>Executive Cyber Risk Command Center</h1>
        <p>
          Sign in as a demo role. Each persona receives a different command center: board posture and
          financial exposure, CxO funding decisions, CISO technical evidence, or administration.
        </p>
        <ul className="login-points">
          <li>Board — minimal headline and board pack</li>
          <li>CxO — loss exposure and funding what-ifs</li>
          <li>CISO — dense posture, trust, and evidence</li>
        </ul>
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
          <button className="icon-btn" type="button" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        {error && (
          <p className="banner-error" role="alert">
            {error}
          </p>
        )}
        {grouped.map((group, groupIndex) => (
          <div key={group.title}>
            <h2>{group.title}</h2>
            <div className="persona-grid">
              {group.users.map((user, index) => (
                <motion.button
                  key={user.userId}
                  className="persona"
                  type="button"
                  onClick={() => setUserId(user.userId)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: groupIndex * 0.05 + index * 0.03, duration: 0.25 }}
                >
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
                </motion.button>
              ))}
            </div>
          </div>
        ))}
        {leftovers.length > 0 && (
          <div>
            <h2>Directory</h2>
            <div className="persona-grid">
              {leftovers.map((user) => (
                <button
                  key={user.userId}
                  className="persona"
                  type="button"
                  onClick={() => setUserId(user.userId)}
                >
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
