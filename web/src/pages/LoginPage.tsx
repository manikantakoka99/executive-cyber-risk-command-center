import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import { ApiError } from "../lib/api";
import { useAppState } from "../context/AppState";

export function LoginPage() {
  const { signIn } = useAppState();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextEmail = email.trim();
    let emailProblem: string | null = null;
    let passwordProblem: string | null = null;
    if (!nextEmail) emailProblem = "Enter your email.";
    if (!password) passwordProblem = "Enter your password.";
    setEmailError(emailProblem);
    setPasswordError(passwordProblem);
    if (emailProblem || passwordProblem) return;
    setBusy(true);
    try {
      const me = await signIn(nextEmail, password);
      navigate(me.home, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Wrong email or password.";
      setPasswordError(message || "Wrong email or password.");
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
        <h1>Sign in</h1>
        <p className="note">Executive Cyber Risk Command Center</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={emailError ? true : undefined}
          />
          {emailError && (
            <span className="field-error" role="alert">
              {emailError}
            </span>
          )}
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
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
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
