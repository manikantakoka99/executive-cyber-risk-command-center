/**
 * Deterministic signal_kind classification — no LLM.
 *
 * Workbook Products and Samples rows are mostly posture ratios (numerator/denominator).
 * Event-like sample_records (verdict/incident/malware) under detection categories → event.
 */

export type SignalKind =
  | "event"
  | "posture_metric"
  | "assessment"
  | "compliance_observation";

const EVENT_CATEGORY =
  /\b(edr|xdr|siem|soar|sandbox|malware|threat|detection|ids|ips|ot soc|phishing simulation|url protection)\b/i;

const ASSESSMENT_CATEGORY =
  /\b(ai governance|governance|risk assessment|ai-spm|ai security)\b/i;

function payloadLooksLikeEvent(payloadText: string): boolean {
  const t = payloadText.toLowerCase();
  return (
    /"verdict"\s*:/.test(t) ||
    /"incident"\s*:/.test(t) ||
    /"malware"\s*:/.test(t) ||
    /<severity>/i.test(payloadText) ||
    /"alert"\s*:/.test(t) ||
    /"action"\s*:\s*"(blocked|quarantined|isolated)/i.test(t)
  );
}

export function classifySignalKind(input: {
  domain: string;
  toolCategory: string;
  metricId: string;
  payloadText: string;
  numerator: number | null;
  denominator: number | null;
}): SignalKind {
  const domain = input.domain.toLowerCase();
  const cat = input.toolCategory;

  if (
    domain.includes("continuous compliance") ||
    domain.includes("pci dss")
  ) {
    return "compliance_observation";
  }

  if (
    ASSESSMENT_CATEGORY.test(cat) ||
    /M01-1|M01-4|M12-4/i.test(input.metricId)
  ) {
    // AI assess / governance / strategic assessment metrics
    if (/governance|assessed|ai-spm|ai security/i.test(cat)) {
      return "assessment";
    }
  }

  if (EVENT_CATEGORY.test(cat) && payloadLooksLikeEvent(input.payloadText)) {
    return "event";
  }

  // Default: workbook ratio observations
  if (input.numerator != null && input.denominator != null) {
    return "posture_metric";
  }

  if (payloadLooksLikeEvent(input.payloadText)) return "event";
  return "posture_metric";
}

/** Map kind + category → taxonomy event_type (must exist in signal_event_types). */
export function eventTypeForKind(
  kind: SignalKind,
  toolCategory: string,
  payloadText: string,
): string {
  const cat = toolCategory.toLowerCase();
  const p = payloadText.toLowerCase();

  if (kind === "posture_metric") return "security_posture_change";
  if (kind === "assessment") return "risk_assessment_update";
  if (kind === "compliance_observation") return "compliance_observation";

  // event
  if (/phishing|email|sandbox|url protection/.test(cat) || /phish|bec/.test(p))
    return "phishing_detected";
  if (/edr|xdr|malware/.test(cat) || /malware/.test(p)) return "malware_detection";
  if (/siem|soar|sentinel|splunk/.test(cat) || /incident/.test(p))
    return "suspicious_process";
  if (/iam|pam|entra|okta|auth/.test(cat)) return "authentication_anomaly";
  if (/vapt|nmap|burp|asm|attack surface|sql injection/.test(cat + p))
    return "vulnerability_detected";
  if (/cloud|cspm|cnapp|wiz/.test(cat)) return "misconfiguration";
  if (/ransomware|backup/.test(cat)) return "ransomware_indicator";
  if (/ot|ics|industrial/.test(cat)) return "industrial_anomaly";
  if (/ai|llm|genai|lakera/.test(cat)) return "model_security_event";
  return "unknown_event";
}
