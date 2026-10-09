import { createHash } from "node:crypto";

/** Fixed demo timeline — clearly synthetic, not live telemetry */
export const DEMO_AS_OF = "2026-10-07T09:00:00.000Z";
export const DEMO_DUE_DATE = "2026-10-21";
export const DEMO_OWNER_LABEL = "Security Engineering";

export const HERO_SCENARIO_TITLE =
  "Potential compromise of externally exposed payment infrastructure";

export function demoUuid(orgId: string, key: string): string {
  const h = createHash("sha256").update(`ecc-demo:${orgId}:${key}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
