/**
 * Failed sign-in counters kept in this process only.
 * A second API instance does not share the map, so the limits are per instance.
 * Successful sign-ins are not counted. A success clears that email's failures.
 * An email or IP that is already at its limit keeps returning 429 until the
 * window ends; a correct password does not clear a block that is already open.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 15 * 60 * 1000;

function configuredLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function limits() {
  return {
    perIp: configuredLimit("LOGIN_THROTTLE_IP", 30),
    perEmail: configuredLimit("LOGIN_THROTTLE_EMAIL", 8),
  };
}

export function resetLoginThrottle(): void {
  buckets.clear();
}

/** TRUST_PROXY is off unless the env var is set to an explicit on value. */
export function trustProxyEnabled(): boolean {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (!raw) return false;
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

/**
 * Socket address by default. The first X-Forwarded-For hop is used only when
 * TRUST_PROXY is explicitly enabled, so an untrusted client cannot widen the key.
 */
export function loginClientIp(
  socketIp: string | undefined,
  forwardedFor: string | string[] | undefined,
): string {
  const direct = socketIp?.trim() || "unknown";
  if (!trustProxyEnabled()) return direct;
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  const first = raw?.split(",")[0]?.trim();
  return first || direct;
}

function emailKey(email: string | null | undefined): string {
  const normalized = email?.trim().toLowerCase() ?? "";
  return normalized ? `email:${normalized}` : "";
}

function ipKey(ip: string): string {
  return `ip:${ip || "unknown"}`;
}

function retryAfter(key: string, max: number, now: number): number {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) return 0;
  if (current.count < max) return 0;
  return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
}

function bump(key: string, now: number): void {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  current.count += 1;
}

/** Read-only. Does not count the attempt. */
export function loginBlocked(
  ip: string,
  email: string | null | undefined,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  const { perIp, perEmail } = limits();
  const ipRetry = retryAfter(ipKey(ip), perIp, now);
  const key = emailKey(email);
  const emailRetry = key ? retryAfter(key, perEmail, now) : 0;
  if (ipRetry > 0 || emailRetry > 0) {
    return { ok: false, retryAfterSec: Math.max(ipRetry, emailRetry) };
  }
  return { ok: true };
}

/** Count one failed sign-in against the IP and, when present, the email. */
export function recordLoginFailure(
  ip: string,
  email: string | null | undefined,
  now = Date.now(),
): void {
  bump(ipKey(ip), now);
  const key = emailKey(email);
  if (key) bump(key, now);
}

/** Drop this email's failure count. The IP failure count stays. */
export function clearEmailLoginFailures(email: string | null | undefined): void {
  const key = emailKey(email);
  if (key) buckets.delete(key);
}
