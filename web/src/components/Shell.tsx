import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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

/** Bring the active item into the nav scroller. Never touches window scroll. */
function scrollActiveNavLink(navEl: HTMLElement, behavior: ScrollBehavior) {
  const active = navEl.querySelector<HTMLElement>('a[aria-current="page"], a.active');
  if (!active) return false;
  const navRect = navEl.getBoundingClientRect();
  const linkRect = active.getBoundingClientRect();
  let delta = 0;
  if (linkRect.top < navRect.top) delta = linkRect.top - navRect.top;
  else if (linkRect.bottom > navRect.bottom) delta = linkRect.bottom - navRect.bottom;
  if (delta !== 0) {
    const top = navEl.scrollTop + delta;
    if (behavior === "smooth") navEl.scrollTo({ top, behavior: "smooth" });
    else navEl.scrollTop = top;
  }
  return true;
}

export function Shell({ children }: { children: ReactNode }) {
  const { orgId, userId, me, signOut, switchOrg, error, retry } = useAppState();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const navScrollRef = useRef<HTMLElement>(null);
  const alignedPath = useRef<string | null>(null);
  const previousUser = useRef(userId);
  const previousOrg = useRef(orgId);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("ecc.sidebar") === "collapsed",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
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
    const userChanged = Boolean(previousUser.current && previousUser.current !== userId);
    const orgChanged = Boolean(previousOrg.current && previousOrg.current !== orgId);
    if (userChanged || orgChanged) {
      // Org or identity switch: land on role home and drop any stale view state.
      navigate(me.home, { replace: true });
    }
    previousUser.current = userId;
    previousOrg.current = orgId;
  }, [userId, orgId, me, navigate]);

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

  useLayoutEffect(() => {
    const navEl = navScrollRef.current;
    if (!navEl) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Instant on mount (including Strict Mode's second pass) and when the
    // user prefers reduced motion. Smooth only after a real route change.
    const routeChanged = alignedPath.current !== null && alignedPath.current !== location.pathname;
    const behavior: ScrollBehavior = routeChanged && !reduce ? "smooth" : "auto";
    if (scrollActiveNavLink(navEl, behavior)) alignedPath.current = location.pathname;
  }, [location.pathname, nav, collapsed]);

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
        {me && me.memberships.length > 1 && (
          <div className="org-switch" aria-label="Organizations">
            {me.memberships.map((org, index) => (
              <button
                key={org.orgId}
                type="button"
                className={org.orgId === orgId ? "active" : ""}
                title={org.orgName}
                onClick={() => void switchOrg(org.orgId)}
              >
                <span className={`org-badge b${index % 4}`}>{org.orgName.slice(0, 1)}</span>
                {!collapsed && <span>{org.orgName}</span>}
              </button>
            ))}
          </div>
        )}
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
          <nav aria-label="Primary" ref={navScrollRef}>
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
            <button className="icon-btn" type="button" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {me && (
              <div className="account">
                <button
                  className="account-chip"
                  type="button"
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  onClick={() => setAccountOpen((open) => !open)}
                >
                  <span className="avatar" aria-hidden>
                    {initials(me.name)}
                  </span>
                  <span className="account-copy">
                    <strong>{me.name}</strong>
                    <small>
                      {roleLabel(me.role)} · {me.orgName}
                    </small>
                  </span>
                </button>
                {accountOpen && (
                  <div className="account-menu" role="menu">
                    {me.permissions.includes("admin.users") && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountOpen(false);
                          navigate("/admin");
                        }}
                      >
                        Users
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountOpen(false);
                        signOut();
                      }}
                    >
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
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
