import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { query } from "./db.js";
import { correlateSignal } from "./risk/correlation.js";
import { recalculateScenario } from "./risk/assessment.js";
import {
  getScenario,
  listScenarios,
  seedDemoScenarios,
} from "./services/scenarios.js";

const AL = "2accc7de-f693-4b19-8fe8-6db501be05e2";
const FAL = "e5082391-0ae2-4ed1-93d6-c11650b39dbb";

const PREFIX = `p3-corr-${Date.now()}`;

let assetA: string;
let assetB: string;
let processId: string;
let socDomain: string;
let iamDomain: string;
let asmDomain: string;

async function insertSignal(opts: {
  orgId: string;
  domainId: string;
  eventType: string;
  severity: string;
  assetId?: string | null;
  processId?: string | null;
  findingId?: string | null;
  title?: string;
  observedAt?: Date;
}): Promise<string> {
  const { rows } = await query<{ signal_id: string }>(
    `INSERT INTO security_signals (
       org_id, risk_domain_id, event_type, severity, asset_id, business_process_id,
       finding_id, observed_at, title, source_type, source_name, lifecycle_status,
       evidence_refs, vendor_extensions
     ) VALUES (
       $1,$2,$3,$4::severity_level,$5,$6,$7,$8,$9,'soc','phase3_test',
       'ready_for_correlation','[]'::jsonb,'{"vendor":"ecc-test"}'::jsonb
     ) RETURNING signal_id`,
    [
      opts.orgId,
      opts.domainId,
      opts.eventType,
      opts.severity,
      opts.assetId ?? null,
      opts.processId ?? null,
      opts.findingId ?? null,
      opts.observedAt ?? new Date(),
      opts.title ?? `${PREFIX} ${opts.eventType}`,
    ],
  );
  return rows[0].signal_id;
}

before(async () => {
  const { rows: domains } = await query<{ risk_domain_id: string; code: string }>(
    `SELECT risk_domain_id, code::text AS code FROM risk_domains
     WHERE code IN ('soc_mdr','iam_pam','vapt_asm')`,
  );
  const by = Object.fromEntries(domains.map((d) => [d.code, d.risk_domain_id]));
  socDomain = by.soc_mdr;
  iamDomain = by.iam_pam;
  asmDomain = by.vapt_asm;
  assert.ok(socDomain && iamDomain && asmDomain);

  await query(
    `INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
     VALUES ($1,$2,'host','critical','production',true,'active')
     ON CONFLICT (org_id, name) DO UPDATE SET internet_exposed = true, criticality = 'critical'`,
    [AL, `${PREFIX}-asset-a`],
  );
  await query(
    `INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
     VALUES ($1,$2,'host','low','production',false,'active')
     ON CONFLICT (org_id, name) DO NOTHING`,
    [AL, `${PREFIX}-asset-b`],
  );
  const { rows: assets } = await query<{ asset_id: string; name: string }>(
    `SELECT asset_id, name FROM assets WHERE org_id=$1 AND name LIKE $2`,
    [AL, `${PREFIX}-asset-%`],
  );
  assetA = assets.find((a) => a.name.endsWith("-a"))!.asset_id;
  assetB = assets.find((a) => a.name.endsWith("-b"))!.asset_id;

  const { rows: existingBp } = await query<{ business_process_id: string }>(
    `SELECT business_process_id FROM business_processes WHERE org_id=$1 AND name=$2`,
    [AL, `${PREFIX}-payments`],
  );
  if (existingBp[0]) {
    processId = existingBp[0].business_process_id;
  } else {
    const { rows: bp } = await query<{ business_process_id: string }>(
      `INSERT INTO business_processes (org_id, name, criticality)
       VALUES ($1,$2,'critical') RETURNING business_process_id`,
      [AL, `${PREFIX}-payments`],
    );
    processId = bp[0].business_process_id;
  }

  await query(
    `INSERT INTO asset_business_processes (asset_id, business_process_id, org_id)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [assetA, processId, AL],
  );
});

describe("Phase 3 correlation engine", () => {
  it("creates candidate scenario from critical single signal", async () => {
    const name = `${PREFIX}-create-${Date.now()}`;
    await query(
      `INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
       VALUES ($1,$2,'host','critical','production',true,'active')`,
      [AL, name],
    );
    const { rows } = await query<{ asset_id: string }>(
      `SELECT asset_id FROM assets WHERE org_id=$1 AND name=$2`,
      [AL, name],
    );
    const sid = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "suspicious_process",
      severity: "critical",
      assetId: rows[0].asset_id,
    });
    const out = await correlateSignal(AL, sid);
    assert.equal(out.action, "create");
    assert.ok(out.scenarioId);
    const scenario = await getScenario(AL, out.scenarioId!);
    assert.ok(scenario);
    assert.ok(["candidate", "active"].includes(scenario.status as string));
  });

  it("strengthens existing scenario with related same-asset signal", async () => {
    const name = `${PREFIX}-strengthen-${Date.now()}`;
    await query(
      `INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
       VALUES ($1,$2,'host','high','production',true,'active')`,
      [AL, name],
    );
    const { rows } = await query<{ asset_id: string }>(
      `SELECT asset_id FROM assets WHERE org_id=$1 AND name=$2`,
      [AL, name],
    );
    const assetId = rows[0].asset_id;
    const s1 = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "malware_detection",
      severity: "critical",
      assetId,
      title: `${PREFIX} strengthen-1`,
    });
    const first = await correlateSignal(AL, s1);
    assert.equal(first.action, "create");
    assert.ok(first.scenarioId);
    const s2 = await insertSignal({
      orgId: AL,
      domainId: iamDomain,
      eventType: "privilege_escalation",
      severity: "high",
      assetId,
      title: `${PREFIX} strengthen-2`,
    });
    const second = await correlateSignal(AL, s2);
    assert.equal(second.action, "strengthen");
    assert.equal(second.scenarioId, first.scenarioId);
    assert.equal(second.ruleCode, "same_asset");
  });

  it("correlates cross-domain signals on same asset", async () => {
    const uniqueAssetName = `${PREFIX}-xdom-${Date.now()}`;
    await query(
      `INSERT INTO assets (org_id, name, asset_type, criticality, environment, internet_exposed, status)
       VALUES ($1,$2,'application','high','production',true,'active')`,
      [AL, uniqueAssetName],
    );
    const { rows } = await query<{ asset_id: string }>(
      `SELECT asset_id FROM assets WHERE org_id=$1 AND name=$2`,
      [AL, uniqueAssetName],
    );
    const assetId = rows[0].asset_id;

    const a = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "suspicious_process",
      severity: "high",
      assetId,
    });
    const b = await insertSignal({
      orgId: AL,
      domainId: asmDomain,
      eventType: "exposed_service",
      severity: "high",
      assetId,
    });
    const r1 = await correlateSignal(AL, a);
    const r2 = await correlateSignal(AL, b);
    assert.ok(r1.scenarioId);
    assert.equal(r2.scenarioId, r1.scenarioId);
    const scenario = await getScenario(AL, r1.scenarioId!);
    assert.ok(scenario!.domains.length >= 2);
  });

  it("does not correlate unrelated assets", async () => {
    const uniqueA = `${PREFIX}-unrel-a-${Date.now()}`;
    const uniqueB = `${PREFIX}-unrel-b-${Date.now()}`;
    await query(
      `INSERT INTO assets (org_id, name, asset_type, criticality, environment, status)
       VALUES ($1,$2,'host','medium','production','active'),
              ($1,$3,'host','medium','production','active')`,
      [AL, uniqueA, uniqueB],
    );
    const { rows } = await query<{ asset_id: string; name: string }>(
      `SELECT asset_id, name FROM assets WHERE org_id=$1 AND name IN ($2,$3)`,
      [AL, uniqueA, uniqueB],
    );
    const idA = rows.find((r) => r.name === uniqueA)!.asset_id;
    const idB = rows.find((r) => r.name === uniqueB)!.asset_id;

    const sA = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "malware_detection",
      severity: "critical",
      assetId: idA,
    });
    const sB = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "malware_detection",
      severity: "critical",
      assetId: idB,
    });
    const rA = await correlateSignal(AL, sA);
    const rB = await correlateSignal(AL, sB);
    assert.ok(rA.scenarioId);
    assert.ok(rB.scenarioId);
    assert.notEqual(rA.scenarioId, rB.scenarioId);
  });

  it("skips info-severity and low-evidence medium signals", async () => {
    const info = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "heartbeat",
      severity: "info",
      assetId: assetB,
    });
    const skipInfo = await correlateSignal(AL, info);
    assert.equal(skipInfo.action, "skip");
    assert.equal(skipInfo.ruleCode, "skip_info");

    const lonely = `${PREFIX}-lonely-${Date.now()}`;
    await query(
      `INSERT INTO assets (org_id, name, asset_type, criticality, environment, status)
       VALUES ($1,$2,'host','low','production','active')`,
      [AL, lonely],
    );
    const { rows } = await query<{ asset_id: string }>(
      `SELECT asset_id FROM assets WHERE org_id=$1 AND name=$2`,
      [AL, lonely],
    );
    const med = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "anomaly_noise",
      severity: "medium",
      assetId: rows[0].asset_id,
    });
    const skipMed = await correlateSignal(AL, med);
    assert.equal(skipMed.action, "skip");
    assert.equal(skipMed.ruleCode, "insufficient_evidence");
  });

  it("finding + signal correlation strengthens finding-linked scenario", async () => {
    const { rows: findings } = await query<{ finding_id: string }>(
      `SELECT finding_id FROM risk_findings WHERE org_id=$1 LIMIT 1`,
      [AL],
    );
    if (!findings[0]) return; // org may lack findings in some envs

    const assetName = `${PREFIX}-finding-asset-${Date.now()}`;
    await query(
      `INSERT INTO assets (org_id, name, asset_type, criticality, environment, status)
       VALUES ($1,$2,'host','high','production','active')`,
      [AL, assetName],
    );
    const { rows: a } = await query<{ asset_id: string }>(
      `SELECT asset_id FROM assets WHERE org_id=$1 AND name=$2`,
      [AL, assetName],
    );

    const s1 = await insertSignal({
      orgId: AL,
      domainId: asmDomain,
      eventType: "vulnerability_detected",
      severity: "critical",
      assetId: a[0].asset_id,
      findingId: findings[0].finding_id,
    });
    const created = await correlateSignal(AL, s1);
    assert.ok(created.scenarioId);

    const s2 = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "exploit_attempt",
      severity: "high",
      assetId: a[0].asset_id,
      findingId: findings[0].finding_id,
    });
    const linked = await correlateSignal(AL, s2);
    assert.ok(
      linked.action === "strengthen" || linked.scenarioId === created.scenarioId,
    );
  });

  it("business-process correlation attaches to same process scenario", async () => {
    const bpName = `${PREFIX}-bp-${Date.now()}`;
    const { rows: bp } = await query<{ business_process_id: string }>(
      `INSERT INTO business_processes (org_id, name, criticality)
       VALUES ($1,$2,'high') RETURNING business_process_id`,
      [AL, bpName],
    );
    const bpId = bp[0].business_process_id;
    const s1 = await insertSignal({
      orgId: AL,
      domainId: socDomain,
      eventType: "suspicious_process",
      severity: "critical",
      processId: bpId,
    });
    const s2 = await insertSignal({
      orgId: AL,
      domainId: iamDomain,
      eventType: "privileged_login",
      severity: "high",
      processId: bpId,
    });
    const r1 = await correlateSignal(AL, s1);
    const r2 = await correlateSignal(AL, s2);
    assert.ok(r1.scenarioId);
    assert.equal(r2.scenarioId, r1.scenarioId);
    assert.ok(
      r2.ruleCode === "same_business_process" || r2.ruleCode === "same_asset",
    );
  });
});

describe("Phase 3 assessment history + tolerance", () => {
  it("recalculation preserves prior assessment and updates current", async () => {
    const seeded = await seedDemoScenarios(AL);
    assert.ok(seeded.scenarioIds.length >= 4);
    const scenarioId = seeded.scenarioIds[0];
    const before = await getScenario(AL, scenarioId);
    assert.ok(before?.currentAssessment);
    const priorId = before!.currentAssessment.risk_assessment_id;
    const priorCount = before!.assessments.length;

    await query(
      `UPDATE scenario_controls SET effectiveness = 'effective'
       WHERE org_id=$1 AND scenario_id=$2`,
      [AL, scenarioId],
    );
    const result = await recalculateScenario(AL, scenarioId);
    const after = await getScenario(AL, scenarioId);
    assert.ok(after!.assessments.length >= priorCount + 1);
    assert.notEqual(after!.currentAssessment.risk_assessment_id, priorId);
    assert.ok(
      after!.assessments.some(
        (a: any) => a.risk_assessment_id === priorId && a.is_current === false,
      ),
    );
    assert.ok(result.residual <= (before!.currentAssessment.residual_risk ?? 100));
    assert.ok(after!.explanation);
    assert.match(after!.explanation as string, /Likelihood|inherent|Confidence/i);
  });

  it("demo scenarios produce explainable assessments without inventing AED", async () => {
    const list = await listScenarios(AL, { limit: 20 });
    const demos = list.filter((s: any) => s.isDemo);
    assert.ok(demos.length >= 1);
    for (const d of demos) {
      const full = await getScenario(AL, d.scenarioId as string);
      assert.ok(full?.currentAssessment);
      const meta = full!.currentAssessment.calculation_meta;
      const parsed = typeof meta === "string" ? JSON.parse(meta) : meta;
      if (parsed && parsed.hasFinancial === false) {
        assert.equal(full!.currentAssessment.impact_score != null, true);
      }
      assert.doesNotMatch(String(full!.explanation), /invented AED/i);
    }
  });

  it("tenant isolation: Org A cannot read Org B scenario", async () => {
    const falSeed = await seedDemoScenarios(FAL);
    const falId = falSeed.scenarioIds[0];
    const leaked = await getScenario(AL, falId);
    assert.equal(leaked, null);
    const alList = await listScenarios(AL);
    assert.ok(!alList.some((s: any) => s.scenarioId === falId));
  });

  it("tenant isolation: cannot attach Org B asset via correlation on Org A signal", async () => {
    const { rows: falAssets } = await query<{ asset_id: string }>(
      `SELECT asset_id FROM assets WHERE org_id=$1 LIMIT 1`,
      [FAL],
    );
    assert.ok(falAssets[0]);
    // Direct insert of cross-tenant asset on AL signal should fail FK or be blocked
    let failed = false;
    try {
      await insertSignal({
        orgId: AL,
        domainId: socDomain,
        eventType: "cross_tenant_probe",
        severity: "critical",
        assetId: falAssets[0].asset_id,
      });
    } catch {
      failed = true;
    }
    assert.equal(failed, true);
  });
});
