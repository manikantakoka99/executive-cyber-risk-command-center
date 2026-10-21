import bcrypt from "bcryptjs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ROUNDS = 10;

/** Precomputed so a missing account still pays a compare. Not a real credential. */
const DUMMY_HASH = bcrypt.hashSync("ecc-timing-pad", ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function verifyPasswordOrDummy(password: string, passwordHash: string | null): Promise<boolean> {
  return bcrypt.compare(password, passwordHash ?? DUMMY_HASH);
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passwordAccepted(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  return null;
}
