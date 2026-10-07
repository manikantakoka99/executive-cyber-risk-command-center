import { useState } from "react";
import { Link } from "react-router-dom";
import type { OverviewResponse, PendingDecision } from "../data/types";
import { api } from "../lib/api";
import {
  formatAed,
  formatPct,
  monthLabel,
  relativeTime,
  roleLabel,
  scoreColor,
  severityBadge,
  severityClass,
  statusLabel,
  trendDirection,
} from "../lib/format";

export function OverviewPage({
  data,
  onExport,
  exporting,
  canApprove,
  canRequestInfo,
  actorRole,
  onOverviewChanged,
}: {
  data: OverviewResponse;
  onExport: () => void;
  exporting: boolean;
  canApprove: boolean;
  canRequestInfo: boolean;
  actorRole: string | null;
  onOverviewChanged: () => Promise<void>;
}) {
  const er = data.enterpriseRisk;
  const delta = er?.deltaVsPrior;
  const deltaLabel =
    delta == null
      ? null
      : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "●"} ${Math.abs(delta)} pts vs prior snapshot`;

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const runAction = async (
    d: PendingDecision,
    action: "approve" | "request-info",
  ) => {
    if (busyId) return;
    setBusyId(`${d.decisionId}:${action}`);
    setActionError(null);
    setActionOk(null);
    try {
      await api.decisionAction(d.decisionId, action);
      await onOverviewChanged();
      setActionOk(
        action === "approve"
          ? `Approved: ${d.title}`
          : `Requested more information: ${d.title}`,
      );
    } catch (e: any) {
      setActionError(e.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const topCritical = data.domains.filter(
    (d) => d.severity === "critical" || d.severity === "high",
  ).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Enterprise Risk View · {data.org.name}</div>
          <h1 className="page-title">Executive Cyber Risk Command Center</h1>
          <p className="page-sub">
            Aggregation layer across {data.domainsMonitored} security &amp;
            compliance domains — Risk → Impact → Decision → Action.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={onExport}
          disabled={exporting}
          aria-label="Export board briefing from live organization data"
        >
          {exporting ? "Generating…" : "↓ Export Board Briefing"}
        </button>
      </div>

      <div className="hero-row" aria-label="Executive key performance indicators">
        <div className="hero-card score">
          <div
            className="score-ring"
            style={{ borderColor: scoreColor(er?.severity ?? "medium") }}
            aria-hidden
          >
            <div className="n mono">
              {er?.score != null ? Math.round(er.score) : "—"}
            </div>
          </div>
          <div className="score-meta">
            <div className="l">Enterprise Cyber Risk Score</div>
            <div
              className="v"
              style={{ color: scoreColor(er?.severity ?? "medium") }}
            >
              {er ? capitalize(er.severity) : "Unavailable"}
              {er && er.score > data.riskAppetite
                ? " · above appetite"
                : er
                  ? " · within appetite"
                  : ""}
            </div>
            <div className="s">
              {deltaLabel ? `${deltaLabel} — ` : ""}
              {er?.driverSummary ?? "No enterprise snapshot for this organization"}
            </div>
          </div>
        </div>
        <div className="hero-card metric">
          <div className="m-l">Business Impact Exposure</div>
          <div className="m-n mono">{formatAed(data.businessImpactExposureAed)}</div>
          <div className="m-d d-up">Open findings financial exposure</div>
        </div>
        <div className="hero-card metric">
          <div className="m-l">Compliance Posture</div>
          <div className="m-n mono">{formatPct(data.compliancePosturePct)}</div>
          <div className="m-d d-down">Avg latest framework coverage</div>
        </div>
        <div className="hero-card metric">
          <div className="m-l">Decisions Awaiting CXO</div>
          <div className="m-n mono">{data.decisionsAwaitingCxo}</div>
          <div
            className="m-d"
            style={{
              color:
                data.decisionsAwaitingCritical > 0
                  ? "var(--critical)"
                  : "var(--text2)",
            }}
          >
            {data.decisionsAwaitingCritical > 0
              ? `${data.decisionsAwaitingCritical} marked Critical`
              : `${topCritical} high/critical domains · ${data.criticalFindingsOpen} critical findings`}
          </div>
        </div>
      </div>

      {/* Decisions first after KPIs — strongest interaction */}
      <div className="section-title">
        Decisions Awaiting Executive Action{" "}
        <span className="count">{data.decisionsAwaitingCxo} open</span>
      </div>
      <div className="card decision-queue-card">
        {actionError && (
          <p className="banner-error" role="alert">
            {actionError}
          </p>
        )}
        {actionOk && (
          <p className="banner-ok" role="status">
            {actionOk}
          </p>
        )}
        {data.pendingDecisions.length === 0 ? (
          <p className="empty">
            No decisions are awaiting CXO action for{" "}
            <strong>{data.org.name}</strong>. This is a valid posture — open{" "}
            <Link className="text-link" to="/decisions">
              Decisions
            </Link>{" "}
            for history, or switch organization if you need an active queue
            (e.g. Falcon National Bank).
          </p>
        ) : (
          data.pendingDecisions.map((d) => (
            <article
              key={d.decisionId}
              className="decision-item decision-item-emphasis"
              aria-label={`Decision: ${d.title}`}
            >
              <div className="di-top">
                <div>
                  <div className="di-title">{d.title}</div>
                  <div className="di-domain">
                    {d.domainLabel ?? "Domain"} · Escalated{" "}
                    {relativeTime(d.escalatedAt)} · Status:{" "}
                    {statusLabel(d.status)}
                  </div>
                </div>
                <div className={`dc-status ${severityBadge(d.priority)}`}>
                  {capitalize(d.priority)}
                </div>
              </div>

              <ol className="rida-chain" aria-label="Risk impact decision action chain">
                <li>
                  <span className="rida-step">Risk</span>
                  <span className="rida-body">{d.riskSummary}</span>
                </li>
                <li>
                  <span className="rida-step">Impact</span>
                  <span className="rida-body">
                    {d.impactSummary}
                    {d.financialExposureAed != null
                      ? ` · ${formatAed(d.financialExposureAed)}`
                      : ""}
                    {d.affectedBusinessUnit
                      ? ` · BU: ${d.affectedBusinessUnit}`
                      : ""}
                    {d.complianceScopeImpact
                      ? ` · Compliance: ${d.complianceScopeImpact}`
                      : ""}
                  </span>
                </li>
                <li>
                  <span className="rida-step">Decision</span>
                  <span className="rida-body">{d.recommendedAction}</span>
                </li>
                <li>
                  <span className="rida-step">Action</span>
                  <span className="rida-body">
                    Awaiting executive {canApprove ? "approval" : "review"}
                    {actorRole ? ` (${roleLabel(actorRole)})` : ""}
                  </span>
                </li>
              </ol>

              <div className="di-actions">
                {canApprove ? (
                  <button
                    type="button"
                    className="di-btn approve"
                    disabled={!!busyId}
                    aria-busy={busyId === `${d.decisionId}:approve`}
                    onClick={() => runAction(d, "approve")}
                  >
                    {busyId === `${d.decisionId}:approve`
                      ? "Saving…"
                      : approveLabel(d.recommendedAction)}
                  </button>
                ) : (
                  <span className="role-hint">
                    Acting as {actorRole ? roleLabel(actorRole) : "non-CXO"} —
                    approve requires CXO.
                  </span>
                )}
                {canRequestInfo && (
                  <button
                    type="button"
                    className="di-btn defer"
                    disabled={!!busyId}
                    aria-busy={busyId === `${d.decisionId}:request-info`}
                    onClick={() => runAction(d, "request-info")}
                  >
                    {busyId === `${d.decisionId}:request-info`
                      ? "Saving…"
                      : "Request More Information"}
                  </button>
                )}
                <Link className="di-btn defer" to={`/decisions/${d.decisionId}`}>
                  Full history
                </Link>
                {d.findingId && (
                  <Link className="di-btn defer" to={`/findings/${d.findingId}`}>
                    View finding
                  </Link>
                )}
              </div>
            </article>
          ))
        )}
      </div>

      <div className="section-title">
        Risk by Domain{" "}
        <span className="count">{data.domainsMonitored} domains monitored</span>
      </div>
      <div className="domain-wrap">
        {data.domains.map((d) => (
          <Link
            key={d.riskDomainId}
            to={`/risk-domains/${d.riskDomainId}`}
            className={`domain-card ${severityClass(d.severity)}`}
          >
            <div className="dc-top">
              <div className="dc-name">{d.shortLabel}</div>
              <div className={`dc-status ${severityBadge(d.severity)}`}>
                {d.severity === "low" ? "Good" : capitalize(d.severity)}
              </div>
            </div>
            <div className="dc-score" style={{ color: scoreColor(d.severity) }}>
              {Math.round(d.score)}
            </div>
            <div className="dc-detail">{d.headlineDetail ?? "—"}</div>
          </Link>
        ))}
      </div>

      <div className="grid2">
        <div className="col-main">
          <div className="section-title">Recent Command Center Activity</div>
          <div className="card">
            {data.activity.length === 0 ? (
              <p className="empty">
                No recent command-center activity for this organization yet.
                Decision actions and report generation will appear here.
              </p>
            ) : (
              data.activity.map((a) => (
                <div key={a.activityId} className="activity-item">
                  <div
                    className="act-dot"
                    style={{ background: activityColor(a.activityType) }}
                    aria-hidden
                  />
                  <div>
                    <div>{a.summary}</div>
                    <div className="act-meta">
                      {a.domainLabel ?? activityLabel(a.activityType)} ·{" "}
                      {relativeTime(a.occurredAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="col-side">
          <div className="section-title">Compliance Posture</div>
          <div className="card">
            {data.compliance.length === 0 ? (
              <p className="empty">
                No compliance framework snapshots are available for this
                organization.
              </p>
            ) : (
              data.compliance.map((c) => (
                <div key={c.frameworkId} className="comp-row">
                  <div className="comp-top">
                    <div className="name">{c.displayName}</div>
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
            <Link className="text-link" to="/compliance">
              View compliance detail →
            </Link>
          </div>

          <div className="section-title">Risk Trend — 6 Months</div>
          <div className="card">
            <p className="sr-only">{trendDirection(delta)}</p>
            {data.riskTrend.length === 0 ? (
              <p className="empty">
                No enterprise risk snapshots are available to chart a trend.
              </p>
            ) : (
              <>
                <div
                  className="trend-bars"
                  role="img"
                  aria-label={trendDirection(delta)}
                >
                  {data.riskTrend.map((t) => (
                    <div key={t.snapshotAt} className="trend-col">
                      <div
                        className="trend-bar"
                        style={{
                          height: `${Math.max(8, t.score)}%`,
                          background: scoreColor(t.severity),
                        }}
                        title={`${Math.round(t.score)} · ${t.severity}`}
                      />
                      <div className="trend-label">{monthLabel(t.snapshotAt)}</div>
                    </div>
                  ))}
                </div>
                <p className="trend-note">
                  {trendDirection(delta)} · appetite {data.riskAppetite}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function approveLabel(recommended: string): string {
  const t = recommended.trim();
  if (!t) return "Approve";
  if (/^approve\b/i.test(t)) return t;
  return `Approve: ${t}`;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function activityColor(type: string) {
  if (type.includes("decision")) return "var(--high)";
  if (type.includes("finding")) return "var(--critical)";
  if (type.includes("compliance") || type.includes("report")) return "var(--good)";
  if (type.includes("simulation")) return "var(--cyan)";
  return "var(--text3)";
}

function activityLabel(type: string) {
  return type.replace(/_/g, " ");
}
