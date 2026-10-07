import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAppState } from "../context/AppState";
import {
  formatAed,
  relativeTime,
  severityBadge,
  decisionStatusBadge,
  statusLabel,
} from "../lib/format";

export function DecisionsPage() {
  const { orgId, ready } = useAppState();
  const [decisions, setDecisions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    api
      .decisions()
      .then((r) => setDecisions(r.decisions))
      .catch((e) => setError(e.message));
  }, [orgId, ready]);
  if (error) return <div className="page"><p className="banner-error">{error}</p></div>;
  const awaiting = decisions.filter((d) => d.status === "awaiting_decision");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Risk → Impact → Decision → Action</div>
          <h1 className="page-title">Executive Decisions</h1>
          <p className="page-sub">
            {awaiting.length} awaiting CXO · {decisions.length} total for this organization.
          </p>
        </div>
      </div>
      <div className="card">
        {decisions.map((d) => (
          <Link key={d.decisionId} className="list-row" to={`/decisions/${d.decisionId}`}>
            <div>
              <div className="di-title">{d.title}</div>
              <div className="di-domain">
                {d.domainLabel ?? "—"} · {statusLabel(d.status)} ·{" "}
                {formatAed(d.financialExposureAed)}
              </div>
            </div>
            <div className="di-top" style={{ gap: 8 }}>
              <div className={`dc-status ${decisionStatusBadge(d.status)}`}>
                {statusLabel(d.status)}
              </div>
              <div className={`dc-status ${severityBadge(d.priority)}`}>{d.priority}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DecisionDetailPage() {
  const { id } = useParams();
  const { me, ready, orgId } = useAppState();
  const [data, setData] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    api.decision(id).then(setData).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (ready) load();
  }, [id, ready, orgId]);

  const act = async (action: "approve" | "request-info" | "decline" | "close") => {
    if (!id) return;
    setBusy(action);
    setError(null);
    try {
      const res = await api.decisionAction(id, action, notes || undefined);
      setData(res.decision);
      setNotes("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (!data && !error) return <div className="page"><div className="skeleton" /></div>;
  if (error && !data) return <div className="page"><p className="banner-error">{error}</p></div>;

  const canAct = me?.role === "cxo";
  const canRequest = me?.role === "cxo" || me?.role === "program_office";
  const terminal = ["approved", "declined", "closed"].includes(data.status);
  const approveBtn = (() => {
    const t = String(data.recommendedAction ?? "").trim();
    if (!t) return "Approve";
    if (/^approve\b/i.test(t)) return t;
    return `Approve: ${t}`;
  })();

  return (
    <div className="page">
      <Link className="text-link" to="/decisions">← Decisions</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {data.domainLabel ?? "Executive decision"} · {data.status.replaceAll("_", " ")}
          </div>
          <h1 className="page-title">{data.title}</h1>
          <p className="page-sub">
            Escalated {relativeTime(data.escalatedAt)}
            {data.affectedBusinessUnit ? ` · ${data.affectedBusinessUnit}` : ""}
          </p>
        </div>
        <div className={`dc-status ${severityBadge(data.priority)}`}>{data.priority}</div>
      </div>

      {error && <p className="banner-error">{error}</p>}

      <div className="card decision-detail">
        <div className="section-title">Risk → Impact → Recommended action</div>
        <div className="di-flow">
          <span className="seg">Risk: {data.riskSummary}</span>
          <span className="arrow">→</span>
          <span className="seg">Impact: {data.impactSummary}</span>
          <span className="arrow">→</span>
          <span className="seg">Recommended: {data.recommendedAction}</span>
        </div>
        <dl className="kv">
          <div><dt>Exposure</dt><dd>{formatAed(data.financialExposureAed)}</dd></div>
          <div><dt>Downtime / hr</dt><dd>{formatAed(data.downtimeCostPerHourAed)}</dd></div>
          <div><dt>Compliance</dt><dd>{data.complianceScopeImpact ?? "—"}</dd></div>
          <div>
            <dt>Finding (Risk)</dt>
            <dd>
              {data.findingId ? (
                <Link to={`/findings/${data.findingId}`}>{data.findingTitle ?? "Open finding"}</Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>

        {!terminal && (
          <div className="action-panel">
            <label htmlFor="decision-notes">Decision notes (audit trail)</label>
            <textarea
              id="decision-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional rationale recorded in decision_action_log"
            />
            <div className="di-actions">
              {canAct && (
                <button
                  type="button"
                  className="di-btn approve"
                  disabled={!!busy}
                  onClick={() => act("approve")}
                >
                  {busy === "approve" ? "Saving…" : approveBtn}
                </button>
              )}
              {canRequest && (
                <button
                  type="button"
                  className="di-btn defer"
                  disabled={!!busy}
                  onClick={() => act("request-info")}
                >
                  {busy === "request-info" ? "Saving…" : "Request More Information"}
                </button>
              )}
              {canAct && (
                <button
                  type="button"
                  className="di-btn defer"
                  disabled={!!busy}
                  onClick={() => act("decline")}
                >
                  Decline
                </button>
              )}
              {canRequest && (
                <button
                  type="button"
                  className="di-btn defer"
                  disabled={!!busy}
                  onClick={() => act("close")}
                >
                  Close
                </button>
              )}
            </div>
            {!canAct && !canRequest && (
              <p className="empty">Your role ({me?.role}) cannot mutate decisions.</p>
            )}
          </div>
        )}
        {terminal && (
          <p className="empty">
            Decision is {data.status.replaceAll("_", " ")}. Action history below is immutable.
          </p>
        )}
      </div>

      <div className="section-title">Action history (closed loop)</div>
      <div className="card">
        {data.history?.length ? (
          data.history.map((h: any) => (
            <div key={h.actionLogId} className="activity-item">
              <div className="act-dot" style={{ background: "var(--cyan)" }} />
              <div>
                <div>
                  <strong>{h.action.replaceAll("_", " ")}</strong>
                  {h.actor ? ` · ${h.actor}` : ""}
                  {h.actorRole ? ` (${h.actorRole})` : ""}
                </div>
                <div className="act-meta">
                  {relativeTime(h.actedAt)}
                  {h.notes ? ` · ${h.notes}` : ""}
                </div>
              </div>
            </div>
          ))
        ) : (
          <p className="empty">No actions recorded yet — take an action above.</p>
        )}
      </div>
    </div>
  );
}

export function CompliancePage() {
  const { orgId, ready } = useAppState();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    setData(null);
    api.compliance().then(setData).catch((e) => setError(e.message));
  }, [orgId, ready]);
  if (error) return <div className="page"><p className="banner-error">{error}</p></div>;
  if (!data) return <div className="page"><div className="skeleton" /></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Framework coverage</div>
          <h1 className="page-title">Compliance Posture</h1>
          <p className="page-sub">
            Aggregate coverage {data.posturePct ?? "—"}% across frameworks.
          </p>
        </div>
      </div>
      <div className="card">
        {data.frameworks.length === 0 ? (
          <p className="empty">
            No compliance framework snapshots exist for this organization.
          </p>
        ) : (
          data.frameworks.map((c: any) => (
            <div key={c.frameworkId} className="comp-row">
              <div className="comp-top">
                <div className="name">
                  {c.displayName}
                  <div className="di-domain">
                    {c.controlsEvidenced}/{c.controlsTotal} evidenced
                    {c.nextRenewalDate
                      ? ` · renewal ${String(c.nextRenewalDate).slice(0, 10)}`
                      : ""}
                  </div>
                </div>
                <div className="pct">{Math.round(c.coveragePct)}%</div>
              </div>
              <div
                className="comp-bar-bg"
                role="meter"
                aria-valuenow={Math.round(c.coveragePct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${c.displayName} coverage`}
              >
                <div
                  className="comp-bar-fill"
                  style={{
                    width: `${Math.min(100, c.coveragePct)}%`,
                    background:
                      c.coveragePct >= 85
                        ? "var(--good)"
                        : c.coveragePct >= 70
                          ? "var(--medium)"
                          : "var(--high)",
                  }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { orgId, ready, me } = useAppState();
  const [reports, setReports] = useState<any[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canGenerate =
    me?.role === "cxo" ||
    me?.role === "program_office" ||
    me?.role === "board_member";

  const load = () =>
    api.reports().then((r) => setReports(r.reports)).catch((e) => setError(e.message));
  useEffect(() => {
    if (!ready) return;
    setContent(null);
    load();
  }, [orgId, ready]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.generateReport("board_briefing");
      setContent(r.content);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Closed-loop reporting</div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">
            Board briefings derived from the current organization&apos;s live
            aggregates — not static mockup values.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={generate}
          disabled={busy || !canGenerate}
          title={
            canGenerate
              ? "Generate from current overview aggregates"
              : "Requires CXO, Program Office, or Board role"
          }
        >
          {busy ? "Generating…" : "Generate Board Briefing"}
        </button>
      </div>
      {error && <p className="banner-error">{error}</p>}
      <div className="card">
        {reports.length === 0 ? (
          <p className="empty">
            No generated reports for this organization yet. Use Generate Board
            Briefing to create one from live data.
          </p>
        ) : (
          reports.map((r) => (
            <div key={r.reportId} className="list-row">
              <div>
                <div className="di-title">{r.reportType.replaceAll("_", " ")}</div>
                <div className="di-domain">
                  {String(r.periodStart).slice(0, 10)} →{" "}
                  {String(r.periodEnd).slice(0, 10)} · {r.generatedBy ?? "system"}{" "}
                  · {relativeTime(r.generatedAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {content && (
        <div className="card">
          <div className="section-title">Latest generated content</div>
          <pre className="report-pre">{content}</pre>
        </div>
      )}
    </div>
  );
}

export function AuditPage() {
  const { orgId, ready } = useAppState();
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    api.audit().then((r) => setAudit(r.audit)).catch((e) => setError(e.message));
  }, [orgId, ready]);
  if (error) return <div className="page"><p className="banner-error">{error}</p></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Governance</div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-sub">Immutable system actions for this organization.</p>
        </div>
      </div>
      <div className="card">
        {audit.length === 0 ? (
          <p className="empty">
            No audit events yet for this organization. Approving a decision or
            generating a report will create immutable audit rows.
          </p>
        ) : (
          audit.map((a) => (
            <div key={a.logId} className="activity-item">
              <div className="act-dot" style={{ background: "var(--text3)" }} />
              <div>
                <div>
                  {a.action} · {a.entityType}
                  {a.actor ? ` · ${a.actor}` : ""}
                </div>
                <div className="act-meta">{relativeTime(a.createdAt)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
