# Multi-Factor Authentication (MFA) — Phase 2: Changelog & Operational Guide

## 1. Overview of Changes

Phase 2 introduces backend MFA enforcement, ephemeral challenge management, TOTP verification, single-use recovery code consumption, and administrative self-service endpoints without altering frontend UI or breaking single-factor authentication compatibility.

---

## 2. File-by-File Changes

### Database Migrations:
- **`db/migrations/013_ecc_mfa_totp.sql`**: Added columns to `auth_accounts` (`mfa_enabled`, `totp_secret_encrypted`, `totp_secret_iv`, `totp_secret_tag`, `mfa_enrolled_at`, `backup_codes_hashes`, `last_totp_timestamp`) and created `auth_mfa_challenges`.
- **`db/migrations/014_ecc_mfa_enrollment.sql`**: Added `auth_mfa_pending_enrollments` table for two-phase setup with automatic 15-minute expiration index.
- **`db/docker-init/apply_app_schema.sh`**: Registered migrations `013` and `014`; strictly maintained Unix LF line endings.
- **`db/apply_migrations.py`**: Added Python migration tracking entries.

### Backend Infrastructure:
- **`server/src/auth/schema.ts`**: Added runtime idempotent migrations `MFA_MIGRATION_SQL` and `MFA_PENDING_ENROLLMENT_SQL` ensuring test containers and ephemeral databases bootstrap automatically.
- **`server/src/auth/totp.ts`**:
  - RFC 6238 TOTP generation and bounded clock-skew verification (tolerance = 1 step).
  - Base32 encoding/decoding (RFC 4648).
  - AES-256-GCM encryption with 12-byte IV and 16-byte authentication tags.
  - 64-bit entropy single-use recovery codes and constant-time SHA-256 verification.
  - Monotonic replay prevention helper `isTotpStepReplayed()`.
  - Challenge ticket generators and SHA-256 hashing utilities.
- **`server/src/auth/service.ts`**:
  - Updated `login()`: Conditionally intercepts MFA-enabled accounts, returning ephemeral challenge tickets without issuing session cookies.
  - Implemented `verifyMfaChallengeAndLogin()`: Atomic verification, attempt throttling (max 5), clock-skew verification, replay rejection, single-use challenge consumption, and session issuance.
  - Implemented `setupMfa()`: Initiates pending enrollment with password reauthentication and provisioning URI.
  - Implemented `confirmMfaSetup()`: Confirms TOTP factor, enables MFA, returns recovery codes once, and sets initial replay state.
  - Implemented `disableMfa()`: Disables MFA with password and second-factor verification, purging encrypted credentials.
  - Implemented `regenerateRecoveryCodes()`: Replaces recovery code bundle with new cryptographic hashes.
  - Implemented `getMfaStatus()`: Returns enrollment state for active sessions.
- **`server/src/auth/routes.ts`**:
  - Registered `/api/ecc/auth/mfa/status` (`GET`)
  - Registered `/api/ecc/auth/mfa/setup` (`POST`)
  - Registered `/api/ecc/auth/mfa/confirm-setup` (`POST`)
  - Registered `/api/ecc/auth/mfa/disable` (`POST`)
  - Registered `/api/ecc/auth/mfa/regenerate-recovery-codes` (`POST`)
  - Registered `/api/ecc/auth/mfa/verify` (`POST`)
  - Request body validation and strict sanitization.
- **`server/src/middleware/tenant.ts`**:
  - Updated `isPublicEccPath()` to whitelist `/api/ecc/auth/mfa/verify`.
  - Blocked `/setup`, `/confirm-setup`, `/disable`, and `/regenerate-recovery-codes` from unauthenticated access.
  - Hardened `demoHeaderAuthEnabled()` to explicitly fail if `NODE_ENV === "production"`.

### Test Suites:
- **`server/src/auth/totp.test.ts`**: 36 unit tests for crypto, RFC vectors, skew, tampering, and replay.
- **`server/src/auth/mfaFlow.test.ts`**: 17 end-to-end integration tests covering password login, setup, confirm, interception, recovery codes, replay prevention, and concurrency.

---

## 3. Backward Compatibility & Non-Breaking Invariants

1. **Non-MFA Accounts:** Users without MFA enabled (`mfa_enabled = false` or `NULL`) continue to log in seamlessly with username and password, receiving an authenticated session cookie immediately.
2. **RBAC & Multi-Tenant Isolation:** Roles (CISO, CXO, Auditor, Admin) and organization context are bound to the session only after factor verification. No extra privileges are granted by MFA.
3. **Session Mechanism:** Uses the existing `auth_sessions` table and `ecc_session` HTTP-only cookie. No new session store was introduced.

---

## 4. Configuration & Deployment Requirements

### Environment Variables:
- **`MFA_ENCRYPTION_KEY`** (Required):
  - Must be a 32-byte cryptographically secure key.
  - Supported formats: 64-character hexadecimal or 44-character Base64.
  - Generation command:
    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    ```
  - If unset or invalid, the server fails closed on any MFA cryptographic operation.

### Key Management & Operational Safety:
1. **Backups:** The database stores encrypted secrets (`totp_secret_encrypted`). If the database is restored without the matching `MFA_ENCRYPTION_KEY`, users with MFA enabled will be unable to log in via TOTP and will need administrator-assisted recovery or emergency backup codes.
2. **Key Rotation Policy:** To rotate `MFA_ENCRYPTION_KEY`, run a batch script that reads records with the old key, re-encrypts with a new key in a single transaction, and atomically updates the environment variable.

---

## 5. Scope Boundaries

- **Phase 1 (Foundation):** Complete.
- **Phase 2 (Backend Integration):** Complete.
- **Phase 3 (Frontend Integration):** Ready for implementation. No frontend UI screens were modified in Phase 2.
