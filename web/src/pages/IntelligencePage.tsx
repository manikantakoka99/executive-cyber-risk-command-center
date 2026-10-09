import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatAed, relativeTime, severityClass } from "../lib/format";

export function IntelligencePage() {
  const [portfolio, setPortfolio] = useState<any>(null);
  const [briefing, setBriefing] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);
  const [hotspots, setHotspots] = useState<any>(null);
  const [decisions, setDecisions] = useState<any>(null);
  const [compliance, setCompliance] = useState<any>(null);
  const [controls, setControls] = useState<any>(null);
  const [connectors, setConnectors] = useState<any>(null);
  const [changes, setChanges] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportMsg, setReportMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [
          p,
          b,
          t,
          h,
          d,
          c,
          ctrl,
          cat,
          mc,
        ] = await Promise.all([
          api.portfolio(),
          api.executiveBriefing(),
          api.trends("30d"),
          api.hotspots(),
          api.decisionCenter(),
          api.compliancePosture(),
          api.controlPosture(),
          api.connectorCatalog(),
          api.materialChanges(),
        ]);
        setPortfolio(p);
        setBriefing(b);
        setTrends(t);
        setHotspots(h);
        setDecisions(d);
        setCompliance(c);
        setControls(ctrl);
        setConnectors(cat);
        setChanges(mc.changes ?? []);
        setError(null);
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, []);

  const generate = async () => {
    setBusy(true);
    setReportMsg(null);
    try {
      const res = await api.generateExecutiveReport("30d");
      setReportMsg(
        `Immutable report ${res.report?.reportId ?? res.reportId} generated (hash ${
          (res.report?.contentHash ?? res.contentHash ?? "").slice(0, 12)
        }…)`,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !portfolio) {
    return (
      <div className="page">
        <div className="banner-error">{error}</div>
      </div>
    );
  }
  if (!portfolio) return <div className="page">Loading enterprise intelligence…</div>;

  const t = portfolio.totals;

  return (
    <div className="page demo-present">
      <div className="page-head">
        <div>
          <div className="eyebrow">Enterprise Intelligence · Decision Center</div>
          <h1 className="page-title">Command Center Intelligence</h1>
          <p className="page-sub">
            Portfolio, trends, hotspots, decisions, compliance — scenario-led,
            never an average of domain scores.
          </p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={generate}>
          {busy ? "Generating…" : "Generate executive report"}
        </button>
      </div>
      {error && <div className="banner-error">{error}</div>}
      {reportMsg && <p className="banner-ok">{reportMsg}</p>}

      {briefing && (
        <section className="panel exec-hero">
          <h2 style={{ marginTop: 0 }}>Executive Briefing</h2>
          <div className="exec-grid">
            {Object.entries(briefing.sections).map(([k, v]: any) => (
              <div key={k}>
                <div className="kpi-label">{k.replace(/([A-Z])/g, " $1")}</div>
                <div className="small">{v.text}</div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            As of {relativeTime(briefing.asOf)} · structured facts only
          </p>
        </section>
      )}

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Active scenarios</div>
          <div className="kpi-value">{t.activeScenarios}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Outside tolerance</div>
          <div className="kpi-value">{t.outsideTolerance}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Increasing</div>
          <div className="kpi-value">{t.increasing}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Known exposure</div>
          <div className="kpi-value" style={{ fontSize: 16 }}>
            {t.knownFinancialExposureAed != null
              ? formatAed(t.knownFinancialExposureAed)
              : "unknown"}
          </div>
          <div className="muted">
            {t.unknownFinancialExposureCount} scenarios unknown financial
          </div>
        </div>
      </div>

      <div className="split-2">
        <section className="panel">
          <h2>Top enterprise risks</h2>
          <ul>
            {portfolio.topRisks?.slice(0, 8).map((r: any) => (
              <li key={r.scenarioId}>
                <Link className="text-link" to={`/scenarios/${r.scenarioId}`}>
                  {r.title}
                </Link>
                <span className="muted">
                  {" "}
                  · residual {r.residualRisk ?? "—"} · {r.toleranceState} ·{" "}
                  {r.recommendedTreatment ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Risk concentration</h2>
          {(hotspots?.statements ?? []).map((s: string, i: number) => (
            <p key={i} className="small">
              {s}
            </p>
          ))}
          {!hotspots?.statements?.length && (
            <p className="muted">No concentration statements yet.</p>
          )}
        </section>
      </div>

      <div className="split-2">
        <section className="panel">
          <h2>Risk trend (30d)</h2>
          {trends?.insufficientHistory ? (
            <p className="muted">Insufficient historical data</p>
          ) : (
            <p className="muted">{trends?.message}</p>
          )}
          <p className="small">
            New {trends?.scenarioVelocity?.newScenarios ?? 0} · Resolved{" "}
            {trends?.scenarioVelocity?.resolvedScenarios ?? 0} · Outside now{" "}
            {trends?.scenarioVelocity?.outsideToleranceNow ?? 0}
          </p>
          <p className="small">{trends?.remediationEffectiveness?.note}</p>
        </section>
        <section className="panel">
          <h2>Decision center</h2>
          <p className="muted">
            Awaiting action: {decisions?.awaitingAction?.length ?? 0} · Info:{" "}
            {decisions?.awaitingInformation?.length ?? 0} · Overdue:{" "}
            {decisions?.overdue?.length ?? 0}
          </p>
          <ul>
            {(decisions?.awaitingAction ?? []).slice(0, 5).map((d: any) => (
              <li key={d.decisionId}>
                <span className={`badge ${severityClass(d.priority ?? "medium")}`}>
                  {(d.priority ?? "").toUpperCase()}
                </span>{" "}
                {d.scenarioId ? (
                  <Link className="text-link" to={`/scenarios/${d.scenarioId}`}>
                    {d.title}
                  </Link>
                ) : (
                  d.title
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="split-2">
        <section className="panel">
          <h2>Compliance posture</h2>
          <p className="muted">{compliance?.note}</p>
          <p>
            Average coverage:{" "}
            {compliance?.averageCoveragePct != null
              ? `${compliance.averageCoveragePct}%`
              : "unknown"}
          </p>
          <ul>
            {(compliance?.frameworks ?? []).map((f: any) => (
              <li key={f.frameworkId}>
                {f.displayName}: {f.coveragePct}% · missing evidence{" "}
                {f.missingEvidence} · {f.freshness}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Control posture</h2>
          <p className="muted">
            Effective {controls?.counts?.effective ?? 0} · Partial{" "}
            {controls?.counts?.partially_effective ?? 0} · Ineffective{" "}
            {controls?.counts?.ineffective ?? 0} · Unknown{" "}
            {controls?.counts?.unknown ?? 0}
          </p>
          <p className="small">
            Missing evidence on critical scenarios:{" "}
            {controls?.missingEvidence ?? 0}
          </p>
        </section>
      </div>

      <section className="panel">
        <h2>Connector catalog / freshness</h2>
        <ul>
          {(connectors?.connectors ?? []).map((c: any) => (
            <li key={c.connectorId}>
              <strong>{c.name}</strong> · {c.domainLabel} · {c.health}
              {c.stale ? ` — ${c.stale}` : ""}
            </li>
          ))}
          {!connectors?.connectors?.length && (
            <li className="muted">No connectors configured for this org.</li>
          )}
        </ul>
      </section>

      <section className="panel">
        <h2>Material changes</h2>
        <ul>
          {changes.slice(0, 12).map((c) => (
            <li key={c.materialChangeId}>
              <code>{c.reasonCode}</code> — {c.summary}{" "}
              <span className="muted">{relativeTime(c.detectedAt)}</span>
            </li>
          ))}
          {!changes.length && (
            <li className="muted">No material changes recorded yet.</li>
          )}
        </ul>
      </section>

      <p className="muted">
        Remediation backlog {t.remediationBacklog} · Overdue actions{" "}
        {t.overdueActions} · {portfolio.methodology}
      </p>
    </div>
  );
}
