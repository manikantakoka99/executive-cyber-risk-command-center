import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { relativeTime, severityClass } from "../lib/format";

const DEMO_RATIONALE =
  "Approve mitigation for the externally exposed payment path: contain privileged anomaly, reduce internet exposure, and restore recovery control effectiveness before residual risk can be lowered.";

/** Hide automated test leftovers from the executive list */
function isPresentationNoise(s: any): boolean {
  const title = String(s.title ?? "");
  const type = String(s.scenarioType ?? "");
  if (type === "isolated_test") return true;
  if (/^P4 isolated\b/i.test(title)) return true;
  if (/^p3-corr-/i.test(title)) return true;
  return false;
}

function cardBlurb(s: any): string {
  const raw = String(s.description || s.explanation || "").trim();
  // Prefer short DEMO description; strip long engine dumps with asset IDs
  if (/^DEMO\b/i.test(raw) || /Synthetic demo/i.test(raw)) {
    return raw.replace(/^DEMO\s*[·•-]\s*/i, "").slice(0, 140);
  }
  const cleaned = raw
    .replace(/P4 isolated[^\s.]*/gi, "isolated test asset")
    .replace(/p3-corr-\d+/gi, "correlated signal")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned.length <= 140) return cleaned || "Open for executive detail.";
  return cleaned.slice(0, 140) + "…";
}

export function ScenariosPage() {
  const [scenarios, setScenarios] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [heroId, setHeroId] = useState<string | null>(null);

  const load = async () => {
    try {
      const [res, hero] = await Promise.all([api.scenarios(), api.demoHero()]);
      const visible = res.scenarios
        .filter((s) => !isPresentationNoise(s))
        .sort((a, b) => {
          const ah = a.scenarioId === hero.heroScenarioId ? 0 : a.isDemo ? 1 : 2;
          const bh = b.scenarioId === hero.heroScenarioId ? 0 : b.isDemo ? 1 : 2;
          if (ah !== bh) return ah - bh;
          return (b.residualRisk ?? 0) - (a.residualRisk ?? 0);
        });
      setScenarios(visible);
      setHeroId(hero.heroScenarioId);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="page demo-present">
      <div className="page-head">
        <div>
          <div className="eyebrow">Risk Scenarios · Decision Intelligence</div>
          <h1 className="page-title">Enterprise Risk Scenarios</h1>
          <p className="page-sub">
            Business impact, treatment, executive decision, and closed-loop
            verification — not raw alerts.
          </p>
        </div>
      </div>
      {error && <div className="banner-error">{error}</div>}
      <div className="card-grid">
        {scenarios.length === 0 && (
          <p className="muted">No enterprise risk scenarios for this organization yet.</p>
        )}
        {scenarios.map((s) => (
          <Link
            key={s.scenarioId}
            to={`/scenarios/${s.scenarioId}`}
            className={`domain-card scenario-card ${
              s.scenarioId === heroId ? "hero-scenario-card" : ""
            } ${severityClass(s.priority ?? "medium")}`}
          >
            <div className="domain-card-top">
              <span className={`badge ${severityClass(s.priority ?? "medium")}`}>
                {(s.priority ?? "n/a").toUpperCase()}
              </span>
              <span className="muted">
                {s.isDemo ? "DEMO · " : ""}
                {s.toleranceState}
              </span>
            </div>
            <h3>{s.title}</h3>
            <p className="scenario-meta">
              <span>
                Residual <span className="residual">{s.residualRisk ?? "—"}</span>
              </span>
              <span className="muted">
                Confidence {s.confidence ?? "—"} · {s.velocity}
              </span>
            </p>
            <p className="scenario-blurb">{cardBlurb(s)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ScenarioDetailPage() {
  const { id } = useParams();
  const [scenario, setScenario] = useState<any | null>(null);
  const [demo, setDemo] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    try {
      const [res, hero] = await Promise.all([api.scenario(id), api.demoHero()]);
      setScenario(res.scenario);
      setDemo(hero);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!scenario && !error) return <div className="page">Loading…</div>;
  if (error && !scenario)
    return (
      <div className="page">
        <div className="banner-error">{error}</div>
      </div>
    );

  const a = scenario.currentAssessment;
  const bi = scenario.businessImpact;
  const rec = scenario.recommendation;
  const tp = scenario.treatment;
  const latestDecision = scenario.decisions?.[0];
  const latestVerify = scenario.verifications?.[0];
  const isHero = demo?.heroScenarioId === scenario.scenarioId;
  const residualBefore =
    latestVerify?.previousResidualRisk ??
    scenario.assessments?.find((h: any) => !h.is_current)?.residual_risk;
  const residualNow = a?.residual_risk;

  return (
    <div className="page demo-present">
      <div className="page-head">
        <div>
          <Link to="/scenarios" className="muted">
            ← Risk Scenarios
          </Link>
          <div className="title-row">
            <h1 className="page-title">{scenario.title}</h1>
            {scenario.isDemo && <span className="demo-pill">DEMO · SYNTHETIC</span>}
            {isHero && <span className="demo-pill hero-pill">HERO SCENARIO</span>}
          </div>
          <p className="page-sub">{scenario.description}</p>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.recalculateScenario(id!);
              setMsg("Risk recalculated — history preserved");
            })
          }
        >
          {busy ? "Working…" : "Recalculate"}
        </button>
      </div>
      {error && <div className="banner-error">{error}</div>}
      {msg && <p className="banner-ok">{msg}</p>}

      {(latestVerify || residualBefore != null) && (
        <section className="panel before-after" aria-label="Before and after residual risk">
          <div>
            <div className="kpi-label">Previous residual</div>
            <div className="risk-number">{residualBefore ?? "—"}</div>
          </div>
          <div className="ba-arrow">→</div>
          <div>
            <div className="kpi-label">Current residual</div>
            <div className="risk-number accent">{residualNow ?? "—"}</div>
          </div>
          <div className="ba-note">
            {latestVerify
              ? "Verified remediation applied — historical assessment retained"
              : "Complete action + verify to change residual"}
          </div>
        </section>
      )}

      <section className="panel exec-hero">
        <div className="exec-grid exec-grid-lg">
          <div>
            <div className="kpi-label">What</div>
            <div className="exec-body">{scenario.title}</div>
          </div>
          <div>
            <div className="kpi-label">Why</div>
            <div className="exec-body small">
              {(scenario.explanation || "—").slice(0, 220)}
              {(scenario.explanation?.length ?? 0) > 220 ? "…" : ""}
            </div>
          </div>
          <div>
            <div className="kpi-label">Business Impact</div>
            <div className="exec-body">
              {bi?.financialKnown
                ? `AED ${Number(bi.financialExposureAed).toLocaleString()}`
                : "Financial unknown"}
            </div>
          </div>
          <div>
            <div className="kpi-label">Risk</div>
            <div className="exec-body">
              Residual <strong className="risk-inline">{a?.residual_risk ?? "—"}</strong>
              <br />
              <span className="muted">{scenario.toleranceState}</span>
            </div>
          </div>
          <div>
            <div className="kpi-label">Confidence</div>
            <div className="risk-number sm">{a?.confidence ?? "—"}</div>
          </div>
          <div>
            <div className="kpi-label">What should we do</div>
            <div className="exec-body">{rec?.recommendedTreatment ?? "—"}</div>
          </div>
        </div>
      </section>

      <section className="panel risk-calc" aria-label="Deterministic risk calculation">
        <h2>Risk calculation</h2>
        <p className="muted calc-note">
          Deterministic and explainable — not an LLM risk score.
        </p>
        <div className="calc-row">
          <div>
            <div className="kpi-label">Likelihood</div>
            <div className="risk-number">{a?.likelihood_score ?? "—"}</div>
          </div>
          <div>
            <div className="kpi-label">Impact</div>
            <div className="risk-number">{a?.impact_score ?? "—"}</div>
          </div>
          <div>
            <div className="kpi-label">Inherent</div>
            <div className="risk-number">{a?.inherent_risk ?? "—"}</div>
          </div>
          <div>
            <div className="kpi-label">Control adj.</div>
            <div className="risk-number">{a?.control_adjustment ?? "—"}</div>
          </div>
          <div>
            <div className="kpi-label">Residual</div>
            <div className="risk-number accent">{a?.residual_risk ?? "—"}</div>
          </div>
        </div>
        <p className="muted">
          Velocity {scenario.velocity} · Priority {scenario.priority} · Tolerance{" "}
          {scenario.toleranceState}
        </p>
      </section>

      <section className="panel">
        <h2>Business Impact</h2>
        <p className="exec-body">{bi?.explanation ?? "Impact not derived yet — recalculate."}</p>
        <p className="muted">
          Financial:{" "}
          {bi?.financialKnown
            ? `AED ${Number(bi.financialExposureAed).toLocaleString()}`
            : "unknown (not invented)"}
          {" · "}
          Criticality: {bi?.businessCriticality ?? "—"}
          {" · "}
          Process: {bi?.affectedBusinessProcess ?? "—"}
          {" · "}
          Unit: {bi?.affectedBusinessUnit ?? "—"}
        </p>
      </section>

      <section className="panel">
        <h2>Correlated inputs</h2>
        <p className="muted">
          These inputs are correlated into one business-risk scenario.
        </p>
        <div className="rel-grid">
          <div>
            <div className="kpi-label">Domains</div>
            <ul>
              {scenario.domains?.map((d: any) => (
                <li key={d.risk_domain_id}>{d.short_label || d.code}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="kpi-label">Signals</div>
            <ul>
              {(scenario.signals?.length ? scenario.signals : []).map((s: any) => (
                <li key={s.signal_id}>
                  {s.event_type} · {s.severity}
                </li>
              ))}
              {!scenario.signals?.length && <li className="muted">None linked</li>}
            </ul>
          </div>
          <div>
            <div className="kpi-label">Finding / Asset / Process</div>
            <ul>
              {scenario.findings?.map((f: any) => (
                <li key={f.finding_id}>Finding: {f.title}</li>
              ))}
              {scenario.assets?.map((x: any) => (
                <li key={x.asset_id}>
                  Asset: {x.name}
                  {x.internet_exposed ? " (internet-facing)" : ""}
                </li>
              ))}
              {scenario.businessProcessName && (
                <li>Process: {scenario.businessProcessName}</li>
              )}
            </ul>
          </div>
          <div>
            <div className="kpi-label">Controls / Evidence</div>
            <ul>
              {(scenario.controls?.length ? scenario.controls : []).map(
                (c: any, i: number) => (
                  <li key={c.control_id ?? i}>
                    {c.name} · {c.effectiveness}
                  </li>
                ),
              )}
              {scenario.evidence?.map((e: any) => (
                <li key={e.evidence_id}>
                  Evidence: {e.evidence_type} ({e.source})
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Treatment Recommendation</h2>
        {rec ? (
          <>
            <p className="treat-line">
              <strong>{rec.recommendedTreatment}</strong> — {rec.recommendedAction}
            </p>
            <p className="small">{rec.rationale}</p>
            <p className="muted">Reasons: {(rec.reasonCodes || []).join(", ") || "—"}</p>
          </>
        ) : (
          <p className="muted">No recommendation yet.</p>
        )}
        {tp && (
          <p className="muted" style={{ marginTop: 8 }}>
            Economics: cost{" "}
            {tp.estimatedCostAed != null
              ? `AED ${tp.estimatedCostAed.toLocaleString()}`
              : "unknown"}
            {" · "}
            ROI{" "}
            {tp.economicsKnown && tp.estimatedRoi != null
              ? tp.estimatedRoi
              : tp.economicsNote || "not enough evidence"}
          </p>
        )}
      </section>

      <section className="panel decision-panel">
        <h2>Executive Decision</h2>
        {latestDecision ? (
          <p className="exec-body">
            Decision: <strong>{latestDecision.status}</strong>
            {latestDecision.treatmentType
              ? ` · Treatment: ${latestDecision.treatmentType}`
              : ""}
            {latestDecision.ownerName ? ` · Owner: ${latestDecision.ownerName}` : ""}
            <br />
            <span className="small">{latestDecision.rationale}</span>
          </p>
        ) : (
          <p className="muted">No executive decision yet — approve mitigation for the live demo.</p>
        )}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !!latestDecision}
            onClick={() =>
              run(async () => {
                await api.scenarioDecision(id!, {
                  outcome: "approve",
                  treatmentType: "mitigate",
                  rationale: DEMO_RATIONALE,
                  createAction: true,
                  actionTitle:
                    "Harden exposed payment path & restore recovery control (DEMO)",
                  dueDate: demo?.demoDueDate ?? "2026-10-21",
                  ownerUserId: demo?.ownerUserId ?? undefined,
                });
                setMsg(
                  `Approved mitigate · Owner ${demo?.demoOwnerLabel ?? "Security Engineering"} · Due DEMO ${demo?.demoDueDate ?? "2026-10-21"}`,
                );
              })
            }
          >
            Approve · Mitigate
          </button>
          {(
            [
              ["request_information", "Request info"],
              ["decline", "Decline"],
              ["accept_risk", "Accept risk"],
              ["monitor", "Monitor"],
            ] as const
          ).map(([outcome, label]) => (
            <button
              key={outcome}
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.scenarioDecision(id!, {
                    outcome,
                    treatmentType: rec?.recommendedTreatment,
                    rationale: rec?.rationale,
                    createAction: false,
                  });
                  setMsg(`Decision: ${label}`);
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Actions</h2>
        {!scenario.actions?.length && (
          <p className="muted">No actions — approve mitigate to create one.</p>
        )}
        <ul className="action-list">
          {scenario.actions?.map((act: any) => (
            <li key={act.actionId} className="action-item">
              <div>
                <strong>{act.title}</strong>
                <div className="muted">
                  Status: <strong>{act.status}</strong>
                  {" · "}
                  Owner: {act.ownerName ?? demo?.demoOwnerLabel ?? "—"}
                  {act.dueDate
                    ? ` · Due DEMO ${String(act.dueDate).slice(0, 10)}`
                    : ""}
                </div>
                {(act.status === "open" || act.status === "pending") && (
                  <p className="demo-callout">
                    Completing the action alone does not change the risk.
                  </p>
                )}
              </div>
              <div className="btn-row">
                {(act.status === "open" || act.status === "pending") && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.patchAction(act.actionId, { status: "in_progress" });
                        setMsg("Action → in_progress");
                      })
                    }
                  >
                    Start
                  </button>
                )}
                {(act.status === "open" ||
                  act.status === "pending" ||
                  act.status === "in_progress") && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.patchAction(act.actionId, { status: "completed" });
                        setMsg(
                          "Action completed — residual unchanged until verification",
                        );
                      })
                    }
                  >
                    Mark completed
                  </button>
                )}
                {act.status === "completed" && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const res = await api.verifyAction(act.actionId, {
                          result: "verified",
                          notes:
                            "DEMO verification: exposure reduced, privileged path contained, recovery control retested effective.",
                          evidenceReference: `demo://verify/${act.actionId}`,
                          improveControls: true,
                        });
                        setMsg(
                          res.verification.explanation ||
                            "Verified — residual recalculated",
                        );
                      })
                    }
                  >
                    Verify (success)
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Verification</h2>
        {!scenario.verifications?.length && (
          <p className="muted">
            Completing an action does not reduce risk. Verification is required.
          </p>
        )}
        <ul>
          {scenario.verifications?.map((v: any) => (
            <li key={v.verificationId}>
              <strong>{v.status}</strong>: residual {v.previousResidualRisk ?? "—"} →{" "}
              {v.verifiedResidualRisk ?? "—"} · {relativeTime(v.verifiedAt)}
              {v.notes ? <div className="small">{v.notes}</div> : null}
              {v.evidenceReference ? (
                <div className="muted small">Evidence: {v.evidenceReference}</div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Risk History</h2>
        <p className="muted">
          Historical assessments remain preserved so we can explain why the risk
          changed.
        </p>
        <ul>
          {scenario.assessments?.map((h: any) => (
            <li key={h.risk_assessment_id}>
              {relativeTime(h.calculated_at)} · residual{" "}
              <strong>{h.residual_risk}</strong> · L {h.likelihood_score} / I{" "}
              {h.impact_score}
              {h.is_current ? " · current" : ""} · policy {h.policy_version}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
