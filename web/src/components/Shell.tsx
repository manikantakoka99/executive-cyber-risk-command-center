import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronsLeft,
  ChevronsRight,
  Command,
  LogOut,
  Moon,
  Search,
  Sun,
} from "lucide-react";
import { useAppState } from "../context/AppState";
import { useTheme } from "../context/Theme";
import { initials, roleLabel } from "../lib/format";
import { NAV_ICONS, Shield } from "./icons";

const COMMAND = [
  { to: "/c/headline", label: "Board headline", perm: "command.headline", hint: "Are we OK?" },
  { to: "/c/posture", label: "Domain posture", perm: "command.posture", hint: "Weakest domains" },
  { to: "/c/trust", label: "Trust panel", perm: "command.trust", hint: "Feed confidence" },
  { to: "/c/queue", label: "Decision queue", perm: "command.queue", hint: "Approvals" },
  { to: "/c/whatif", label: "What-if", perm: "command.whatif", hint: "Funding scenarios" },
  { to: "/c/closure", label: "Closure", perm: "command.closure", hint: "Verify fixes" },
  { to: "/c/changed", label: "What changed", perm: "command.changed", hint: "Since last board" },
  { to: "/c/pack", label: "Board pack", perm: "command.pack", hint: "Export brief" },
];

const WORK = [
  { to: "/operations", label: "Operations", perm: "ops.overview", hint: "Live DB overview" },
  { to: "/intelligence", label: "Intelligence", perm: "scenarios.read", hint: "Enterprise intel" },
  { to: "/scenarios", label: "Risk scenarios", perm: "scenarios.read", hint: "Correlated risk" },
  { to: "/ingestion", label: "Ingestion", perm: "ingestion.read", hint: "Sample workbook" },
  { to: "/risk-domains", label: "Risk domains", perm: "domains.read", hint: "Domain drill-down" },
  { to: "/findings", label: "Findings", perm: "findings.read", hint: "Open findings" },
  { to: "/decisions", label: "Decisions", perm: "decisions.read", hint: "Decision history" },
  { to: "/compliance", label: "Compliance", perm: "compliance.read", hint: "Frameworks" },
  { to: "/reports", label: "Reports", perm: "reports.read", hint: "Generated reports" },
  { to: "/audit", label: "Audit", perm: "audit.read", hint: "Audit trail" },
  { to: "/admin", label: "Users and roles", perm: "admin.users", hint: "RBAC admin" },
];

export function Shell({ children }: { children: ReactNode }) {
  const { organizations, orgId, setOrgId, users, userId, setUserId, me, signOut, error } =
    useAppState();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const previousUser = useRef(userId);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("ecc.sidebar") === "collapsed",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const perms = new Set(me?.permissions ?? []);
  const roleTone = me?.role === "board_member" ? "board" : me?.role === "ciso" ? "ciso" : me?.role === "cxo" ? "cxo" : "ops";

  useEffect(() => {
    if (!me || me.userId !== userId) return;
    if (previousUser.current && previousUser.current !== userId) navigate(me.home);
    previousUser.current = userId;
  }, [userId, me, navigate]);

  useEffect(() => {
    localStorage.setItem("ecc.sidebar", collapsed ? "collapsed" : "open");
  }, [collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const command = COMMAND.filter((item) => perms.has(item.perm));
  const work = WORK.filter((item) => perms.has(item.perm));
  const paletteItems = useMemo(() => {
    const all = [...command, ...work];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.to.includes(q),
    );
  }, [command, work, query]);

  return (
    <div className={`app-frame role-${roleTone}${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar glass" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <Shield size={18} />
          </div>
          {!collapsed && (
            <div>
              <div className="brand-name">YVI&nbsp;DWAN</div>
              <div className="brand-tag">Cyber Command</div>
            </div>
          )}
        </div>

        {command.length > 0 && (
          <nav aria-label="Command">
            {!collapsed && <p className="nav-label">Command</p>}
            {command.map((item) => {
              const Icon = NAV_ICONS[item.to] ?? Search;
              return (
                <NavLink key={item.to} to={item.to} title={item.label}>
                  <Icon size={18} strokeWidth={1.8} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              );
            })}
          </nav>
        )}

        {work.length > 0 && (
          <nav aria-label="Workspace">
            {!collapsed && <p className="nav-label">Workspace</p>}
            {work.map((item) => {
              const Icon = NAV_ICONS[item.to] ?? Search;
              return (
                <NavLink key={item.to} to={item.to} title={item.label}>
                  <Icon size={18} strokeWidth={1.8} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              );
            })}
          </nav>
        )}

        <div className="sidebar-foot">
          <button
            className="icon-btn"
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-bar glass">
          <div className="top-left">
            <button className="search-trigger" type="button" onClick={() => setPaletteOpen(true)}>
              <Search size={16} />
              <span>Search command center…</span>
              <kbd>
                <Command size={11} />K
              </kbd>
            </button>
          </div>
          <div className="top-right">
            <label className="sr-only" htmlFor="org-select">
              Organization
            </label>
            <select
              id="org-select"
              className="org-select"
              value={orgId}
              onChange={(event) => setOrgId(event.target.value)}
            >
              {organizations.map((org) => (
                <option key={org.orgId} value={org.orgId}>
                  {org.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="user-select">
              Signed in as
            </label>
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
            {me && <span className={`role-chip tone-${roleTone}`}>{me.title || roleLabel(me.role)}</span>}
            <button className="icon-btn" type="button" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="btn ghost sm" type="button" onClick={signOut}>
              <LogOut size={14} /> Sign out
            </button>
            <div className="avatar" aria-hidden title={me?.email}>
              {me ? initials(me.name) : "—"}
            </div>
          </div>
        </header>

        <div className="demo-strip" role="note">
          <span className="live-pill">
            <i /> DEMO
          </span>
          <span>
            Sample snapshot 5 Sep 2026 · {me?.capability}
          </span>
        </div>
        {error && (
          <div className="banner-error" role="alert">
            {error}
          </div>
        )}
        <main className="main">{children}</main>
      </div>

      <AnimatePresence>
        {paletteOpen && (
          <motion.div
            className="palette-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPaletteOpen(false)}
          >
            <motion.div
              className="palette glass"
              role="dialog"
              aria-label="Command palette"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="palette-input">
                <Search size={16} />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Jump to a view…"
                />
              </div>
              <div className="palette-list">
                {paletteItems.map((item) => {
                  const Icon = NAV_ICONS[item.to] ?? Search;
                  return (
                    <button
                      key={item.to}
                      type="button"
                      onClick={() => {
                        setPaletteOpen(false);
                        setQuery("");
                        navigate(item.to);
                      }}
                    >
                      <Icon size={16} />
                      <span>
                        <b>{item.label}</b>
                        <small>{item.hint}</small>
                      </span>
                    </button>
                  );
                })}
                {paletteItems.length === 0 && <p className="empty">No matching views for this role.</p>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
