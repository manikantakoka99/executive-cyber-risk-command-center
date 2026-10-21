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

/**
 * Hop count, matching Express `trust proxy` = N.
 * The socket is hop 0. A positive integer walks that many addresses into
 * X-Forwarded-For from the right. Unset, 0, and any non-integer (including
 * true/on) trust nothing, so a client cannot choose the throttle key.
 */
export function trustProxyHops(): number {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase() ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return 0;
  return Number(raw);
}

/**
 * Socket address unless TRUST_PROXY is a hop count.
 * Addresses are ordered nearest-first (socket, then X-Forwarded-For from the
 * right), and the client is the first untrusted hop, the same walk Express uses.
 * A spoofed leftmost entry is farther away and does not change the key.
 */
export function loginClientIp(
  socketIp: string | undefined,
  forwardedFor: string | string[] | undefined,
): string {
  const direct = socketIp?.trim() || "unknown";
  const hops = trustProxyHops();
  if (hops < 1) return direct;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(",") : (forwardedFor ?? "");
  const fromRight = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .reverse();
  const addrs = [direct, ...fromRight];
  for (let i = 0; i < addrs.length - 1; i += 1) {
    if (i < hops) continue;
    return addrs[i] || direct;
  }
  return addrs[addrs.length - 1] || direct;
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
