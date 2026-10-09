import { query } from "../db.js";
import type { SourceIdentifier } from "./types.js";

export type ResolvedAsset = {
  assetId: string | null;
  businessUnitId: string | null;
  businessProcessId: string | null;
  unresolved: Array<{ idType: string; idValue: string; normalizedValue: string }>;
};

function normalizeValue(idType: string, idValue: string): string {
  const v = idValue.trim();
  const t = idType.toLowerCase();
  if (t === "ip" || t === "ipv4" || t === "ipv6") return v.toLowerCase();
  if (t === "hostname" || t === "fqdn") return v.toLowerCase();
  return v;
}

/**
 * Exact-match entity resolution via asset_identifiers.
 * No fuzzy matching. Unresolved identifiers remain traceable.
 */
export async function resolveAssetFromIdentifiers(
  orgId: string,
  identifiers: SourceIdentifier[] | undefined,
): Promise<ResolvedAsset> {
  const unresolved: ResolvedAsset["unresolved"] = [];
  if (!identifiers?.length) {
    return { assetId: null, businessUnitId: null, businessProcessId: null, unresolved };
  }

  let assetId: string | null = null;

  for (const id of identifiers) {
    const idType = id.idType.toLowerCase().trim();
    const normalized = normalizeValue(idType, id.idValue);
    const { rows } = await query<{ asset_id: string }>(
      `SELECT asset_id FROM asset_identifiers
       WHERE org_id = $1 AND lower(id_type) = $2 AND lower(id_value) = lower($3)
       LIMIT 1`,
      [orgId, idType, normalized],
    );
    if (rows[0]) {
      assetId = rows[0].asset_id;
      break;
    }
    unresolved.push({
      idType,
      idValue: id.idValue,
      normalizedValue: normalized,
    });
  }

  // If no identifier match, try exact name match as last resort only when a hostname-like name is provided
  if (!assetId) {
    const host = identifiers.find((i) =>
      ["hostname", "fqdn", "name"].includes(i.idType.toLowerCase()),
    );
    if (host) {
      const { rows } = await query<{ asset_id: string }>(
        `SELECT asset_id FROM assets WHERE org_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [orgId, host.idValue.trim()],
      );
      if (rows[0]) {
        assetId = rows[0].asset_id;
        // remove matching unresolved entry
        const idx = unresolved.findIndex(
          (u) => u.idType === host.idType.toLowerCase() && u.idValue === host.idValue,
        );
        if (idx >= 0) unresolved.splice(idx, 1);
      }
    }
  }

  let businessUnitId: string | null = null;
  let businessProcessId: string | null = null;

  if (assetId) {
    const { rows } = await query<{ business_unit_id: string | null }>(
      `SELECT business_unit_id FROM assets WHERE org_id = $1 AND asset_id = $2`,
      [orgId, assetId],
    );
    businessUnitId = rows[0]?.business_unit_id ?? null;

    const { rows: bp } = await query<{ business_process_id: string }>(
      `SELECT business_process_id FROM asset_business_processes
       WHERE org_id = $1 AND asset_id = $2 LIMIT 1`,
      [orgId, assetId],
    );
    businessProcessId = bp[0]?.business_process_id ?? null;
  }

  return { assetId, businessUnitId, businessProcessId, unresolved };
}

/** Ensure asset_id belongs to org — for explicit asset references */
export async function assertAssetInOrg(orgId: string, assetId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM assets WHERE org_id = $1 AND asset_id = $2`,
    [orgId, assetId],
  );
  return Boolean(rows[0]);
}
