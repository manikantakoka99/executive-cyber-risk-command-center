import { useCallback, useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Lock,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  X,
} from "lucide-react";
import { ApiError, api, type MfaStatusResponse } from "../lib/api";

type WizardStep =
  | "none"
  | "setup_password"
  | "setup_scan"
  | "setup_backup_codes"
  | "regen_prompt"
  | "regen_backup_codes"
  | "disable_prompt";

export function SecurityPage() {
  const [status, setStatus] = useState<MfaStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wizard & Dialog State
  const [wizardStep, setWizardStep] = useState<WizardStep>("none");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reauth & Code Inputs
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [disableMode, setDisableMode] = useState<"totp" | "recovery">("totp");

  // Enrollment payload from backend
  const [manualSecret, setManualSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");

  // Plaintext backup codes to display once
  const [issuedBackupCodes, setIssuedBackupCodes] = useState<string[]>([]);
  const [acknowledgedBackup, setAcknowledgedBackup] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.mfaStatus();
      setStatus(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load MFA status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Clean reset of wizard state
  const closeWizard = () => {
    setWizardStep("none");
    setPassword("");
    setTotpCode("");
    setRecoveryCodeInput("");
    setManualSecret("");
    setQrDataUrl("");
    setIssuedBackupCodes([]);
    setAcknowledgedBackup(false);
    setCopiedCodes(false);
    setCopiedSecret(false);
    setActionError(null);
    setBusy(false);
  };

  // 1. Start Setup: reauthenticate with password
  const handleStartSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setActionError("Please enter your current password.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.mfaSetup(password);
      setManualSecret(res.manualSecret);

      // Generate local QR code client-side without sending data to any external server
      const dataUrl = await QRCode.toDataURL(res.provisioningUri, {
        margin: 1,
        width: 200,
        color: { dark: "#1f2a24", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);

      // Transition to QR scan & code confirmation step
      setPassword("");
      setTotpCode("");
      setWizardStep("setup_scan");
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to initiate MFA setup.";
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  // 2. Confirm Setup: submit 6-digit code
  const handleConfirmSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setActionError("Please enter a valid 6-digit code from Google Authenticator.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.mfaConfirmSetup(totpCode.trim());
      setIssuedBackupCodes(res.backupCodes);
      setAcknowledgedBackup(false);
      setTotpCode("");
      setWizardStep("setup_backup_codes");
      await fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Invalid code. Please check your authenticator app.";
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  // 3. Regenerate Recovery Codes: reauth & submit TOTP code
  const handleRegenerateCodes = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setActionError("Please enter your current password.");
      return;
    }
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setActionError("Please enter a valid 6-digit code from Google Authenticator.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.mfaRegenerateRecoveryCodes(password, totpCode.trim());
      setIssuedBackupCodes(res.backupCodes);
      setAcknowledgedBackup(false);
      setPassword("");
      setTotpCode("");
      setWizardStep("regen_backup_codes");
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to regenerate recovery codes.";
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  // 4. Disable MFA: reauth & factor verification
  const handleDisableMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setActionError("Please enter your current password.");
      return;
    }
    if (disableMode === "totp" && !/^\d{6}$/.test(totpCode.trim())) {
      setActionError("Please enter a valid 6-digit code from your authenticator app.");
      return;
    }
    if (disableMode === "recovery" && !recoveryCodeInput.trim()) {
      setActionError("Please enter a valid recovery code.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.mfaDisable(
        password,
        disableMode === "totp" ? totpCode.trim() : undefined,
        disableMode === "recovery" ? recoveryCodeInput.trim() : undefined,
      );
      closeWizard();
      await fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : "Failed to disable MFA. Check your credentials.";
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="security-page">
      <div style={{ marginBottom: 28 }}>
        <p className="eyebrow">ACCOUNT PROTECTION</p>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Shield size={26} color="var(--accent)" /> Multi-Factor Authentication
        </h1>
        <p className="page-sub">
          Strengthen your command center account by requiring a time-based one-time password (TOTP) from Google
          Authenticator or another compatible authenticator app on every sign in.
        </p>
      </div>

      {loading && !status && (
        <div className="skeleton" style={{ height: 160, borderRadius: "var(--radius)" }} />
      )}

      {error && (
        <div className="mfa-alert error" style={{ marginBottom: 24 }}>
          <AlertCircle size={20} />
          <div>{error}</div>
        </div>
      )}

      {status && (
        <>
          {/* Main MFA Status Card */}
          <div className="security-card">
            <div className="security-card-header">
              <div>
                <h2 className="security-card-title">
                  {status.mfaEnabled ? (
                    <>
                      <ShieldCheck size={22} color="var(--good)" /> Two-Factor Authentication is Active
                    </>
                  ) : (
                    <>
                      <ShieldAlert size={22} color="var(--med)" /> Two-Factor Authentication is Not Enabled
                    </>
                  )}
                </h2>
                <p className="security-card-desc">
                  {status.mfaEnabled
                    ? `Your account is protected by Google Authenticator TOTP${
                        status.enrolledAt ? ` (enrolled on ${new Date(status.enrolledAt).toLocaleDateString()})` : ""
                      }. A 6-digit code or emergency recovery code is required on every login.`
                    : "Your account is currently protected by a password only. We strongly recommend enabling two-factor authentication to prevent unauthorized executive risk decisions."}
                </p>
              </div>
              <span className={`mfa-badge ${status.mfaEnabled ? "active" : "inactive"}`}>
                {status.mfaEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {!status.mfaEnabled ? (
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setWizardStep("setup_password");
                  }}
                >
                  <ShieldCheck size={16} /> Enable Two-Factor Authentication
                </button>
              ) : (
                <>
                  <button
                    className="mfa-secondary-btn"
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setPassword("");
                      setTotpCode("");
                      setWizardStep("regen_prompt");
                    }}
                  >
                    <RefreshCw size={15} /> Regenerate Recovery Codes
                  </button>

                  <button
                    className="mfa-secondary-btn"
                    style={{ color: "var(--crit)", borderColor: "color-mix(in srgb, var(--crit) 30%, transparent)" }}
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setPassword("");
                      setTotpCode("");
                      setRecoveryCodeInput("");
                      setDisableMode("totp");
                      setWizardStep("disable_prompt");
                    }}
                  >
                    <ShieldOff size={15} /> Disable Two-Factor Authentication
                  </button>
                </>
              )}
            </div>
          </div>

          {/* How TOTP Works Explainer Card */}
          <div className="security-card" style={{ background: "var(--surface2)" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <Smartphone size={18} color="var(--accent)" /> Supported Authenticator Applications
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              This system supports any standard RFC 6238 TOTP application, including <b>Google Authenticator</b>,{" "}
              <b>1Password</b>, <b>Aegis Authenticator</b>, <b>Authy</b>, and <b>Apple Passwords</b>. Authenticator apps
              generate time-sensitive 6-digit codes offline without needing an active internet connection or SMS.
            </p>
          </div>
        </>
      )}

      {/* =========================================================================
          WIZARD MODALS
      ========================================================================= */}

      {/* 1. SETUP: Step 1 - Password Confirmation Modal */}
      {wizardStep === "setup_password" && (
        <div className="mfa-modal-scrim" onClick={closeWizard}>
          <div className="mfa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm Password">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>
                <Lock size={20} color="var(--accent)" /> Confirm Your Password
              </h2>
              <button
                type="button"
                onClick={closeWizard}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              To ensure it is really you, enter your current account password to begin two-factor authentication setup.
            </p>

            {actionError && (
              <div className="mfa-alert error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <div>{actionError}</div>
              </div>
            )}

            <form onSubmit={(e) => void handleStartSetup(e)}>
              <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
                Account Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  disabled={busy}
                  required
                />
              </label>

              <div className="mfa-modal-actions">
                <button type="button" className="mfa-secondary-btn" onClick={closeWizard} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={busy || !password}>
                  {busy ? "Verifying…" : "Continue to QR Code"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. SETUP: Step 2 - QR Code & Verification Modal */}
      {wizardStep === "setup_scan" && (
        <div className="mfa-modal-scrim" onClick={closeWizard}>
          <div className="mfa-modal" style={{ width: "min(580px, 100%)" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scan QR Code">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>
                <Smartphone size={20} color="var(--accent)" /> Scan QR Code
              </h2>
              <button
                type="button"
                onClick={closeWizard}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              Open your authenticator app (e.g. Google Authenticator), tap <b>+</b>, and scan this QR code.
            </p>

            {actionError && (
              <div className="mfa-alert error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <div>{actionError}</div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, margin: "8px 0" }}>
              {qrDataUrl && (
                <div className="qr-preview-box">
                  <img src={qrDataUrl} alt="Google Authenticator QR Code" />
                </div>
              )}

              <div style={{ width: "100%" }}>
                <span style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 4 }}>
                  Cannot scan? Enter this secret key manually:
                </span>
                <div className="secret-key-box">
                  <span className="secret-key-text">{manualSecret}</span>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      void copyToClipboard(manualSecret).then((ok) => {
                        if (ok) {
                          setCopiedSecret(true);
                          setTimeout(() => setCopiedSecret(false), 2000);
                        }
                      });
                    }}
                  >
                    {copiedSecret ? <Check size={14} /> : <Copy size={14} />} {copiedSecret ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            <form onSubmit={(e) => void handleConfirmSetup(e)}>
              <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
                Enter the 6-digit code from your authenticator app to confirm setup:
                <input
                  className="mfa-code-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  disabled={busy}
                  required
                />
              </label>

              <div className="mfa-modal-actions">
                <button type="button" className="mfa-secondary-btn" onClick={closeWizard} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={busy || totpCode.length !== 6}>
                  {busy ? "Activating…" : "Confirm & Activate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. SETUP & REGEN: Step 3 - Backup Codes Display Modal */}
      {(wizardStep === "setup_backup_codes" || wizardStep === "regen_backup_codes") && (
        <div className="mfa-modal-scrim">
          <div className="mfa-modal" style={{ width: "min(620px, 100%)" }} role="dialog" aria-label="Save Emergency Recovery Codes">
            <h2>
              <CheckCircle2 size={22} color="var(--good)" /> Emergency Recovery Codes
            </h2>

            <div className="mfa-alert warning">
              <AlertTriangle size={20} style={{ flexShrink: 0 }} />
              <div>
                <b>Important: Save these recovery codes now.</b> If you lose your phone or switch devices, these codes
                are the only way to recover access to your account. <b>They will never be displayed again.</b>
              </div>
            </div>

            <div className="recovery-grid">
              {issuedBackupCodes.map((code, idx) => (
                <div key={idx} className="recovery-code-chip">
                  {code}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  const content = `ECC Command Center Emergency Recovery Codes\nGenerated: ${new Date().toISOString()}\n\n${issuedBackupCodes.join(
                    "\n",
                  )}\n\nEach code can be used exactly once.`;
                  void copyToClipboard(content).then((ok) => {
                    if (ok) {
                      setCopiedCodes(true);
                      setTimeout(() => setCopiedCodes(false), 2000);
                    }
                  });
                }}
              >
                {copiedCodes ? <Check size={14} /> : <Copy size={14} />} {copiedCodes ? "Copied All Codes!" : "Copy All Codes"}
              </button>
            </div>

            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, cursor: "pointer", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={acknowledgedBackup}
                onChange={(e) => setAcknowledgedBackup(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>I have safely saved or printed these 8 recovery codes in a secure location.</span>
            </label>

            <div className="mfa-modal-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!acknowledgedBackup}
                onClick={closeWizard}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. REGENERATE CODES: Prompt Modal */}
      {wizardStep === "regen_prompt" && (
        <div className="mfa-modal-scrim" onClick={closeWizard}>
          <div className="mfa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Regenerate Recovery Codes">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>
                <RefreshCw size={20} color="var(--accent)" /> Regenerate Recovery Codes
              </h2>
              <button
                type="button"
                onClick={closeWizard}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mfa-alert warning">
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div>
                Regenerating recovery codes will <b>immediately invalidate all 8 previous recovery codes</b>. Any unused
                codes from before will no longer work.
              </div>
            </div>

            {actionError && (
              <div className="mfa-alert error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <div>{actionError}</div>
              </div>
            )}

            <form onSubmit={(e) => void handleRegenerateCodes(e)}>
              <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                Account Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  required
                />
              </label>

              <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
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
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={busy}
                  required
                />
              </label>

              <div className="mfa-modal-actions">
                <button type="button" className="mfa-secondary-btn" onClick={closeWizard} disabled={busy}>
                  Cancel
                </button>
                <button type="submit" className="btn primary" disabled={busy || !password || totpCode.length !== 6}>
                  {busy ? "Regenerating…" : "Generate New Codes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. DISABLE MFA: Prompt Modal */}
      {wizardStep === "disable_prompt" && (
        <div className="mfa-modal-scrim" onClick={closeWizard}>
          <div className="mfa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Disable Multi-Factor Authentication">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ color: "var(--crit)" }}>
                <ShieldAlert size={20} color="var(--crit)" /> Disable Two-Factor Authentication
              </h2>
              <button
                type="button"
                onClick={closeWizard}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mfa-alert error">
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <div>
                <b>Warning:</b> Disabling MFA significantly lowers your account security. Your Google Authenticator app
                and all recovery codes will be permanently removed.
              </div>
            </div>

            {actionError && (
              <div className="mfa-alert error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <div>{actionError}</div>
              </div>
            )}

            <form onSubmit={(e) => void handleDisableMfa(e)}>
              <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                Account Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  required
                />
              </label>

              {disableMode === "totp" ? (
                <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
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
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    disabled={busy}
                    required
                  />
                </label>
              ) : (
                <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
                  Emergency Recovery Code
                  <input
                    className="mfa-recovery-input"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="xxxx-xxxx-xxxx-xxxx"
                    value={recoveryCodeInput}
                    onChange={(e) => setRecoveryCodeInput(e.target.value.toUpperCase())}
                    disabled={busy}
                    required
                  />
                </label>
              )}

              <button
                type="button"
                className="mfa-toggle-btn"
                style={{ marginBottom: 12 }}
                onClick={() => setDisableMode((m) => (m === "totp" ? "recovery" : "totp"))}
              >
                {disableMode === "totp" ? "Don't have your phone? Use a recovery code" : "Have your phone? Use a 6-digit code"}
              </button>

              <div className="mfa-modal-actions">
                <button type="button" className="mfa-secondary-btn" onClick={closeWizard} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn danger"
                  disabled={busy || !password || (disableMode === "totp" ? totpCode.length !== 6 : !recoveryCodeInput.trim())}
                >
                  {busy ? "Disabling…" : "Permanently Disable MFA"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
