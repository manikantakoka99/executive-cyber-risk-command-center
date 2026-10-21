import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, api, type SessionUser } from "../lib/api";

export interface Membership {
  orgId: string;
  orgName: string;
  role: string;
  userId: string;
}

export interface Me {
  userId: string;
  name: string;
  role: string;
  title: string;
  email: string;
  orgId: string;
  orgName: string;
  permissions: string[];
  views: string[];
  landing: string;
  capability: string;
  home: string;
  memberships: Membership[];
}

interface AppContextValue {
  orgId: string;
  userId: string;
  me: Me | null;
  signIn: (email: string, password: string) => Promise<void>;
  applySession: (user: SessionUser) => void;
  switchOrg: (orgId: string) => Promise<void>;
  signOut: () => void;
  ready: boolean;
  error: string | null;
  retry: () => void;
}

const Ctx = createContext<AppContextValue | null>(null);

function meFrom(user: SessionUser, previous?: Me | null): Me {
  const memberships = user.memberships ?? previous?.memberships ?? [
    { orgId: user.orgId, orgName: user.orgName, role: user.role, userId: user.userId },
  ];
  return {
    userId: user.userId,
    name: user.name,
    role: user.role,
    title: user.title,
    email: user.email,
    orgId: user.orgId,
    orgName: user.orgName,
    permissions: user.permissions ?? previous?.permissions ?? [],
    views: user.views ?? previous?.views ?? [],
    landing: user.landing ?? previous?.landing ?? "headline",
    capability: user.capability ?? previous?.capability ?? "",
    home: user.home ?? previous?.home ?? "/",
    memberships,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState(0);

  const applySession = useCallback((user: SessionUser) => {
    setMe((current) => meFrom(user, current));
    setError(null);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const { user } = await api.me();
        if (cancelled) return;
        setMe(meFrom(user));
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          setMe(null);
          setReady(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to initialize session");
        setReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boot]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    const full = await api.me();
    setMe(meFrom({ ...full.user, ...user, permissions: full.user.permissions }));
    setReady(true);
  }, []);

  const switchOrg = useCallback(async (orgId: string) => {
    await api.switchOrg(orgId);
    const { user } = await api.me();
    setMe(meFrom(user));
  }, []);

  const signOut = useCallback(() => {
    void api.logout().catch(() => undefined);
    setMe(null);
    setReady(true);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setReady(false);
    setBoot((value) => value + 1);
  }, []);

  const value = useMemo(
    () => ({
      orgId: me?.orgId ?? "",
      userId: me?.userId ?? "",
      me,
      signIn,
      applySession,
      switchOrg,
      signOut,
      ready,
      error,
      retry,
    }),
    [me, signIn, applySession, switchOrg, signOut, ready, error, retry],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState outside provider");
  return ctx;
}
