import { query } from "../db.js";
import { correlateReadySignals, correlateSignal } from "../risk/correlation.js";
import { recalculateScenario } from "../risk/assessment.js";
import { getScenarioImpact } from "../risk/scenarioImpact.js";
import { getRecommendation } from "../risk/recommendation.js";
import {
  getTreatmentPlan,
  listActions,
  listScenarioDecisions,
  listVerifications,
  refreshScenarioIntelligence,
} from "./closedLoop.js";
import { DEMO_AS_OF, demoUuid, HERO_SCENARIO_TITLE } from "./demoConstants.js";

export { HERO_SCENARIO_TITLE };

export async function listScenarios(
  orgId: string,
  filters: {
    status?: string;
    priority?: string;
    domain?: string;
    businessUnit?: string;
    businessProcess?: string;
    asset?: string;
    toleranceState?: string;
    limit?: number;
  } = {},
) {
  const params: unknown[] = [orgId];
  const where = ["s.org_id = $1"];
  if (filters.status) {
    params.push(filters.status);
    where.push(`s.status::text = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    where.push(`s.priority::text = $${params.length}`);
  }
  if (filters.toleranceState) {
    params.push(filters.toleranceState);
    where.push(`s.tolerance_state::text = $${params.length}`);
  }
  if (filters.domain) {
    params.push(filters.domain);
    where.push(`EXISTS (
      SELECT 1 FROM risk_scenario_domains rd
      JOIN risk_domains d ON d.risk_domain_id = rd.risk_domain_id
      WHERE rd.scenario_id = s.scenario_id AND rd.org_id = s.org_id
        AND d.code::text = $${params.length})`);
  }
  if (filters.businessUnit) {
    params.push(filters.businessUnit);
    where.push(`s.business_unit_id::text = $${params.length}`);
  }
  if (filters.businessProcess) {
    params.push(filters.businessProcess);
    where.push(`s.business_process_id::text = $${params.length}`);
  }
  if (filters.asset) {
    params.push(filters.asset);
    where.push(`EXISTS (
      SELECT 1 FROM risk_scenario_assets ra
      WHERE ra.scenario_id = s.scenario_id AND ra.org_id = s.org_id
        AND ra.asset_id::text = $${params.length})`);
  }
  const limit = Math.min(filters.limit ?? 100, 200);
  params.push(limit);

  const { rows } = await query(
    `SELECT s.*,
            a.name AS primary_asset_name,
            d.short_label AS primary_domain_label,
            ra.residual_risk, ra.inherent_risk, ra.likelihood_score, ra.impact_score,
            ra.confidence
     FROM risk_scenarios s
     LEFT JOIN assets a ON a.asset_id = s.primary_asset_id AND a.org_id = s.org_id
     LEFT JOIN risk_domains d ON d.risk_domain_id = s.primary_domain_id
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(s.priority_score, 0) DESC, s.last_seen_at DESC NULLS LAST
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapScenarioSummary);
}

export async function getScenario(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT s.*,
            a.name AS primary_asset_name,
            d.short_label AS primary_domain_label,
            bp.name AS business_process_name
     FROM risk_scenarios s
     LEFT JOIN assets a ON a.asset_id = s.primary_asset_id AND a.org_id = s.org_id
     LEFT JOIN risk_domains d ON d.risk_domain_id = s.primary_domain_id
     LEFT JOIN business_processes bp ON bp.business_process_id = s.business_process_id AND bp.org_id = s.org_id
     WHERE s.org_id = $1 AND s.scenario_id = $2`,
    [orgId, scenarioId],
  );
  if (!rows[0]) return null;

  const [domains, signals, findings, assets, controls, assessments, evidence, correlations] =
    await Promise.all([
      query(
        `SELECT d.risk_domain_id, d.code::text AS code, d.short_label
         FROM risk_scenario_domains rd JOIN risk_domains d ON d.risk_domain_id = rd.risk_domain_id
         WHERE rd.org_id=$1 AND rd.scenario_id=$2`,
        [orgId, scenarioId],
      ),
      query(
        `SELECT s.signal_id, s.event_type, s.severity::text, s.title, s.observed_at, s.source_type
         FROM risk_scenario_signals rs
         JOIN security_signals s ON s.signal_id = rs.signal_id
         WHERE rs.org_id=$1 AND rs.scenario_id=$2 ORDER BY s.observed_at DESC`,
        [orgId, scenarioId],
      ),
      query(
        `SELECT f.finding_id, f.title, f.severity::text, f.status::text
         FROM risk_scenario_findings rf JOIN risk_findings f ON f.finding_id = rf.finding_id
         WHERE rf.org_id=$1 AND rf.scenario_id=$2`,
        [orgId, scenarioId],
      ),
      query(
        `SELECT a.asset_id, a.name, a.criticality::text, a.internet_exposed
         FROM risk_scenario_assets ra JOIN assets a ON a.asset_id = ra.asset_id
         WHERE ra.org_id=$1 AND ra.scenario_id=$2`,
        [orgId, scenarioId],
      ),
      query(
        `SELECT c.control_id, c.name, sc.effectiveness::text, sc.effectiveness_score,
                sc.assessment_status, sc.evidence_note
         FROM scenario_controls sc JOIN controls c ON c.control_id = sc.control_id
         WHERE sc.org_id=$1 AND sc.scenario_id=$2`,
        [orgId, scenarioId],
      ),
      query(
        `SELECT risk_assessment_id, likelihood_score, impact_score, inherent_risk, residual_risk,
                confidence, control_adjustment, priority_score, priority_tier::text,
                tolerance_state::text, tolerance_reason, velocity::text, explanation,
                policy_version, calculated_at, is_current, calculation_meta
         FROM risk_assessments
         WHERE org_id=$1 AND scenario_id=$2
         ORDER BY calculated_at DESC`,
        [orgId, scenarioId],
      ),
      query(
        `SELECT e.evidence_id, e.source, e.evidence_type, e.source_reference, se.link_reason
         FROM scenario_evidence se JOIN evidence e ON e.evidence_id = se.evidence_id
         WHERE se.org_id=$1 AND se.scenario_id=$2`,
        [orgId, scenarioId],
      ),
      query(
        `SELECT rule_code, action, reason, created_at, signal_id
         FROM correlation_events
         WHERE org_id=$1 AND scenario_id=$2
         ORDER BY created_at DESC LIMIT 50`,
        [orgId, scenarioId],
      ),
    ]);

  const current = assessments.rows.find((a) => a.is_current) ?? assessments.rows[0] ?? null;

  const [impact, recommendation, treatment, decisions, actions, verifications] =
    await Promise.all([
      getScenarioImpact(orgId, scenarioId),
      getRecommendation(orgId, scenarioId),
      getTreatmentPlan(orgId, scenarioId),
      listScenarioDecisions(orgId, scenarioId),
      listActions(orgId, scenarioId),
      listVerifications(orgId, scenarioId),
    ]);

  return {
    ...mapScenarioSummary(rows[0]),
    businessProcessName: rows[0].business_process_name,
    explanation: rows[0].explanation,
    decisionRequired: rows[0].decision_required,
    domains: domains.rows,
    signals: signals.rows,
    findings: findings.rows,
    assets: assets.rows,
    controls: controls.rows,
    currentAssessment: current,
    assessments: assessments.rows,
    evidence: evidence.rows,
    correlationEvents: correlations.rows,
    businessImpact: impact,
    recommendation,
    treatment,
    decisions,
    actions,
    verifications,
  };
}

export async function listAssessments(orgId: string, scenarioId: string) {
  const s = await getScenario(orgId, scenarioId);
  if (!s) return null;
  const { rows: factors } = await query(
    `SELECT risk_assessment_id, factor_category, factor_code, factor_label,
            normalized_value, contribution_note
     FROM risk_assessment_factors
     WHERE org_id = $1 AND risk_assessment_id = ANY($2::uuid[])`,
    [orgId, s.assessments.map((a: any) => a.risk_assessment_id)],
  );
  return { assessments: s.assessments, factors };
}

export async function recalculate(orgId: string, scenarioId: string) {
  const { rows } = await query(
    `SELECT 1 FROM risk_scenarios WHERE org_id=$1 AND scenario_id=$2`,
    [orgId, scenarioId],
  );
  if (!rows[0]) return null;
  const result = await recalculateScenario(orgId, scenarioId);
  const intelligence = await refreshScenarioIntelligence(orgId, scenarioId);
  return { ...result, ...intelligence };
}

export { correlateSignal, correlateReadySignals };

function mapScenarioSummary(s: Record<string, unknown>) {
  return {
    scenarioId: s.scenario_id,
    orgId: s.org_id,
    title: s.title,
    description: s.description,
    scenarioType: s.scenario_type,
    status: s.status,
    priority: s.priority,
    priorityScore: s.priority_score != null ? Number(s.priority_score) : null,
    toleranceState: s.tolerance_state,
    toleranceReason: s.tolerance_reason,
    velocity: s.velocity,
    firstSeenAt: s.first_seen_at,
    lastSeenAt: s.last_seen_at,
    primaryAssetId: s.primary_asset_id,
    primaryAssetName: s.primary_asset_name,
    primaryDomainLabel: s.primary_domain_label,
    businessUnitId: s.business_unit_id,
    businessProcessId: s.business_process_id,
    explanation: s.explanation,
    isDemo: s.is_demo,
    decisionRequired: s.decision_required,
    residualRisk: s.residual_risk != null ? Number(s.residual_risk) : null,
    inherentRisk: s.inherent_risk != null ? Number(s.inherent_risk) : null,
    likelihoodScore: s.likelihood_score != null ? Number(s.likelihood_score) : null,
    impactScore: s.impact_score != null ? Number(s.impact_score) : null,
    confidence: s.confidence != null ? Number(s.confidence) : null,
  };
}

function sourceTypeForDomain(domainCode: string): string {
  if (domainCode.startsWith("iam")) return "iam";
  if (domainCode.startsWith("phish")) return "phishing";
  if (domainCode.startsWith("cspm")) return "cloud";
  if (domainCode.startsWith("ransom")) return "ransomware";
  if (domainCode.startsWith("vapt")) return "vapt";
  return "soc";
}

/** Seed four synthetic cross-domain demo scenarios for an org */
export async function seedDemoScenarios(orgId: string) {
  // Serialize re-seeds (Phase 3/4 tests may call concurrently).
  await query(`SELECT pg_advisory_lock(hashtext('ecc_seed_demo_' || $1::text))`, [orgId]);
  try {
    // Clean prior demos for idempotent re-runs.
    // Composite FKs with ON DELETE SET NULL would null org_id — delete dependents first.
    const demoFilter = `SELECT scenario_id FROM risk_scenarios WHERE org_id = $1 AND is_demo = true`;
    await query(
      `DELETE FROM risk_verifications WHERE org_id = $1 AND scenario_id IN (${demoFilter})`,
      [orgId],
    );
    await query(
      `DELETE FROM correlation_events WHERE org_id = $1 AND scenario_id IN (${demoFilter})`,
      [orgId],
    );
    await query(
      `DELETE FROM actions WHERE org_id = $1 AND scenario_id IN (${demoFilter})`,
      [orgId],
    );
    await query(
      `DELETE FROM executive_decisions WHERE org_id = $1 AND scenario_id IN (${demoFilter})`,
      [orgId],
    );
    await query(`DELETE FROM risk_scenarios WHERE org_id = $1 AND is_demo = true`, [orgId]);
    await query(
      `DELETE FROM security_signals WHERE org_id = $1 AND (
         source_name = 'demo_seed' OR fingerprint LIKE 'ecc-demo-%'
       )`,
      [orgId],
    );
    await query(
      `DELETE FROM business_impact_assessments WHERE org_id = $1 AND finding_id IN (
         SELECT finding_id FROM risk_findings WHERE org_id = $1 AND fingerprint LIKE 'ecc-demo-%'
       )`,
      [orgId],
    );
    await query(
      `DELETE FROM risk_findings WHERE org_id = $1 AND fingerprint LIKE 'ecc-demo-%'`,
      [orgId],
    );
    await query(`DELETE FROM evidence WHERE org_id = $1 AND source = 'ecc-demo'`, [orgId]);

    const { rows: domains } = await query<{ risk_domain_id: string; code: string }>(
      `SELECT risk_domain_id, code::text AS code FROM risk_domains`,
    );
    const dom = Object.fromEntries(domains.map((d) => [d.code, d.risk_domain_id]));

    async function ensureAsset(name: string, exposed: boolean, crit: string) {
      await query(
        `INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
         VALUES ($1,$2,'application',$3::asset_criticality,'production',$4,'active')
         ON CONFLICT (org_id, name) DO UPDATE SET internet_exposed = EXCLUDED.internet_exposed,
           criticality = EXCLUDED.criticality`,
        [orgId, name, crit, exposed],
      );
      const { rows } = await query<{ asset_id: string }>(
        `SELECT asset_id FROM assets WHERE org_id=$1 AND name=$2`,
        [orgId, name],
      );
      return rows[0]!.asset_id;
    }

    async function ensurePayBu(): Promise<string | null> {
      await query(
        `INSERT INTO business_units (org_id, code, name)
         VALUES ($1,'PAY','Payments') ON CONFLICT (org_id, name) DO NOTHING`,
        [orgId],
      );
      const { rows } = await query<{ business_unit_id: string }>(
        `SELECT business_unit_id FROM business_units WHERE org_id=$1 AND code='PAY' LIMIT 1`,
        [orgId],
      );
      return rows[0]?.business_unit_id ?? null;
    }

    async function ensureProcess(name: string, buId: string | null) {
      const { rows } = await query<{ business_process_id: string }>(
        `SELECT business_process_id FROM business_processes WHERE org_id=$1 AND name=$2 LIMIT 1`,
        [orgId, name],
      );
      if (rows[0]) {
        if (buId) {
          await query(
            `UPDATE business_processes SET business_unit_id = COALESCE(business_unit_id, $3)
             WHERE org_id=$1 AND name=$2`,
            [orgId, name, buId],
          );
        }
        return rows[0].business_process_id;
      }
      const { rows: ins } = await query<{ business_process_id: string }>(
        `INSERT INTO business_processes (org_id, business_unit_id, name, criticality)
         VALUES ($1,$2,$3,'critical') RETURNING business_process_id`,
        [orgId, buId, name],
      );
      return ins[0]!.business_process_id;
    }

    async function ensureControl(name: string, eff: string) {
      await query(
        `INSERT INTO controls (org_id, name, control_type, status, description)
         VALUES ($1,$2,'preventive','implemented',$3)
         ON CONFLICT (org_id, name) DO NOTHING`,
        [orgId, name, "Synthetic demo control — not a production assessment"],
      );
      const { rows } = await query<{ control_id: string }>(
        `SELECT control_id FROM controls WHERE org_id=$1 AND name=$2`,
        [orgId, name],
      );
      return { controlId: rows[0]!.control_id, eff };
    }

    const payBu = await ensurePayBu();
    const paymentAsset = await ensureAsset("demo-payment-gateway", true, "critical");
    const cloudAsset = await ensureAsset("demo-public-api", true, "high");
    const backupAsset = await ensureAsset("demo-backup-controller", false, "critical");
    const mailboxAsset = await ensureAsset("demo-exec-mailbox", true, "high");
    const payProc = await ensureProcess("Payment Processing", payBu);

    await query(
      `INSERT INTO asset_business_processes (asset_id, business_process_id, org_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [paymentAsset, payProc, orgId],
    );
    if (payBu) {
      await query(`UPDATE assets SET business_unit_id = $3 WHERE org_id=$1 AND asset_id=$2`, [
        orgId,
        paymentAsset,
        payBu,
      ]);
    }

    const ctrlBackup = await ensureControl("Immutable backups", "ineffective");
    const ctrlEdr = await ensureControl("EDR coverage", "partially_effective");
    const ctrlMfa = await ensureControl("Privileged MFA", "partially_effective");
    const ctrlPatch = await ensureControl("Emergency patching", "unknown");

    type DemoDef = {
      key: string;
      title: string;
      type: string;
      asset: string;
      process: string | null;
      bu: string | null;
      domains: string[];
      events: [string, string, string][];
      controls: { controlId: string; eff: string }[];
      withFinding?: boolean;
    };

    const demos: DemoDef[] = [
      {
        key: "hero-payment",
        title: HERO_SCENARIO_TITLE,
        type: "cross_domain_compromise",
        asset: paymentAsset,
        process: payProc,
        bu: payBu,
        domains: ["soc_mdr", "vapt_asm", "iam_pam", "ransomware_readiness"],
        events: [
          ["soc_mdr", "suspicious_process", "critical"],
          ["vapt_asm", "exposed_service", "high"],
          ["iam_pam", "privilege_escalation", "high"],
          ["ransomware_readiness", "backup_control_failure", "high"],
        ],
        controls: [ctrlEdr, ctrlBackup],
        withFinding: true,
      },
      {
        key: "vuln-api",
        title: "Critical vulnerability on internet-facing business API",
        type: "vuln_exposure",
        asset: cloudAsset,
        process: null,
        bu: null,
        domains: ["vapt_asm", "cspm_cnapp"],
        events: [
          ["vapt_asm", "vulnerability_detected", "critical"],
          ["cspm_cnapp", "public_exposure", "high"],
        ],
        controls: [ctrlPatch],
      },
      {
        key: "ransomware",
        title: "Ransomware resilience risk on critical recovery path",
        type: "ransomware_resilience",
        asset: backupAsset,
        process: payProc,
        bu: payBu,
        domains: ["ransomware_readiness", "soc_mdr"],
        events: [
          ["ransomware_readiness", "backup_control_failure", "high"],
          ["ransomware_readiness", "ransomware_indicator", "critical"],
          ["soc_mdr", "malware_detection", "high"],
        ],
        controls: [ctrlBackup],
      },
      {
        key: "credential",
        title: "Credential compromise path via phishing and privileged access",
        type: "credential_compromise",
        asset: mailboxAsset,
        process: null,
        bu: null,
        domains: ["phishing_bec", "iam_pam"],
        events: [
          ["phishing_bec", "phishing_detected", "high"],
          ["iam_pam", "privileged_login", "medium"],
        ],
        controls: [ctrlMfa],
      },
    ];

    const created: string[] = [];
    let heroScenarioId: string | null = null;
    const asOf = DEMO_AS_OF;

    for (const d of demos) {
      const sid = demoUuid(orgId, `scenario:${d.key}`);
      await query(
        `INSERT INTO risk_scenarios (
           scenario_id, org_id, title, description, status, scenario_type, primary_asset_id,
           primary_domain_id, business_unit_id, business_process_id,
           first_seen_at, last_seen_at, is_demo
         ) VALUES (
           $1,$2,$3,$4,'active',$5,$6,$7,$8,$9,
           $10::timestamptz - interval '6 hours', $10::timestamptz, true
         )`,
        [
          sid,
          orgId,
          d.title,
          `DEMO · Synthetic scenario (${d.type}) — not real client or vendor telemetry`,
          d.type,
          d.asset,
          dom[d.domains[0]],
          d.bu,
          d.process,
          asOf,
        ],
      );
      created.push(sid);
      if (d.key === "hero-payment") heroScenarioId = sid;

      for (const code of d.domains) {
        if (!dom[code]) continue;
        await query(
          `INSERT INTO risk_scenario_domains (scenario_id, risk_domain_id, org_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [sid, dom[code], orgId],
        );
      }
      await query(
        `INSERT INTO risk_scenario_assets (scenario_id, asset_id, org_id) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [sid, d.asset, orgId],
      );
      for (const c of d.controls) {
        await query(
          `INSERT INTO scenario_controls
             (scenario_id, control_id, org_id, effectiveness, assessment_status, evidence_note)
           VALUES ($1,$2,$3,$4::control_effectiveness,'assessed',$5)
           ON CONFLICT DO NOTHING`,
          [sid, c.controlId, orgId, c.eff, "DEMO control assessment (synthetic)"],
        );
      }

      for (const [domainCode, eventType, sev] of d.events) {
        const signalId = demoUuid(orgId, `signal:${d.key}:${eventType}`);
        const fp = `ecc-demo-${d.key}-${eventType}`;
        await query(
          `INSERT INTO security_signals (
             signal_id, org_id, risk_domain_id, event_type, severity, asset_id, observed_at,
             title, source_type, source_name, lifecycle_status, fingerprint,
             evidence_refs, vendor_extensions, business_unit_id, business_process_id
           ) VALUES (
             $1,$2,$3,$4,$5::severity_level,$6, $7::timestamptz - interval '2 hours',
             $8,$9,'demo_seed','ready_for_correlation',$10,
             '[]'::jsonb,
             '{"vendor":"ecc-demo","product":"Manager Demo Seed","note":"synthetic"}'::jsonb,
             $11,$12
           )`,
          [
            signalId,
            orgId,
            dom[domainCode],
            eventType,
            sev,
            d.asset,
            asOf,
            `${eventType} (DEMO)`,
            sourceTypeForDomain(domainCode),
            fp,
            d.bu,
            d.process,
          ],
        );
        await query(
          `INSERT INTO risk_scenario_signals (scenario_id, signal_id, org_id) VALUES ($1,$2,$3)`,
          [sid, signalId, orgId],
        );
      }

      if (d.withFinding) {
        const findingId = demoUuid(orgId, `finding:${d.key}`);
        await query(
          `INSERT INTO risk_findings (
             finding_id, org_id, risk_domain_id, title, description, severity, status,
             affected_asset, asset_id, fingerprint, detected_at, raw_payload
           ) VALUES (
             $1,$2,$3,$4,$5,'critical'::severity_level,'open',
             $6,$7,$8,$9::timestamptz,
             '{"demo":true,"note":"synthetic finding — financial exposure not invented"}'::jsonb
           )`,
          [
            findingId,
            orgId,
            dom["vapt_asm"] ?? dom[d.domains[0]],
            "Internet-exposed payment gateway with weak recovery posture (DEMO)",
            "Synthetic finding correlating ASM exposure with privileged anomaly and weak recovery control. Financial impact left unknown unless evidenced.",
            "demo-payment-gateway",
            d.asset,
            `ecc-demo-${d.key}-finding`,
            asOf,
          ],
        );
        await query(
          `INSERT INTO risk_scenario_findings (scenario_id, finding_id, org_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [sid, findingId, orgId],
        );
      } else if (d.type === "vuln_exposure") {
        const { rows: findings } = await query<{ finding_id: string }>(
          `SELECT finding_id FROM risk_findings
           WHERE org_id=$1 AND status IN ('open','acknowledged')
             AND (fingerprint IS NULL OR fingerprint NOT LIKE 'ecc-demo-%')
           LIMIT 1`,
          [orgId],
        );
        if (findings[0]) {
          await query(
            `INSERT INTO risk_scenario_findings (scenario_id, finding_id, org_id)
             VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [sid, findings[0].finding_id, orgId],
          );
        }
      }

      // Evidence packet (synthetic)
      const evidenceId = demoUuid(orgId, `evidence:${d.key}`);
      await query(
        `INSERT INTO evidence (
           evidence_id, org_id, source, source_reference, evidence_type, collected_at, metadata
         ) VALUES (
           $1,$2,'ecc-demo',$3,'demo_correlation_packet',$4::timestamptz,
           '{"demo":true}'::jsonb
         )`,
        [evidenceId, orgId, `demo://${d.key}`, asOf],
      );
      await query(
        `INSERT INTO scenario_evidence (scenario_id, evidence_id, org_id, link_reason)
         VALUES ($1,$2,$3,$4)`,
        [sid, evidenceId, orgId, "Correlated synthetic demo evidence"],
      );

      await recalculateScenario(orgId, sid);
      await refreshScenarioIntelligence(orgId, sid);
    }

    return { scenarioIds: created, heroScenarioId, demoAsOf: asOf };
  } finally {
    await query(`SELECT pg_advisory_unlock(hashtext('ecc_seed_demo_' || $1::text))`, [
      orgId,
    ]);
  }
}
