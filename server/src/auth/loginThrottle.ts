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

function blocked(key: string, max: number, now: number): number {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) return 0;
  if (current.count < max) return 0;
  return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
}

function commit(key: string, now: number): void {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  current.count += 1;
}

/** Count a sign-in attempt against the IP and, when present, the email. */
export function consumeLoginAttempt(
  ip: string,
  email: string | null | undefined,
  now = Date.now(),
): { ok: true } | { ok: false; retryAfterSec: number } {
  const { perIp, perEmail } = limits();
  const ipKey = `ip:${ip || "unknown"}`;
  const normalized = email?.trim().toLowerCase() ?? "";
  const emailKey = normalized ? `email:${normalized}` : "";
  const ipRetry = blocked(ipKey, perIp, now);
  const emailRetry = emailKey ? blocked(emailKey, perEmail, now) : 0;
  if (ipRetry > 0 || emailRetry > 0) {
    return { ok: false, retryAfterSec: Math.max(ipRetry, emailRetry) };
  }
  commit(ipKey, now);
  if (emailKey) commit(emailKey, now);
  return { ok: true };
}
