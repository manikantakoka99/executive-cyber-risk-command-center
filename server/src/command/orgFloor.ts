/**
 * Org headline from that org's domain snapshots.
 * Coverage and weights stay the command model; the raw score is the org's own.
 * org_id comes from the session (current_setting), never from a request field.
 */
import { query, sessionOrgId } from "../db.js";
import {
  DOMAINS,
  compute,
  type DomainDef,
  type Scorecard,
} from "./model.js";

/** risk_domains.code for each command-model domain. */
const DOMAIN_CODE: Record<string, string> = {
  att: "vapt_asm",
  soc: "soc_mdr",
  tpr: "third_party_risk",
  ran: "ransomware_readiness",
  pci: "pci_dss",
  ai: "ai_governance",
  iam: "iam_pam",
  phi: "phishing_bec",
  gov: "vciso",
  cld: "cspm_cnapp",
  cmp: "compliance_engine",
  ot: "ot_ics",
};

export function domainCode(id: string): string | undefined {
  return DOMAIN_CODE[id];
}

/**
 * Build a scorecard from raw domain scores keyed by risk_domains.code.
 * Domains the org has not scored are left out. No borrowed model raws.
 */
export function scorecardFromCodeScores(rawByCode: Record<string, number>): Scorecard | null {
  const list: DomainDef[] = [];
  const override: Record<string, number> = {};
  for (const domain of DOMAINS) {
    const code = DOMAIN_CODE[domain.id];
    if (!code) continue;
    const raw = rawByCode[code];
    if (raw == null || !Number.isFinite(raw)) continue;
    list.push(domain);
    override[domain.id] = raw;
  }
  if (list.length === 0) return null;
  return compute(list, override);
}

/** True when this card is the Al Dhabi command model, so its history can be shown. */
export function matchesModelRaws(card: Scorecard): boolean {
  if (card.rows.length !== DOMAINS.length) return false;
  return DOMAINS.every((domain) => {
    const row = card.rows.find((item) => item.domain.id === domain.id);
    return row != null && row.raw === domain.raw;
  });
}

/** Latest domain scores for the authenticated session org. */
export async function loadSessionScorecard(): Promise<Scorecard | null> {
  if (!sessionOrgId()) return null;
  const { rows } = await query<{ code: string; score: string }>(
    `SELECT DISTINCT ON (d.code) d.code, s.score::text
     FROM domain_risk_snapshots s
     JOIN risk_domains d ON d.risk_domain_id = s.risk_domain_id
     JOIN org_domain_subscriptions sub
       ON sub.org_id = s.org_id AND sub.risk_domain_id = s.risk_domain_id AND sub.is_active
     WHERE s.org_id = current_setting('app.current_org_id', true)::uuid
     ORDER BY d.code, s.snapshot_at DESC`,
  );
  const rawByCode: Record<string, number> = {};
  for (const row of rows) rawByCode[row.code] = Number(row.score);
  return scorecardFromCodeScores(rawByCode);
}
