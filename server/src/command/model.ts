/**
 * Reference executive scoring model.
 * Ported from the Executive Cyber Risk dashboard (illustrative parameters).
 * Snapshot anchor: 5 Sep 2026. Loss figures are AED millions per year.
 */

export const UNOBSERVED_ASSUMPTION = 60;
export const FLOOR_BAND: Band = "High";
export const SNAPSHOT_ISO = "2026-09-05";
export const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep"] as const;
export const BOARD_MONTH_INDEX = 2;

export type Band = "Critical" | "High" | "Medium" | "Low";

export interface DomainDef {
  id: string;
  name: string;
  csf: string;
  raw: number;
  coverage: number;
  weight: number;
  appetite: number;
  fresh: number;
  total: number;
  trend: number[];
}

export interface LossScenario {
  name: string;
  ale: number;
  p90: number;
  p95: number;
}

export const DOMAINS: DomainDef[] = [
  { id: "att", name: "Attack Surface and VAPT", csf: "Identify, Protect", raw: 76, coverage: 0.7, weight: 1.5, appetite: 40, fresh: 4, total: 4, trend: [70, 72, 74, 75, 76, 76] },
  { id: "soc", name: "SOC / MDR", csf: "Detect, Respond", raw: 72, coverage: 0.8, weight: 1.3, appetite: 45, fresh: 3, total: 4, trend: [66, 68, 70, 72, 73, 72] },
  { id: "tpr", name: "Third-Party Risk", csf: "Govern, Identify", raw: 65, coverage: 0.6, weight: 1.3, appetite: 50, fresh: 3, total: 3, trend: [60, 61, 63, 64, 65, 65] },
  { id: "ran", name: "Ransomware Readiness", csf: "Protect, Recover", raw: 54, coverage: 0.8, weight: 1.4, appetite: 40, fresh: 3, total: 4, trend: [60, 59, 57, 56, 55, 54] },
  { id: "pci", name: "PCI DSS / Data Security", csf: "Protect", raw: 50, coverage: 0.9, weight: 1.5, appetite: 35, fresh: 4, total: 4, trend: [52, 52, 51, 51, 50, 50] },
  { id: "ai", name: "AI Security and Governance", csf: "Govern, Protect", raw: 47, coverage: 0.5, weight: 0.8, appetite: 55, fresh: 2, total: 4, trend: [38, 40, 42, 44, 46, 47] },
  { id: "iam", name: "IAM / PAM", csf: "Protect", raw: 40, coverage: 0.85, weight: 1.2, appetite: 45, fresh: 4, total: 4, trend: [44, 43, 42, 41, 41, 40] },
  { id: "phi", name: "Phishing / BEC", csf: "Protect", raw: 29, coverage: 0.9, weight: 1.0, appetite: 40, fresh: 3, total: 3, trend: [33, 32, 31, 30, 29, 29] },
  { id: "gov", name: "vCISO / Cyber CoE", csf: "Govern", raw: 22, coverage: 1, weight: 0.6, appetite: 45, fresh: 2, total: 2, trend: [26, 25, 24, 23, 22, 22] },
  { id: "cld", name: "Cloud Security / CSPM", csf: "Protect", raw: 21, coverage: 0.75, weight: 1.0, appetite: 40, fresh: 3, total: 3, trend: [24, 23, 22, 22, 21, 21] },
  { id: "cmp", name: "Continuous Compliance", csf: "Lens across all", raw: 21, coverage: 1, weight: 0.8, appetite: 40, fresh: 2, total: 2, trend: [25, 24, 23, 22, 21, 21] },
  { id: "ot", name: "OT / ICS Security", csf: "Protect, Detect", raw: 17, coverage: 0.4, weight: 0.4, appetite: 50, fresh: 2, total: 2, trend: [19, 18, 18, 17, 17, 17] },
];

export const LOSS: Record<string, LossScenario> = {
  att: { name: "Payment gateway compromise", ale: 0.61, p90: 2.75, p95: 4.22 },
  ran: { name: "Ransomware outage", ale: 1.78, p90: 8.39, p95: 13.59 },
  tpr: { name: "Third-party breach", ale: 0.5, p90: 1.85, p95: 4.41 },
};

export const ENTERPRISE_LOSS = { ale: 2.89, p90: 10.07, p95: 14.94 };

export const RANSOM_CATEGORIES = [
  { key: "edr" as const, name: "EDR / XDR", weight: 25, gap: 52 },
  { key: "siem" as const, name: "SIEM / SOAR", weight: 20, gap: 30 },
  { key: "imm" as const, name: "Immutable backup", weight: 25, gap: 50 },
  { key: "dr" as const, name: "DR / recovery testing", weight: 30, gap: 75 },
];

export type GapKey = "edr" | "siem" | "imm" | "dr";

export const WHATIF_TODAY: Record<GapKey, number> = { edr: 52, siem: 30, imm: 50, dr: 75 };

export const WHATIF_PRESETS: Record<string, Record<GapKey, number>> = {
  now: { ...WHATIF_TODAY },
  A: { edr: 52, siem: 30, imm: 10, dr: 75 },
  B: { edr: 52, siem: 30, imm: 50, dr: 35 },
  C: { edr: 52, siem: 30, imm: 10, dr: 35 },
};

export const PRESET_NAMES: Record<string, string> = {
  now: "Today",
  A: "A. Fund immutable backup",
  B: "B. Fund recovery testing",
  C: "C. Both",
};

export interface ScoredDomain {
  domain: DomainDef;
  raw: number;
  adjusted: number;
  band: Band;
  confidence: number;
}

export interface Scorecard {
  rows: ScoredDomain[];
  arithmetic: number;
  plain: number;
  headline: Band;
  floored: boolean;
  counts: Record<Band, number>;
  confidence: number;
}

export function adjustedScore(raw: number, coverage: number): number {
  return coverage * raw + (1 - coverage) * Math.max(raw, UNOBSERVED_ASSUMPTION);
}

export function bandOf(score: number): Band {
  if (score >= 70) return "Critical";
  if (score >= 55) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

export function confidenceOf(domain: DomainDef): number {
  return (domain.fresh / domain.total) * domain.coverage;
}

export function confidenceLabel(c: number): "High" | "Medium" | "Low" {
  if (c >= 0.8) return "High";
  if (c >= 0.5) return "Medium";
  return "Low";
}

export type AppetiteState = "Outside appetite" | "Approaching" | "Within appetite";

export function appetiteState(adjusted: number, limit: number): AppetiteState {
  if (adjusted > limit) return "Outside appetite";
  if (adjusted > limit - 5) return "Approaching";
  return "Within appetite";
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function format1(n: number): string {
  return round1(n).toFixed(1);
}

export function format2(n: number): string {
  return round2(n).toFixed(2);
}

export function compute(
  list: DomainDef[] = DOMAINS,
  rawOverride?: Record<string, number>,
): Scorecard {
  const rows: ScoredDomain[] = list.map((domain) => {
    const raw = rawOverride && rawOverride[domain.id] != null ? rawOverride[domain.id]! : domain.raw;
    const adjusted = adjustedScore(raw, domain.coverage);
    return {
      domain,
      raw,
      adjusted,
      band: bandOf(adjusted),
      confidence: confidenceOf(domain),
    };
  });
  let weight = 0;
  let weighted = 0;
  let confidenceWeighted = 0;
  const counts: Record<Band, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const row of rows) {
    weight += row.domain.weight;
    weighted += row.adjusted * row.domain.weight;
    confidenceWeighted += row.confidence * row.domain.weight;
    counts[row.band] += 1;
  }
  const arithmetic = weighted / weight;
  let headline = bandOf(arithmetic);
  let floored = false;
  if (counts.Critical > 0 && (headline === "Medium" || headline === "Low")) {
    headline = FLOOR_BAND;
    floored = true;
  }
  const plain = rows.reduce((sum, row) => sum + row.raw, 0) / rows.length;
  return {
    rows,
    arithmetic,
    plain,
    headline,
    floored,
    counts,
    confidence: confidenceWeighted / weight,
  };
}

export const BASELINE = compute();

export function domainById(id: string): DomainDef | undefined {
  return DOMAINS.find((d) => d.id === id);
}

export function scoredById(id: string, card: Scorecard = BASELINE): ScoredDomain | undefined {
  return card.rows.find((r) => r.domain.id === id);
}

export function ransomRaw(gaps: Record<GapKey, number>): number {
  return RANSOM_CATEGORIES.reduce((sum, cat) => sum + (cat.weight * gaps[cat.key]) / 100, 0);
}

export function monthScorecards(): { month: string; card: Scorecard }[] {
  return MONTHS.map((month, index) => ({
    month,
    card: compute(
      DOMAINS,
      Object.fromEntries(DOMAINS.map((d) => [d.id, d.trend[index] ?? d.raw])),
    ),
  }));
}

export function boardComparison() {
  const current = BASELINE;
  const previous = compute(
    DOMAINS,
    Object.fromEntries(DOMAINS.map((d) => [d.id, d.trend[BOARD_MONTH_INDEX] ?? d.raw])),
  );
  return { current, previous, month: MONTHS[BOARD_MONTH_INDEX] };
}

export function feedTotals() {
  let fresh = 0;
  let total = 0;
  for (const domain of DOMAINS) {
    fresh += domain.fresh;
    total += domain.total;
  }
  return { fresh, total, stale: total - fresh };
}

export function weightedCoverage(): number {
  const weight = DOMAINS.reduce((sum, d) => sum + d.weight, 0);
  const covered = DOMAINS.reduce((sum, d) => sum + d.coverage * d.weight, 0);
  return covered / weight;
}

export function snapshotDate(): Date {
  return new Date(Date.UTC(2026, 8, 5));
}

export function daysFromSnapshot(days: number): string {
  const date = snapshotDate();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysUntil(iso: string): number {
  return Math.round((Date.parse(iso) - Date.UTC(2026, 8, 5)) / 864e5);
}

export function numWord(n: number): string {
  return ["Zero", "One", "Two", "Three", "Four", "Five"][n] ?? String(n);
}

export function describeScenario(
  gaps: Record<GapKey, number>,
  cost: string,
  preset: string | null,
) {
  const raw = ransomRaw(gaps);
  const after = compute(DOMAINS, { ran: raw });
  const ranAfter = after.rows.find((row) => row.domain.id === "ran")!;
  const before = BASELINE.rows.find((row) => row.domain.id === "ran")!;
  const red = LOSS.ran!.ale * (1 - ranAfter.adjusted / before.adjusted);
  const name = preset && PRESET_NAMES[preset] ? PRESET_NAMES[preset]! : "Custom scenario";
  return {
    name,
    score: format1(raw),
    lossAvoided: format2(red),
    cost,
    gaps,
  };
}
