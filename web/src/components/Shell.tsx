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
import { navForRole } from "../lib/nav";
import { NAV_ICONS, Shield } from "./icons";

export function Shell({ children }: { children: ReactNode }) {
  const { organizations, orgId, setOrgId, users, userId, setUserId, me, signOut, error, retry } =
    useAppState();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const previousUser = useRef(userId);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("ecc.sidebar") === "collapsed",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const perms = me?.permissions ?? [];
  const roleTone =
    me?.role === "board_member"
      ? "board"
      : me?.role === "ciso"
        ? "ciso"
        : me?.role === "cxo"
          ? "cxo"
          : "ops";

  useEffect(() => {
    if (!me || me.userId !== userId) return;
    if (previousUser.current && previousUser.current !== userId) {
      // Persona switch: land on role home and drop any stale view state.
      navigate(me.home, { replace: true });
    }
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

  const nav = useMemo(
    () => (me ? navForRole(me.role, perms) : []),
    [me, perms],
  );

  const paletteItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nav;
    return nav.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.to.includes(q),
    );
  }, [nav, query]);

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

        {nav.length > 0 && (
          <nav aria-label="Primary">
            {!collapsed && <p className="nav-label">Navigate</p>}
            {nav.map((item) => {
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
            {me && <span className="role-chip">{me.title || roleLabel(me.role)}</span>}
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

        {error && (
          <div className="banner-error" role="alert">
            {error}{" "}
            <button className="btn sm" type="button" onClick={retry}>
              Retry
            </button>
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
