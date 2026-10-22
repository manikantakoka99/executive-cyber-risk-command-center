/** Default Vite origin. Never use `true` or `*` — fail closed when unset. */
export const DEFAULT_CORS_ORIGIN = "http://localhost:5173";

/**
 * Parse CORS_ORIGIN into an allowlist for @fastify/cors.
 * Unset or empty → [DEFAULT_CORS_ORIGIN]. Comma-separated list otherwise.
 */
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CORS_ORIGIN?.trim();
  if (!raw) return [DEFAULT_CORS_ORIGIN];
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [DEFAULT_CORS_ORIGIN];
}
