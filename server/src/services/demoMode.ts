/**
 * Deterministic manager-demo orchestration.
 * Operates only on is_demo / ecc-demo tagged synthetic records.
 */
import { query } from "../db.js";
import { seedDemoScenarios } from "./scenarios.js";
import { detectMaterialChanges } from "./intelligence.js";
import {
  DEMO_AS_OF,
  DEMO_DUE_DATE,
  DEMO_OWNER_LABEL,
  demoUuid,
  HERO_SCENARIO_TITLE,
} from "./demoConstants.js";

export {
  DEMO_AS_OF,
  DEMO_DUE_DATE,
  DEMO_OWNER_LABEL,
  demoUuid,
  HERO_SCENARIO_TITLE,
};

/** Inner reset — caller must hold ecc_seed_demo advisory lock for org */
export async function resetDemoUnlocked(orgId: string) {
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
}

/** Remove synthetic demo artifacts only — never workbook/client non-demo rows */
export async function resetDemo(orgId: string) {
  await query(`SELECT pg_advisory_lock(hashtext('ecc_seed_demo_' || $1::text))`, [orgId]);
  try {
    await resetDemoUnlocked(orgId);
    return {
      ok: true,
      scope: "demo_only",
      message: "Synthetic demo scenarios, signals, findings, and evidence cleared",
      demoAsOf: DEMO_AS_OF,
    };
  } finally {
    await query(`SELECT pg_advisory_unlock(hashtext('ecc_seed_demo_' || $1::text))`, [
      orgId,
    ]);
  }
}

/** Ensure demo action owner exists (Security Engineering) */
export async function ensureDemoOwner(orgId: string): Promise<string> {
  const email = `security.engineering.${orgId.slice(0, 8)}@ecc-demo.local`;
  const { rows: existing } = await query<{ user_id: string }>(
    `SELECT user_id FROM users WHERE email = $1`,
    [email],
  );
  let uid = existing[0]?.user_id;
  if (!uid) {
    const userId = demoUuid(orgId, "owner-security-engineering");
    const { rows } = await query<{ user_id: string }>(
      `INSERT INTO users (user_id, org_id, first_name, last_name, email)
       VALUES ($1,$2,'Security','Engineering',$3)
       RETURNING user_id`,
      [userId, orgId, email],
    );
    uid = rows[0]!.user_id;
  } else {
    await query(
      `UPDATE users SET first_name='Security', last_name='Engineering', org_id=$2
       WHERE user_id=$1`,
      [uid, orgId],
    );
  }
  await query(
    `INSERT INTO user_roles (user_id, role_id, org_id, is_primary)
     SELECT $1, r.role_id, $2, false
     FROM roles r WHERE r.code = 'program_office'
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [uid, orgId],
  );
  return uid!;
}

async function ensureDemoBusinessContext(orgId: string) {
  await query(
    `INSERT INTO business_units (org_id, code, name)
     VALUES ($1,'PAY','Payments'), ($1,'OPS','Operations')
     ON CONFLICT (org_id, name) DO NOTHING`,
    [orgId],
  );
  const { rows: bus } = await query<{ business_unit_id: string; code: string }>(
    `SELECT business_unit_id, code FROM business_units WHERE org_id=$1 AND code IN ('PAY','OPS')`,
    [orgId],
  );
  const pay = bus.find((b) => b.code === "PAY")?.business_unit_id;
  if (!pay) return;
  for (const name of ["Payment Processing", "Treasury Settlement"]) {
    const { rows: exists } = await query(
      `SELECT 1 FROM business_processes WHERE org_id=$1 AND name=$2`,
      [orgId, name],
    );
    if (!exists[0]) {
      await query(
        `INSERT INTO business_processes (org_id, business_unit_id, name, criticality)
         VALUES ($1,$2,$3,'critical')`,
        [orgId, pay, name],
      );
    } else {
      await query(
        `UPDATE business_processes SET business_unit_id = COALESCE(business_unit_id, $3)
         WHERE org_id=$1 AND name=$2`,
        [orgId, name, pay],
      );
    }
  }
}

export async function seedDemo(orgId: string) {
  await ensureDemoOwner(orgId);
  await ensureDemoBusinessContext(orgId);
  const seeded = await seedDemoScenarios(orgId);
  await detectMaterialChanges(orgId);
  return {
    ok: true,
    demoAsOf: DEMO_AS_OF,
    demoDueDate: DEMO_DUE_DATE,
    demoOwnerLabel: DEMO_OWNER_LABEL,
    heroTitle: HERO_SCENARIO_TITLE,
    heroScenarioId: seeded.heroScenarioId,
    scenarioIds: seeded.scenarioIds,
    message:
      "Demo seeded. Hero scenario ready for live decision → action → verify walkthrough (not pre-closed).",
  };
}

export type DemoCheck = { id: number; name: string; ok: boolean; detail?: string };

export async function verifyDemo(orgId: string): Promise<{
  ok: boolean;
  checks: DemoCheck[];
  heroScenarioId: string | null;
  heroTitle: string;
  demoAsOf: string;
}> {
  const checks: DemoCheck[] = [];
  const push = (id: number, name: string, ok: boolean, detail?: string) => {
    checks.push({ id, name, ok, detail });
  };

  // 1–2 DB connectivity implied by queries
  const { rows: org } = await query<{ name: string }>(
    `SELECT name FROM organizations WHERE org_id=$1`,
    [orgId],
  );
  push(1, "database_available", !!org[0], org[0]?.name);

  const { rows: hero } = await query<{
    scenario_id: string;
    title: string;
    business_unit_id: string | null;
    business_process_id: string | null;
    primary_asset_id: string | null;
    current_impact_id: string | null;
    current_recommendation_id: string | null;
    current_assessment_id: string | null;
    residual_risk: string | null;
  }>(
    `SELECT s.scenario_id, s.title, s.business_unit_id, s.business_process_id,
            s.primary_asset_id, s.current_impact_id, s.current_recommendation_id,
            s.current_assessment_id, ra.residual_risk::text
     FROM risk_scenarios s
     LEFT JOIN risk_assessments ra ON ra.risk_assessment_id = s.current_assessment_id
     WHERE s.org_id=$1 AND s.is_demo = true AND s.title = $2
     LIMIT 1`,
    [orgId, HERO_SCENARIO_TITLE],
  );
  const h = hero[0];
  push(3, "demo_scenario_exists", !!h, h?.scenario_id);

  let signalCount = 0;
  let domainCount = 0;
  let findingCount = 0;
  let controlCount = 0;
  if (h) {
    const sig = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM risk_scenario_signals WHERE org_id=$1 AND scenario_id=$2`,
      [orgId, h.scenario_id],
    );
    signalCount = Number(sig.rows[0]?.n ?? 0);
    const dom = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM risk_scenario_domains WHERE org_id=$1 AND scenario_id=$2`,
      [orgId, h.scenario_id],
    );
    domainCount = Number(dom.rows[0]?.n ?? 0);
    const fin = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM risk_scenario_findings WHERE org_id=$1 AND scenario_id=$2`,
      [orgId, h.scenario_id],
    );
    findingCount = Number(fin.rows[0]?.n ?? 0);
    const ctl = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM scenario_controls WHERE org_id=$1 AND scenario_id=$2`,
      [orgId, h.scenario_id],
    );
    controlCount = Number(ctl.rows[0]?.n ?? 0);
  }
  push(4, "supporting_signals", signalCount >= 3, `signals=${signalCount} domains=${domainCount}`);
  push(5, "business_impact", !!h?.current_impact_id);
  push(6, "recommendation", !!h?.current_recommendation_id);
  push(
    7,
    "hero_relationships",
    !!(h?.primary_asset_id && h?.business_process_id && h?.business_unit_id) &&
      findingCount >= 1 &&
      controlCount >= 1,
    `asset/BU/BP/finding=${findingCount}/controls=${controlCount}`,
  );
  push(8, "risk_assessment", !!h?.current_assessment_id && h?.residual_risk != null);

  // 9–11 decision/action/verification are LIVE during presentation — optional
  let decisionExists = false;
  let actionExists = false;
  let verificationExists = false;
  if (h) {
    const d = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM executive_decisions WHERE org_id=$1 AND scenario_id=$2`,
      [orgId, h.scenario_id],
    );
    decisionExists = Number(d.rows[0]?.n ?? 0) > 0;
    const a = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM actions WHERE org_id=$1 AND scenario_id=$2`,
      [orgId, h.scenario_id],
    );
    actionExists = Number(a.rows[0]?.n ?? 0) > 0;
    const v = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM risk_verifications WHERE org_id=$1 AND scenario_id=$2`,
      [orgId, h.scenario_id],
    );
    verificationExists = Number(v.rows[0]?.n ?? 0) > 0;
  }
  push(
    9,
    "decision_ready_for_live_demo",
    !decisionExists,
    decisionExists
      ? "Decision already present — re-run prepare for clean live path"
      : "No decision yet (correct for live demo)",
  );
  push(
    10,
    "action_absent_pre_demo",
    !actionExists,
    actionExists ? "Action already present" : "No action yet (correct)",
  );
  push(
    11,
    "verification_absent_pre_demo",
    !verificationExists,
    verificationExists ? "Verification already present" : "No verification yet (correct)",
  );
  push(12, "residual_risk_present", h?.residual_risk != null, h?.residual_risk ?? undefined);

  const required = [1, 3, 4, 5, 6, 7, 8, 12];
  const ok = checks.filter((c) => required.includes(c.id)).every((c) => c.ok);

  return {
    ok,
    checks,
    heroScenarioId: h?.scenario_id ?? null,
    heroTitle: HERO_SCENARIO_TITLE,
    demoAsOf: DEMO_AS_OF,
  };
}

/** reset → seed → verify (manager demo prepare) — single org lock for the whole sequence */
export async function prepareManagerDemo(orgId: string) {
  await query(`SELECT pg_advisory_lock(hashtext('ecc_seed_demo_' || $1::text))`, [orgId]);
  try {
    await ensureDemoOwner(orgId);
    await ensureDemoBusinessContext(orgId);
    // seedDemoScenarios clears demo rows under the same lock key; call while held
    // by relying on nested advisory lock (Postgres session re-entrant).
    const seeded = await seedDemoScenarios(orgId);
    await detectMaterialChanges(orgId);
    const verified = await verifyDemo(orgId);
    return {
      ok: true,
      demoAsOf: DEMO_AS_OF,
      demoDueDate: DEMO_DUE_DATE,
      demoOwnerLabel: DEMO_OWNER_LABEL,
      heroTitle: HERO_SCENARIO_TITLE,
      heroScenarioId: seeded.heroScenarioId,
      scenarioIds: seeded.scenarioIds,
      message:
        "Demo seeded. Hero scenario ready for live decision → action → verify walkthrough (not pre-closed).",
      verified,
      caveats: [
        "Synthetic demonstration data only — not live vendor telemetry",
        "Vendor-specific adapters (Sentinel/Splunk/CrowdStrike/Wazuh) are not claimed as live",
        "Financial impact may be unknown — never invented",
        "Trend charts may show Insufficient historical data until assessments accumulate",
        "Use Al Dhabi Holdings + CXO user for the live walkthrough",
      ],
    };
  } finally {
    await query(`SELECT pg_advisory_unlock(hashtext('ecc_seed_demo_' || $1::text))`, [
      orgId,
    ]);
  }
}

export async function getHeroScenarioId(orgId: string): Promise<string | null> {
  const { rows } = await query<{ scenario_id: string }>(
    `SELECT scenario_id FROM risk_scenarios
     WHERE org_id=$1 AND is_demo = true AND title = $2 LIMIT 1`,
    [orgId, HERO_SCENARIO_TITLE],
  );
  return rows[0]?.scenario_id ?? null;
}

export async function getDemoContext(orgId: string) {
  const heroScenarioId = await getHeroScenarioId(orgId);
  const ownerUserId = await ensureDemoOwner(orgId);
  return {
    heroScenarioId,
    heroTitle: HERO_SCENARIO_TITLE,
    demoAsOf: DEMO_AS_OF,
    demoDueDate: DEMO_DUE_DATE,
    demoOwnerLabel: DEMO_OWNER_LABEL,
    ownerUserId,
    path: heroScenarioId ? `/scenarios/${heroScenarioId}` : null,
  };
}
