import { useEffect, useState } from "react";
import { useAppState } from "../context/AppState";
import type { UserRef } from "../data/types";
import { ApiError, api } from "../lib/api";
import { roleLabel } from "../lib/format";

/** Schema roles — eight roles only. */
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("domain_analyst");
  const [invitePath, setInvitePath] = useState<string | null>(null);

  const load = () => {
    api
      .adminUsers()
      .then((data) => setUsers(data.users))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Directory unavailable"));
  };

  useEffect(() => {
    load();
  }, [me?.email, me?.orgId]);

  const save = async (user: UserRef, role: string) => {
    if (!user.userId) return;
    setBusy(user.userId);
    setNotice(null);
    try {
      const result = await api.adminSetRole(user.userId, role);
      setUsers(result.users);
      setNotice(`${user.firstName} is now ${roleLabel(role)}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Role change was refused");
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    setBusy("invite");
    setError(null);
    setNotice(null);
    try {
      const result = await api.createInvite(inviteEmail.trim(), inviteRole);
      setInvitePath(result.invitePath);
      setNotice(`Invite ready for ${result.email}. Share the link. It expires ${new Date(result.expiresAt).toLocaleString()}.`);
      setInviteEmail("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invite was refused");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Administration</p>
          <h1 className="page-title">Users and roles</h1>
          <p className="page-sub">Invite a person into {me?.orgName}. They set a password from the link. Roles stay the eight schema roles.</p>
        </div>
        <button className="btn primary sm" type="button" onClick={() => setInviteOpen((open) => !open)}>
          Invite
        </button>
      </div>
      {inviteOpen && (
        <form
          className="card invite-form"
          onSubmit={(event) => {
            event.preventDefault();
            void invite();
          }}
        >
          <label>
            Email
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </label>
          <label>
            Role
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
              {ASSIGNABLE.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary sm" type="submit" disabled={busy === "invite"}>
            Send invite
          </button>
          {invitePath && (
            <p className="note">
              Invite link: <span className="mono">{invitePath}</span>
            </p>
          )}
        </form>
      )}
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner-ok" role="status">
          {notice}
        </p>
      )}
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.userId ?? user.email}>
                <td>
                  <b>
                    {user.firstName} {user.lastName}
                  </b>
                </td>
                <td className="mono">{user.email}</td>
                <td>
                  {user.userId && user.status !== "invited" ? (
                    <select
                      aria-label={`Role for ${user.firstName}`}
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
                  ) : (
                    roleLabel(user.role)
                  )}
                </td>
                <td>{user.status ?? "active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
