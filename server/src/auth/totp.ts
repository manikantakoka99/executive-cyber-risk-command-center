import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Base32 Alphabet according to RFC 4648 / RFC 3548.
 * Standard for Google Authenticator TOTP secrets.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_ISSUER = "Executive Cyber Risk Command Center";
const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;
const MAX_ALLOWED_TOLERANCE_STEPS = 2; // Strict cap: max ±2 steps (60 seconds) to prevent brute-force window expansion

// ---------------------------------------------------------------------------
// Base32 Encoding / Decoding (RFC 4648)
// ---------------------------------------------------------------------------

/**
 * Encodes a buffer into RFC 4648 Base32 string (without padding, compatible with Google Authenticator).
 */
export function encodeBase32(buffer: Buffer): string {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("encodeBase32 expects a Buffer input.");
  }
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a Buffer.
 * Safely handles uppercase/lowercase, optional whitespace/dashes, and RFC padding (=).
 */
export function decodeBase32(encoded: string): Buffer {
  if (typeof encoded !== "string") {
    throw new TypeError("decodeBase32 expects a string input.");
  }

  // Normalize: remove whitespace, hyphens, and standard RFC trailing padding (=)
  const clean = encoded.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) {
    return Buffer.alloc(0);
  }

  const lookup: Record<string, number> = {};
  for (let i = 0; i < BASE32_ALPHABET.length; i++) {
    lookup[BASE32_ALPHABET[i]] = i;
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const val = lookup[char];
    if (val === undefined) {
      throw new Error("Invalid Base32 character encountered.");
    }
    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// TOTP Core (RFC 6238 & RFC 4226)
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random TOTP secret encoded in Base32.
 * Google Authenticator uses 20 bytes (160 bits) for HMAC-SHA1.
 */
export function generateTotpSecret(byteLength = 20): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new Error("TOTP secret byteLength must be at least 16 bytes (128 bits).");
  }
  const bytes = randomBytes(byteLength);
  return encodeBase32(bytes);
}

/**
 * Computes the counter time step for a given timestamp in milliseconds.
 */
export function getTotpStep(timestampMs: number = Date.now(), periodSeconds: number = DEFAULT_PERIOD): number {
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new RangeError("timestampMs must be a non-negative finite number.");
  }
  if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
    throw new RangeError("periodSeconds must be a positive integer.");
  }
  return Math.floor(timestampMs / 1000 / periodSeconds);
}

/**
 * Generates an RFC 4226 / RFC 6238 6-digit TOTP code for a specific time step.
 */
export function generateTotpForStep(secret: string, step: number): string {
  if (!Number.isInteger(step) || step < 0) {
    throw new RangeError("step must be a non-negative integer.");
  }

  const secretBuffer = decodeBase32(secret);
  if (secretBuffer.length < 10) {
    throw new Error("TOTP secret is too short to be cryptographically secure.");
  }

  // 8-byte big-endian counter
  const counterBuffer = Buffer.alloc(8);
  const high = Math.floor(step / 0x100000000);
  const low = step >>> 0;
  counterBuffer.writeUInt32BE(high, 0);
  counterBuffer.writeUInt32BE(low, 4);

  const hmac = createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(DEFAULT_DIGITS, "0");
}

/**
 * Generates the current 6-digit TOTP code for a secret and timestamp.
 */
export function generateTotpCode(secret: string, timestampMs: number = Date.now()): string {
  const step = getTotpStep(timestampMs);
  return generateTotpForStep(secret, step);
}

export interface VerifyTotpOptions {
  secret: string;
  code: string;
  timestampMs?: number;
  toleranceSteps?: number;
}

export interface VerifyTotpResult {
  valid: boolean;
  matchedStep?: number;
}

/**
 * Verifies a 6-digit TOTP code against the secret within a strictly bounded clock-skew window.
 * Uses constant-time comparison to protect against timing attacks.
 * Rejects whitespace, non-digit, or malformed inputs without partial matching.
 * Returns the matched step for replay attack prevention in the caller.
 */
export function verifyTotpCode(options: VerifyTotpOptions): VerifyTotpResult {
  if (!options || typeof options !== "object") {
    return { valid: false };
  }

  const { secret, code, timestampMs = Date.now(), toleranceSteps = 1 } = options;

  // Strict validation: exactly 6 digits, no whitespace, no partial match
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return { valid: false };
  }

  if (typeof secret !== "string" || secret.trim().length === 0) {
    return { valid: false };
  }

  let currentStep: number;
  try {
    currentStep = getTotpStep(timestampMs);
  } catch {
    return { valid: false };
  }

  // Enforce strict upper bound on clock skew window to prevent brute-force attacks
  const boundedTolerance = Math.min(Math.max(0, Math.floor(toleranceSteps)), MAX_ALLOWED_TOLERANCE_STEPS);

  for (let delta = -boundedTolerance; delta <= boundedTolerance; delta++) {
    const step = currentStep + delta;
    if (step < 0) continue;

    let expected: string;
    try {
      expected = generateTotpForStep(secret, step);
    } catch {
      return { valid: false };
    }

    if (constantTimeEquals(code, expected)) {
      return { valid: true, matchedStep: step };
    }
  }

  return { valid: false };
}

/**
 * Checks if a matched TOTP step has already been consumed (replay prevention).
 */
export function isTotpStepReplayed(
  matchedStep: number,
  lastAcceptedStep: bigint | number | string | null | undefined,
): boolean {
  if (lastAcceptedStep == null) {
    return false;
  }
  return BigInt(matchedStep) <= BigInt(lastAcceptedStep);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

// ---------------------------------------------------------------------------
// Provisioning URI
// ---------------------------------------------------------------------------

export interface TotpUriOptions {
  secret: string;
  email: string;
  issuer?: string;
  period?: number;
  digits?: number;
}

/**
 * Generates an otpauth:// provisioning URI for Google Authenticator.
 * Standard format:
 * otpauth://totp/{Issuer}:{email}?secret={secret}&issuer={Issuer}&algorithm=SHA1&digits=6&period=30
 */
export function generateTotpUri(options: TotpUriOptions): string {
  if (!options || typeof options !== "object") {
    throw new TypeError("generateTotpUri options must be an object.");
  }

  const email = (options.email || "").trim();
  if (!email || !email.includes("@")) {
    throw new Error("A valid account email is required for TOTP provisioning URI.");
  }

  const issuer = (options.issuer || "").trim() || DEFAULT_ISSUER;
  const cleanSecret = (options.secret || "").replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (cleanSecret.length < 16) {
    throw new Error("A valid Base32 secret of at least 16 characters is required.");
  }

  const period = options.period || DEFAULT_PERIOD;
  const digits = options.digits || DEFAULT_DIGITS;

  // Key URI label: issuer and account name separated by colon, both URL-encoded
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  const label = `${encodedIssuer}:${encodedEmail}`;

  const params = new URLSearchParams({
    secret: cleanSecret,
    issuer: issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(period),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// AES-256-GCM Secret Encryption at Rest
// ---------------------------------------------------------------------------

export interface EncryptedSecretPayload {
  ciphertextHex: string;
  ivHex: string;
  tagHex: string;
}

/**
 * Validates and decodes the 32-byte (256-bit) encryption key.
 * Never leaks the key in error messages.
 */
export function getEncryptionKey(overrideKey?: Buffer | string): Buffer {
  const raw = overrideKey ?? process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MFA_ENCRYPTION_KEY environment variable is not configured. It must be a 32-byte key (64 hex characters or 44 base64 characters).",
    );
  }

  if (Buffer.isBuffer(raw)) {
    if (raw.length !== 32) {
      throw new Error(`MFA encryption key buffer must be exactly 32 bytes (got ${raw.length}).`);
    }
    return raw;
  }

  const str = raw.trim();

  // 64 hex characters
  if (/^[0-9a-fA-F]{64}$/.test(str)) {
    return Buffer.from(str, "hex");
  }

  // Base64 32 bytes (44 characters, typically ending with =)
  if (/^[A-Za-z0-9+/]{43}=?$/.test(str) || /^[A-Za-z0-9+/]{44}$/.test(str)) {
    const b64 = Buffer.from(str, "base64");
    if (b64.length === 32) {
      return b64;
    }
  }

  throw new Error(
    "Invalid MFA_ENCRYPTION_KEY format. Must be exactly 64 hexadecimal characters or a valid Base64 string decoding to 32 bytes.",
  );
}

/**
 * Encrypts a Base32 TOTP secret using AES-256-GCM with a fresh, unpredictable 12-byte IV.
 */
export function encryptTotpSecret(secret: string, keyOverride?: Buffer | string): EncryptedSecretPayload {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Secret must be a non-empty string to encrypt.");
  }

  const key = getEncryptionKey(keyOverride);
  const iv = randomBytes(12); // Standard 96-bit nonce for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertextHex: ciphertext.toString("hex"),
    ivHex: iv.toString("hex"),
    tagHex: tag.toString("hex"),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted TOTP secret.
 * Fails safely if ciphertext, IV, tag, or key is invalid or tampered with.
 * Never leaks the secret or key in error messages.
 */
export function decryptTotpSecret(payload: EncryptedSecretPayload, keyOverride?: Buffer | string): string {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid encryption payload provided for decryption.");
  }

  const { ciphertextHex, ivHex, tagHex } = payload;
  if (!ciphertextHex || !ivHex || !tagHex) {
    throw new Error("Missing required ciphertext, IV, or authentication tag in payload.");
  }

  if (!/^[0-9a-fA-F]+$/.test(ciphertextHex) || !/^[0-9a-fA-F]{24}$/.test(ivHex) || !/^[0-9a-fA-F]{32}$/.test(tagHex)) {
    throw new Error("Malformed hexadecimal representation in encrypted payload.");
  }

  const key = getEncryptionKey(keyOverride);
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("Failed to decrypt TOTP secret: authentication tag mismatch or corrupted ciphertext.");
  }
}

// ---------------------------------------------------------------------------
// MFA Challenge Tickets (Ephemeral 2-Step Sign-in Tokens)
// ---------------------------------------------------------------------------

export interface MfaChallengeTicketBundle {
  ticket: string;
  ticketHash: string;
}

/**
 * Generates an unpredictable, cryptographically random challenge ticket (32 bytes base64url).
 * Returns the raw ticket for the client and the SHA-256 hash for database persistence.
 */
export function generateMfaChallengeTicket(): MfaChallengeTicketBundle {
  const ticket = randomBytes(32).toString("base64url");
  const ticketHash = hashMfaChallengeTicket(ticket);
  return { ticket, ticketHash };
}

/**
 * Computes the SHA-256 hash of an ephemeral MFA challenge ticket.
 */
export function hashMfaChallengeTicket(ticket: string): string {
  if (!ticket || typeof ticket !== "string") {
    throw new Error("Challenge ticket must be a non-empty string.");
  }
  return createHash("sha256").update(ticket).digest("hex");
}

// ---------------------------------------------------------------------------
// Recovery Codes (Hashed at Rest)
// ---------------------------------------------------------------------------

export interface RecoveryCodesBundle {
  plaintextCodes: string[];
  hashedCodes: string[];
}

/**
 * Generates a bundle of cryptographically unpredictable recovery codes (64 bits of entropy each).
 * Returns formatted plaintext codes (e.g., a1b2-c3d4-e5f6-7890) to show the user once,
 * and SHA-256 hashes to store in the database.
 */
export function generateRecoveryCodes(count = 8): RecoveryCodesBundle {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new RangeError("Recovery code count must be an integer between 1 and 20.");
  }

  const plaintextCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < count; i++) {
    // 8 random bytes = 16 hex chars (64 bits of entropy), formatted in 4-character blocks
    const hex = randomBytes(8).toString("hex").toLowerCase();
    const formatted = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
    plaintextCodes.push(formatted);
    hashedCodes.push(hashRecoveryCode(formatted));
  }

  return { plaintextCodes, hashedCodes };
}

/**
 * Normalizes and hashes a recovery code with SHA-256.
 */
export function hashRecoveryCode(code: string): string {
  if (!code || typeof code !== "string") {
    throw new Error("Recovery code must be a non-empty string.");
  }
  const normalized = code.replace(/[\s-]/g, "").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Verifies a recovery code against stored hashes using constant-time comparison.
 * If matched, returns matched: true and the updated array with the matched hash removed (single use).
 */
export function verifyAndConsumeRecoveryCode(
  inputCode: string,
  storedHashes: string[],
): { matched: boolean; remainingHashes: string[] } {
  if (!inputCode || typeof inputCode !== "string" || !Array.isArray(storedHashes)) {
    return { matched: false, remainingHashes: Array.isArray(storedHashes) ? storedHashes : [] };
  }

  let targetHash: string;
  try {
    targetHash = hashRecoveryCode(inputCode);
  } catch {
    return { matched: false, remainingHashes: storedHashes };
  }

  const index = storedHashes.findIndex((h) => typeof h === "string" && constantTimeEquals(h, targetHash));

  if (index === -1) {
    return { matched: false, remainingHashes: storedHashes };
  }

  const remainingHashes = storedHashes.filter((_, idx) => idx !== index);
  return { matched: true, remainingHashes };
}
