/** Map workbook / source domain labels to ECC risk_domains.code — never invent a second taxonomy. */

export const WORKBOOK_DOMAIN_MAP: Record<string, string> = {
  "ai security & genai governance": "ai_governance",
  "phishing / bec defense": "phishing_bec",
  "ot / ics security": "ot_ics",
  "ransomware readiness": "ransomware_readiness",
  "attack surface & vapt": "vapt_asm",
  "soc / mdr": "soc_mdr",
  "cloud security / cspm / cnapp": "cspm_cnapp",
  "iam / pam": "iam_pam",
  "continuous compliance": "compliance_engine",
  "pci dss / data security": "pci_dss",
  "third-party / supply chain risk": "third_party_risk",
  "vciso / cyber coe": "vciso",
};

export function mapWorkbookDomain(domainLabel: string | null | undefined): {
  domainCode: string;
  unmapped: boolean;
} {
  const key = (domainLabel ?? "").trim().toLowerCase();
  if (!key) return { domainCode: "unmapped", unmapped: true };
  const mapped = WORKBOOK_DOMAIN_MAP[key];
  if (mapped) return { domainCode: mapped, unmapped: false };
  // Already an ECC code?
  const codes = new Set(Object.values(WORKBOOK_DOMAIN_MAP));
  if (codes.has(key)) return { domainCode: key, unmapped: false };
  return { domainCode: "unmapped", unmapped: true };
}

export function domainCodeToSourceType(domainCode: string): string {
  const map: Record<string, string> = {
    ai_governance: "ai",
    phishing_bec: "phishing",
    ot_ics: "ot",
    ransomware_readiness: "ransomware",
    vapt_asm: "vapt",
    soc_mdr: "soc",
    cspm_cnapp: "cloud",
    iam_pam: "iam",
    compliance_engine: "compliance",
    pci_dss: "pci",
    third_party_risk: "third_party",
    vciso: "vciso",
    unmapped: "unknown",
  };
  return map[domainCode] ?? "unknown";
}
