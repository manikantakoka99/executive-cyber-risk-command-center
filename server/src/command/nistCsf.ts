/**
 * NIST CSF 2.0 mapping coverage (CSWP 29). ECC is aligned, never certified.
 * RS.CO and RC.CO are gaps and never count. Partial categories count when
 * their mapped domain has current evidence, and the UI labels them partial.
 */

import { DOMAINS } from "./model.js";

export const NIST_CSF_CODE = "nist_csf_2";
export const NIST_CSF_LABEL = "NIST CSF 2.0";
export const NIST_CATEGORY_TOTAL = 22;

export type NistFunctionName =
  | "Govern"
  | "Identify"
  | "Protect"
  | "Detect"
  | "Respond"
  | "Recover";

export interface NistCategory {
  id: string;
  name: string;
  fn: NistFunctionName;
  /** ECC risk_domains.code values. Empty means a platform capability, not a domain feed. */
  domains: string[];
  partial: boolean;
  gap: boolean;
}

export const NIST_CATEGORIES: NistCategory[] = [
  { id: "GV.OC", name: "Organizational Context", fn: "Govern", domains: ["vciso"], partial: false, gap: false },
  { id: "GV.RM", name: "Risk Management Strategy", fn: "Govern", domains: [], partial: false, gap: false },
  { id: "GV.RR", name: "Roles, Responsibilities, and Authorities", fn: "Govern", domains: [], partial: false, gap: false },
  { id: "GV.PO", name: "Policy", fn: "Govern", domains: [], partial: false, gap: false },
  { id: "GV.OV", name: "Oversight", fn: "Govern", domains: [], partial: false, gap: false },
  { id: "GV.SC", name: "Cybersecurity Supply Chain Risk Management", fn: "Govern", domains: ["third_party_risk"], partial: false, gap: false },
  { id: "ID.AM", name: "Asset Management", fn: "Identify", domains: ["vapt_asm", "ot_ics", "cspm_cnapp"], partial: true, gap: false },
  { id: "ID.RA", name: "Risk Assessment", fn: "Identify", domains: ["vapt_asm", "vciso"], partial: false, gap: false },
  { id: "ID.IM", name: "Improvement", fn: "Identify", domains: [], partial: false, gap: false },
  { id: "PR.AA", name: "Identity Management, Authentication, and Access Control", fn: "Protect", domains: ["iam_pam"], partial: false, gap: false },
  { id: "PR.AT", name: "Awareness and Training", fn: "Protect", domains: ["phishing_bec"], partial: true, gap: false },
  { id: "PR.DS", name: "Data Security", fn: "Protect", domains: ["pci_dss", "ai_governance"], partial: false, gap: false },
  { id: "PR.PS", name: "Platform Security", fn: "Protect", domains: ["cspm_cnapp", "ot_ics"], partial: false, gap: false },
  { id: "PR.IR", name: "Technology Infrastructure Resilience", fn: "Protect", domains: ["ransomware_readiness", "cspm_cnapp"], partial: false, gap: false },
  { id: "DE.CM", name: "Continuous Monitoring", fn: "Detect", domains: ["soc_mdr", "ot_ics", "cspm_cnapp"], partial: false, gap: false },
  { id: "DE.AE", name: "Adverse Event Analysis", fn: "Detect", domains: ["soc_mdr"], partial: false, gap: false },
  { id: "RS.MA", name: "Incident Management", fn: "Respond", domains: ["soc_mdr"], partial: true, gap: false },
  { id: "RS.AN", name: "Incident Analysis", fn: "Respond", domains: ["soc_mdr"], partial: true, gap: false },
  { id: "RS.CO", name: "Incident Response Reporting and Communication", fn: "Respond", domains: [], partial: false, gap: true },
  { id: "RS.MI", name: "Incident Mitigation", fn: "Respond", domains: ["soc_mdr", "ransomware_readiness"], partial: true, gap: false },
  { id: "RC.RP", name: "Incident Recovery Plan Execution", fn: "Recover", domains: ["ransomware_readiness"], partial: false, gap: false },
  { id: "RC.CO", name: "Incident Recovery Communication", fn: "Recover", domains: [], partial: false, gap: true },
];

export interface DomainEvidence {
  fresh: number;
  total: number;
  evidenceExpired?: boolean;
}

/**
 * A domain counts as covered when at least one of its connectors has synced
 * successfully (`fresh > 0`) and there is no open evidence_expired signal.
 * Unsynced connectors add to `total` but must not cancel synced ones — there is
 * no half-synced ratio. Unmapped connectors are never mapped into NIST
 * categories (see NIST_CATEGORIES.domains), so they never contribute here.
 */
export function domainHasCurrentEvidence(row: DomainEvidence | undefined): boolean {
  if (!row || row.total <= 0 || row.evidenceExpired) return false;
  return row.fresh > 0;
}

export function categoryCovered(
  category: NistCategory,
  evidence: Record<string, DomainEvidence>,
): boolean {
  if (category.gap) return false;
  if (category.domains.length === 0) return true;
  return category.domains.some((code) => domainHasCurrentEvidence(evidence[code]));
}

export interface NistFunctionScore {
  name: NistFunctionName;
  covered: number;
  total: number;
  gaps: string[];
  partial: string[];
}

export interface NistScore {
  label: typeof NIST_CSF_LABEL;
  empty?: false;
  coveragePct: number;
  evidenced: number;
  total: number;
  functions: NistFunctionScore[];
  note: string;
}

/** An org with no connector evidence. Never a borrowed score. */
export interface NistEmpty {
  label: typeof NIST_CSF_LABEL;
  empty: true;
  coveragePct: null;
  evidenced: 0;
  total: number;
  functions: [];
  note: "No evidence yet";
}

export type NistReading = NistScore | NistEmpty;

export function emptyNist(): NistEmpty {
  return {
    label: NIST_CSF_LABEL,
    empty: true,
    coveragePct: null,
    evidenced: 0,
    total: NIST_CATEGORY_TOTAL,
    functions: [],
    note: "No evidence yet",
  };
}

const FUNCTION_ORDER: NistFunctionName[] = [
  "Govern",
  "Identify",
  "Protect",
  "Detect",
  "Respond",
  "Recover",
];

const MODEL_DOMAIN_CODE: Record<string, string> = {
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

/** Command-model feed freshness used for the seeded NIST snapshot. */
export function modelDomainEvidence(): Record<string, DomainEvidence> {
  const evidence: Record<string, DomainEvidence> = {};
  for (const domain of DOMAINS) {
    const code = MODEL_DOMAIN_CODE[domain.id];
    if (!code) continue;
    evidence[code] = { fresh: domain.fresh, total: domain.total, evidenceExpired: false };
  }
  return evidence;
}

export function scoreNist(evidence: Record<string, DomainEvidence>): NistScore {
  const evidenced = NIST_CATEGORIES.filter((category) => categoryCovered(category, evidence)).length;
  const coveragePct = Math.round((10000 * evidenced) / NIST_CATEGORY_TOTAL) / 100;
  const functions = FUNCTION_ORDER.map((name) => {
    const rows = NIST_CATEGORIES.filter((category) => category.fn === name);
    const coveredRows = rows.filter((category) => categoryCovered(category, evidence));
    return {
      name,
      covered: coveredRows.length,
      total: rows.length,
      gaps: rows.filter((category) => category.gap).map((category) => category.id),
      partial: coveredRows.filter((category) => category.partial).map((category) => category.id),
    };
  });
  return {
    label: NIST_CSF_LABEL,
    coveragePct,
    evidenced,
    total: NIST_CATEGORY_TOTAL,
    functions,
    note: "Mapped to NIST CSF 2.0. NIST does not certify products or organizations.",
  };
}
