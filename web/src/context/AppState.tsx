import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, setAuthContext } from "../lib/api";
import type { Organization, UserRef } from "../data/types";

const DEFAULT_ORG = "2accc7de-f693-4b19-8fe8-6db501be05e2";

interface AppContextValue {
  organizations: Organization[];
  users: UserRef[];
  orgId: string;
  userId: string;
  me: {
    name: string;
    role: string;
    email: string;
    orgName: string;
  } | null;
  setOrgId: (id: string) => void;
  setUserId: (id: string) => void;
  ready: boolean;
  error: string | null;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [orgId, setOrgIdState] = useState(
    () => localStorage.getItem("ecc.orgId") ?? DEFAULT_ORG,
  );
  const [userId, setUserIdState] = useState(
    () => localStorage.getItem("ecc.userId") ?? "",
  );
  const [me, setMe] = useState<AppContextValue["me"]>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boot, setBoot] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setReady(false);
        setError(null);
        const { organizations: orgs } = await api.organizations();
        if (cancelled) return;
        setOrganizations(orgs);
        const selectedOrg =
          orgs.find((o) => o.orgId === orgId)?.orgId ?? orgs[0]?.orgId;
        if (!selectedOrg) throw new Error("No organizations in database");

        const { users: orgUsers } = await api.users(selectedOrg);
        if (cancelled) return;
        setUsers(orgUsers);
        const preferred =
          orgUsers.find((u) => u.userId === userId) ??
          orgUsers.find((u) => u.role === "cxo") ??
          orgUsers[0];
        if (!preferred) throw new Error("No users for organization");

        if (selectedOrg !== orgId) {
          localStorage.setItem("ecc.orgId", selectedOrg);
          setOrgIdState(selectedOrg);
        }
        if (preferred.userId !== userId) {
          localStorage.setItem("ecc.userId", preferred.userId);
          setUserIdState(preferred.userId);
        }

        setAuthContext(selectedOrg, preferred.userId);
        const { user } = await api.me();
        if (cancelled) return;
        setMe({
          name: user.name,
          role: user.role,
          email: user.email,
          orgName: user.orgName,
        });
        setReady(true);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || "Failed to initialize session");
          setReady(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // boot forces reload when org/user explicitly changed
  }, [orgId, userId, boot]);

  const setOrgId = useCallback((id: string) => {
    localStorage.setItem("ecc.orgId", id);
    localStorage.removeItem("ecc.userId");
    setUserIdState("");
    setOrgIdState(id);
    setBoot((b) => b + 1);
  }, []);

  const setUserId = useCallback((id: string) => {
    localStorage.setItem("ecc.userId", id);
    setUserIdState(id);
    setBoot((b) => b + 1);
  }, []);

  const value = useMemo(
    () => ({
      organizations,
      users,
      orgId,
      userId,
      me,
      setOrgId,
      setUserId,
      ready,
      error,
    }),
    [organizations, users, orgId, userId, me, setOrgId, setUserId, ready, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppState outside provider");
  return ctx;
}
