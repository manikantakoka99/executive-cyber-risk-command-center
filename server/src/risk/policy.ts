import { query } from "../db.js";

export type RiskPolicyConfig = {
  note?: string;
  temporal_window_hours: number;
  min_signals_for_scenario: number;
  min_severity_for_single_signal: string;
  likelihood_weights: Record<string, number>;
  impact_weights: Record<string, number>;
  control_reduction: Record<string, number>;
  tolerance: { default_max_residual: number; near_band: number };
  priority_bands: { critical: number; high: number; medium: number };
};

export type ActivePolicy = {
  policyId: string;
  version: string;
  code: string;
  config: RiskPolicyConfig;
};

const FALLBACK: RiskPolicyConfig = {
  note: "Hardcoded fallback if DB policy missing — prefer ecc_default 1.1.0",
  temporal_window_hours: 72,
  min_signals_for_scenario: 2,
  min_severity_for_single_signal: "critical",
  likelihood_weights: {
    threat_activity: 0.3,
    exposure_reachability: 0.25,
    exploitability: 0.2,
    control_weakness: 0.15,
    attack_evidence: 0.1,
  },
  impact_weights: {
    financial: 0.3,
    operational: 0.2,
    business_criticality: 0.25,
    regulatory_compliance: 0.15,
    data_impact: 0.1,
  },
  control_reduction: {
    effective: 0.45,
    partially_effective: 0.2,
    ineffective: 0,
    unknown: 0.05,
  },
  tolerance: { default_max_residual: 50, near_band: 10 },
  priority_bands: { critical: 80, high: 60, medium: 35 },
};

export async function loadActivePolicy(orgId: string): Promise<ActivePolicy> {
  // Org-specific active policy first, else platform default
  const { rows } = await query<{
    policy_id: string;
    version: string;
    code: string;
    config: RiskPolicyConfig;
  }>(
    `SELECT policy_id, version, code, config
     FROM risk_policies
     WHERE is_active = true
       AND (org_id = $1 OR org_id IS NULL)
     ORDER BY (org_id IS NOT NULL) DESC, effective_from DESC NULLS LAST
     LIMIT 1`,
    [orgId],
  );
  if (!rows[0]) {
    return {
      policyId: "00000000-0000-0000-0000-000000000000",
      version: "fallback",
      code: "ecc_fallback",
      config: FALLBACK,
    };
  }
  return {
    policyId: rows[0].policy_id,
    version: rows[0].version,
    code: rows[0].code,
    config: { ...FALLBACK, ...(rows[0].config as object) } as RiskPolicyConfig,
  };
}

export async function loadToleranceMax(
  orgId: string,
  assetCriticality?: string | null,
): Promise<{ maxResidual: number; ruleId: string | null }> {
  const { rows } = await query<{ tolerance_id: string; max_residual_risk: string }>(
    `SELECT tolerance_id, max_residual_risk::text
     FROM risk_tolerance_rules
     WHERE org_id = $1 AND is_active = true
       AND (asset_criticality::text = $2 OR asset_criticality IS NULL)
     ORDER BY (asset_criticality IS NOT NULL) DESC
     LIMIT 1`,
    [orgId, assetCriticality ?? null],
  );
  if (!rows[0]) {
    return { maxResidual: FALLBACK.tolerance.default_max_residual, ruleId: null };
  }
  return {
    maxResidual: Number(rows[0].max_residual_risk),
    ruleId: rows[0].tolerance_id,
  };
}
