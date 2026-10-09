import type { RiskPolicyConfig } from "./policy.js";

export type FactorValue = {
  code: string;
  label: string;
  raw: number; // 0–100
  note: string;
};

const SEV_SCORE: Record<string, number> = {
  info: 10,
  low: 25,
  medium: 50,
  high: 75,
  critical: 95,
};

export function severityScore(sev: string | null | undefined): number {
  return SEV_SCORE[(sev ?? "medium").toLowerCase()] ?? 50;
}

export function weightedAverage(
  factors: FactorValue[],
  weights: Record<string, number>,
): { score: number; used: FactorValue[] } {
  let num = 0;
  let den = 0;
  const used: FactorValue[] = [];
  for (const f of factors) {
    const w = weights[f.code];
    if (w === undefined || w <= 0) continue;
    num += f.raw * w;
    den += w;
    used.push(f);
  }
  if (den === 0) return { score: 0, used };
  return { score: round2(num / den), used };
}

/** Inherent = geometric-ish blend of L×I normalized to 0–100: sqrt(L*I) */
export function inherentRisk(likelihood: number, impact: number): number {
  return round2(Math.sqrt(Math.max(0, likelihood) * Math.max(0, impact)));
}

export function residualRisk(
  inherent: number,
  effectiveness: "effective" | "partially_effective" | "ineffective" | "unknown",
  config: RiskPolicyConfig,
): { residual: number; reduction: number } {
  const reduction = config.control_reduction[effectiveness] ?? 0.05;
  const residual = round2(inherent * (1 - reduction));
  return { residual, reduction: round2(reduction * 100) };
}

export function priorityFromResidual(
  residual: number,
  bands: RiskPolicyConfig["priority_bands"],
  boosts: { criticalAsset?: boolean; outsideTolerance?: boolean; increasing?: boolean },
): { score: number; tier: "critical" | "high" | "medium" | "low" } {
  let score = residual;
  if (boosts.criticalAsset) score += 8;
  if (boosts.outsideTolerance) score += 10;
  if (boosts.increasing) score += 5;
  score = Math.min(100, score);
  const tier =
    score >= bands.critical
      ? "critical"
      : score >= bands.high
        ? "high"
        : score >= bands.medium
          ? "medium"
          : "low";
  return { score: round2(score), tier };
}

export function toleranceState(
  residual: number,
  maxResidual: number,
  nearBand: number,
): { state: "within" | "near" | "outside"; reason: string } {
  if (residual > maxResidual) {
    return {
      state: "outside",
      reason: `Residual risk ${residual} exceeds policy threshold ${maxResidual}.`,
    };
  }
  if (residual >= maxResidual - nearBand) {
    return {
      state: "near",
      reason: `Residual risk ${residual} is within ${nearBand} pts of threshold ${maxResidual}.`,
    };
  }
  return {
    state: "within",
    reason: `Residual risk ${residual} is within tolerance (max ${maxResidual}).`,
  };
}

export function confidenceScore(input: {
  signalCount: number;
  domainCount: number;
  assetResolved: boolean;
  hasBusinessContext: boolean;
  hasFinancial: boolean;
  controlKnown: boolean;
  freshnessHours: number;
}): { score: number; label: "high" | "medium" | "low"; notes: string[] } {
  let score = 40;
  const notes: string[] = [];
  if (input.signalCount >= 3) {
    score += 20;
    notes.push("≥3 supporting signals");
  } else if (input.signalCount >= 2) {
    score += 12;
    notes.push("2 supporting signals");
  } else {
    notes.push("single-signal evidence");
  }
  if (input.domainCount >= 2) {
    score += 12;
    notes.push("cross-domain evidence");
  }
  if (input.assetResolved) {
    score += 10;
    notes.push("asset resolved");
  } else {
    score -= 8;
    notes.push("asset unresolved");
  }
  if (input.hasBusinessContext) {
    score += 8;
    notes.push("business context present");
  } else {
    notes.push("business context incomplete");
  }
  if (input.hasFinancial) {
    score += 6;
    notes.push("financial exposure known");
  } else {
    score -= 4;
    notes.push("financial exposure unknown");
  }
  if (input.controlKnown) {
    score += 6;
    notes.push("control effectiveness assessed");
  } else {
    notes.push("control effectiveness unknown");
  }
  if (input.freshnessHours <= 24) score += 6;
  else if (input.freshnessHours > 168) score -= 8;

  score = Math.max(5, Math.min(98, score));
  const label = score >= 75 ? "high" : score >= 50 ? "medium" : "low";
  return { score: round2(score), label, notes };
}

export function velocityFrom(
  firstSeen: Date,
  lastSeen: Date,
  priorResidual: number | null,
  currentResidual: number,
): "new" | "increasing" | "stable" | "decreasing" | "aging" {
  const ageHours = (Date.now() - firstSeen.getTime()) / 3600000;
  if (ageHours < 24 && priorResidual === null) return "new";
  if (priorResidual !== null) {
    if (currentResidual > priorResidual + 5) return "increasing";
    if (currentResidual < priorResidual - 5) return "decreasing";
  }
  const staleHours = (Date.now() - lastSeen.getTime()) / 3600000;
  if (staleHours > 168) return "aging";
  return "stable";
}

export function buildExplanation(parts: {
  title: string;
  residual: number;
  inherent: number;
  likelihood: number;
  impact: number;
  effectiveness: string;
  tolerance: string;
  confidenceLabel: string;
  confidenceNotes: string[];
  domains: string[];
  assetName?: string | null;
  processName?: string | null;
  financialKnown: boolean;
}): string {
  const domainTxt = parts.domains.length
    ? parts.domains.join(" + ")
    : "one or more domains";
  const assetTxt = parts.assetName
    ? `asset "${parts.assetName}"`
    : "an unresolved or unspecified asset";
  const procTxt = parts.processName
    ? ` supporting process "${parts.processName}"`
    : "";
  const money = parts.financialKnown
    ? "Estimated business exposure is significant based on linked impact data."
    : "Financial exposure is unknown; confidence is reduced accordingly.";
  const ctrl =
    parts.effectiveness === "effective"
      ? `Inherent risk is ${tierWord(parts.inherent)}, but effective controls reduce residual risk to ${tierWord(parts.residual)}.`
      : parts.effectiveness === "ineffective"
        ? `Inherent risk is ${tierWord(parts.inherent)} and residual risk remains ${tierWord(parts.residual)} because key controls are ineffective.`
        : `Inherent risk is ${tierWord(parts.inherent)}; residual risk is ${tierWord(parts.residual)} with ${parts.effectiveness.replace(/_/g, " ")} control posture.`;

  return [
    `${parts.title}.`,
    `Cross-domain evidence (${domainTxt}) affects ${assetTxt}${procTxt}.`,
    `Likelihood ${parts.likelihood}/100 × Impact ${parts.impact}/100 → inherent ${parts.inherent}/100.`,
    ctrl,
    money,
    `Tolerance: ${parts.tolerance}`,
    `Confidence is ${parts.confidenceLabel} (${parts.confidenceNotes.slice(0, 3).join("; ")}).`,
  ].join(" ");
}

function tierWord(score: number): string {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { SEV_SCORE };
