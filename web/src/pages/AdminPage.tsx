import { useEffect, useState } from "react";
import { useAppState } from "../context/AppState";
import type { UserRef } from "../data/types";
import { ApiError, api } from "../lib/api";
import { roleLabel } from "../lib/format";

/** Schema `user_role_name` — eight roles only. */
const ASSIGNABLE = [
  "board_member",
  "cxo",
  "ciso",
  "risk_lead",
  "domain_analyst",
  "program_office",
  "auditor",
  "admin",
];

export function AdminPage() {
  const { me } = useAppState();
  const [users, setUsers] = useState<UserRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .adminUsers()
      .then((data) => {
        if (!cancelled) setUsers(data.users);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Directory unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [me?.email]);

  const save = async (user: UserRef, role: string) => {
    setBusy(user.userId);
    setNotice(null);
    try {
      const result = await api.adminSetRole(user.userId, role);
      setUsers(result.users);
      setNotice(`${user.firstName} is now ${roleLabel(role)}. The next request from that persona uses the new role.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Role change was refused");
    } finally {
      setBusy(null);
    }
  };

  if (!me?.permissions.includes("admin.users")) {
    return (
      <div className="page">
        <h1 className="page-title">Users and roles</h1>
        <p className="page-sub">Only an administrator can manage access.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="page-title">Users and roles</h1>
          <p className="page-sub">
            Assign a role to a demo persona. Enforcement is on the API: a board member who is given
            the CISO role can then read technical evidence, and the reverse removes it.
          </p>
        </div>
      </div>
      {error && <p className="banner-error" role="alert">{error}</p>}
      {notice && <p className="banner-ok" role="status">{notice}</p>}
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Title</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId}>
                <td>
                  <b>
                    {user.firstName} {user.lastName}
                  </b>
                </td>
                <td>{user.title ?? "—"}</td>
                <td className="mono">{user.email}</td>
                <td>
                  <label className="sr-only" htmlFor={`role-${user.userId}`}>
                    Role for {user.firstName}
                  </label>
                  <select
                    id={`role-${user.userId}`}
                    value={user.role}
                    disabled={busy === user.userId}
                    onChange={(event) => void save(user, event.target.value)}
                  >
                    {ASSIGNABLE.map((role) => (
                      <option key={role} value={role}>
                        {roleLabel(role)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
