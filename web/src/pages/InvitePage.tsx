import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Shield } from "lucide-react";
import { ApiError, api } from "../lib/api";
import { useAppState } from "../context/AppState";
import { roleLabel } from "../lib/format";

export function InvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { applySession } = useAppState();
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState("");
  const [role, setRole] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .invitePreview(token)
      .then((invite) => {
        if (cancelled) return;
        setEmail(invite.email);
        setOrgName(invite.orgName);
        setRole(invite.roleLabel || roleLabel(invite.role));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "This invite is invalid or has expired.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 10) {
      setPasswordError("Use at least 10 characters.");
      return;
    }
    setPasswordError(null);
    setBusy(true);
    try {
      await api.acceptInvite(token, password);
      const { user } = await api.me();
      applySession(user);
      navigate("/", { replace: true });
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Could not accept the invite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={(event) => void submit(event)} noValidate>
        <div className="brand-mark" aria-hidden>
          <Shield size={22} />
        </div>
        <p className="eyebrow">YVI DWAN</p>
        <h1>Set your password</h1>
        {loadError ? (
          <p className="field-error" role="alert">
            {loadError}
          </p>
        ) : (
          <>
            <p className="note">
              Joining {orgName || "…"} as {role || "…"}
            </p>
            <label>
              Email
              <input type="email" value={email} readOnly disabled />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={passwordError ? true : undefined}
              />
              {passwordError && (
                <span className="field-error" role="alert">
                  {passwordError}
                </span>
              )}
            </label>
            <button className="btn primary" type="submit" disabled={busy || !email}>
              {busy ? "Saving…" : "Sign in"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
