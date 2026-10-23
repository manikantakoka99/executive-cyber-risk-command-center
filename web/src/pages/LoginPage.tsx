import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, KeyRound, Shield } from "lucide-react";
import { ApiError, api } from "../lib/api";
import { useAppState } from "../context/AppState";

export function LoginPage() {
  const { signIn, completeMfaSignIn } = useAppState();
  const navigate = useNavigate();

  // Primary credentials state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // MFA Challenge state (kept strictly in transient memory)
  const [authStep, setAuthStep] = useState<"credentials" | "mfa_challenge">("credentials");
  const [mfaTicket, setMfaTicket] = useState<string>("");
  const [mfaMode, setMfaMode] = useState<"totp" | "recovery">("totp");
  const [totpCode, setTotpCode] = useState<string>("");
  const [recoveryCode, setRecoveryCode] = useState<string>("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaTerminalError, setMfaTerminalError] = useState<boolean>(false);

  // Submit credentials (Step 1)
  const submitCredentials = async (event: FormEvent) => {
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
    setPasswordError(null);
    try {
      const res = await signIn(nextEmail, password);
      if ("mfaRequired" in res && res.mfaRequired) {
        // Transition to MFA challenge state
        setMfaTicket(res.mfaTicket);
        setTotpCode("");
        setRecoveryCode("");
        setMfaError(null);
        setMfaTerminalError(false);
        setMfaMode("totp");
        setAuthStep("mfa_challenge");
      } else {
        // Direct single-factor login success
        const homePath = "home" in res && res.home ? res.home : "/";
        navigate(homePath, { replace: true });
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Wrong email or password.";
      setPasswordError(message || "Wrong email or password.");
    } finally {
      setBusy(false);
    }
  };

  // Submit MFA verification (Step 2)
  const submitMfa = async (event: FormEvent) => {
    event.preventDefault();
    if (mfaTerminalError) return;

    const codeToVerify = mfaMode === "totp" ? totpCode.trim() : recoveryCode.trim();

    if (mfaMode === "totp") {
      if (!/^\d{6}$/.test(codeToVerify)) {
        setMfaError("Enter the 6-digit code shown in your authenticator app.");
        return;
      }
    } else {
      if (!codeToVerify) {
        setMfaError("Enter your 16-character emergency recovery code.");
        return;
      }
    }

    setBusy(true);
    setMfaError(null);

    try {
      const verifyRes = await api.mfaVerify(mfaTicket, codeToVerify);
      const me = await completeMfaSignIn(verifyRes.user);

      // Successfully authenticated: clear all transient challenge tokens
      setMfaTicket("");
      setTotpCode("");
      setRecoveryCode("");
      setAuthStep("credentials");

      navigate(me.home, { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === "code_replayed") {
          setMfaError("This code was already used. Please wait for the next 30-second code from your authenticator app.");
        } else if (err.code === "challenge_expired") {
          setMfaError("This verification challenge has expired. Please sign in again.");
          setMfaTerminalError(true);
        } else if (err.code === "challenge_exhausted") {
          setMfaError("Too many failed attempts. This challenge has been locked for your security. Please sign in again.");
          setMfaTerminalError(true);
        } else if (err.code === "challenge_consumed") {
          setMfaError("This challenge was already consumed. Please sign in again.");
          setMfaTerminalError(true);
        } else if (err.code === "too_many_requests") {
          setMfaError("Too many verification attempts. Please wait a moment before trying again.");
        } else {
          setMfaError(
            mfaMode === "totp"
              ? "Invalid 6-digit verification code. Please check your app and try again."
              : "Invalid emergency recovery code. Please check your backup codes and try again.",
          );
        }
      } else {
        setMfaError("Failed to verify code. Please check your network connection.");
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelMfa = () => {
    setMfaTicket("");
    setTotpCode("");
    setRecoveryCode("");
    setMfaError(null);
    setMfaTerminalError(false);
    setAuthStep("credentials");
  };

  return (
    <div className="auth-screen">
      {authStep === "credentials" ? (
        <form className="auth-card" onSubmit={(event) => void submitCredentials(event)} noValidate>
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
              disabled={busy}
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
              disabled={busy}
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
      ) : (
        <form className="auth-card" onSubmit={(event) => void submitMfa(event)} noValidate>
          <div className="brand-mark" aria-hidden style={{ background: "var(--accent)" }}>
            <KeyRound size={22} color="#ffffff" />
          </div>
          <p className="eyebrow">TWO-FACTOR AUTHENTICATION</p>
          <h1>{mfaMode === "totp" ? "Enter verification code" : "Emergency recovery"}</h1>
          <p className="note">
            {mfaMode === "totp"
              ? "Open your authenticator app (e.g. Google Authenticator) and enter the 6-digit code for your account."
              : "Enter one of your 16-character single-use emergency recovery codes. Once used, it will be permanently consumed."}
          </p>

          {mfaError && (
            <div className="mfa-alert error" role="alert">
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>{mfaError}</div>
            </div>
          )}

          {mfaTerminalError ? (
            <button className="btn primary" type="button" onClick={cancelMfa}>
              Return to sign in
            </button>
          ) : (
            <>
              {mfaMode === "totp" ? (
                <label>
                  6-Digit Authenticator Code
                  <input
                    className="mfa-code-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(event) => {
                      const val = event.target.value.replace(/\D/g, "").slice(0, 6);
                      setTotpCode(val);
                      if (mfaError) setMfaError(null);
                    }}
                    autoFocus
                    disabled={busy}
                    aria-label="6-digit verification code"
                  />
                </label>
              ) : (
                <label>
                  Emergency Recovery Code
                  <input
                    className="mfa-recovery-input"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    value={recoveryCode}
                    onChange={(event) => {
                      setRecoveryCode(event.target.value.toUpperCase());
                      if (mfaError) setMfaError(null);
                    }}
                    autoFocus
                    disabled={busy}
                    aria-label="16-character emergency recovery code"
                  />
                </label>
              )}

              <button
                className="btn primary"
                type="submit"
                disabled={busy || (mfaMode === "totp" ? totpCode.length !== 6 : !recoveryCode.trim())}
              >
                {busy ? "Verifying…" : "Verify & Continue"}
              </button>

              <button
                type="button"
                className="mfa-toggle-btn"
                onClick={() => {
                  setMfaMode((current) => (current === "totp" ? "recovery" : "totp"));
                  setMfaError(null);
                }}
                disabled={busy}
              >
                {mfaMode === "totp"
                  ? "Lost your phone? Use an emergency recovery code"
                  : "Have your authenticator app? Use 6-digit code"}
              </button>

              <button
                type="button"
                className="mfa-secondary-btn"
                onClick={cancelMfa}
                disabled={busy}
              >
                <ArrowLeft size={16} /> Back to email & password
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
