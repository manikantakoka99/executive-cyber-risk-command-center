import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAppState } from "../context/AppState";
import {
  formatAed,
  monthLabel,
  relativeTime,
  scoreColor,
  severityBadge,
  severityClass,
  statusLabel,
  decisionStatusBadge,
} from "../lib/format";

export function DomainsPage() {
  const { orgId, ready } = useAppState();
  const [domains, setDomains] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    api
      .domains()
      .then((r) => setDomains(r.domains))
      .catch((e) => setError(e.message));
  }, [orgId, ready]);

  if (error) return <div className="page"><p className="banner-error">{error}</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Risk Domains</div>
          <h1 className="page-title">Monitored Domains</h1>
          <p className="page-sub">
            Latest residual scores across subscribed YVI domain solutions.
          </p>
        </div>
      </div>
      <div className="domain-wrap">
        {domains.map((d) => (
          <Link
            key={d.riskDomainId}
            to={`/risk-domains/${d.riskDomainId}`}
            className={`domain-card ${severityClass(d.severity)}`}
          >
            <div className="dc-top">
              <div className="dc-name">{d.shortLabel}</div>
              <div className={`dc-status ${severityBadge(d.severity)}`}>
                {d.severity}
              </div>
            </div>
            <div className="dc-score" style={{ color: scoreColor(d.severity) }}>
              {Math.round(d.score)}
            </div>
            <div className="dc-detail">{d.headlineDetail}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DomainDetailPage() {
  const { id } = useParams();
  const { orgId, ready } = useAppState();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !ready) return;
    api
      .domain(id)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id, orgId, ready]);

  if (error) return <div className="page"><p className="banner-error">{error}</p></div>;
  if (!data) return <div className="page"><div className="skeleton" /></div>;

  const awaiting = (data.decisions ?? []).filter(
    (d: any) => d.status === "awaiting_decision" || d.status === "info_requested",
  );

  return (
    <div className="page">
      <Link className="text-link" to="/risk-domains">← All domains</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{data.yviSolution}</div>
          <h1 className="page-title">{data.displayName}</h1>
          <p className="page-sub">
            {data.latest?.headlineDetail ??
              "No domain headline available for the latest snapshot."}
          </p>
        </div>
        <div className="hero-card metric" style={{ minWidth: 180 }}>
          <div className="m-l">Domain score</div>
          <div
            className="m-n mono"
            style={{ color: scoreColor(data.latest?.severity ?? "medium") }}
          >
            {data.latest ? Math.round(data.latest.score) : "—"}
          </div>
          <div className="m-d">
            {data.latest?.severity ?? "n/a"}
            {data.financialExposureAed
              ? ` · ${formatAed(data.financialExposureAed)} exposure`
              : ""}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="col-main">
          <div className="section-title">Findings driving this score</div>
          <div className="card">
            {data.findings.length === 0 ? (
              <p className="empty">
                No findings are recorded for this domain in the current sample
                dataset. Domain score still comes from the latest snapshot
                headline.
              </p>
            ) : (
              data.findings.map((f: any) => (
                <Link key={f.findingId} className="list-row" to={`/findings/${f.findingId}`}>
                  <div>
                    <div className="di-title">{f.title}</div>
                    <div className="di-domain">
                      {f.status} · {f.affectedAsset ?? "—"} ·{" "}
                      {formatAed(f.financialExposureAed)}
                      {f.complianceScopeImpact
                        ? ` · ${f.complianceScopeImpact}`
                        : ""}
                    </div>
                  </div>
                  <div className={`dc-status ${severityBadge(f.severity)}`}>
                    {f.severity}
                  </div>
                </Link>
              ))
            )}
          </div>

          <div className="section-title">
            Linked decisions{" "}
            <span className="count">{awaiting.length} open</span>
          </div>
          <div className="card">
            {(data.decisions ?? []).length === 0 ? (
              <p className="empty">
                No executive decisions are linked to findings in this domain.
              </p>
            ) : (
              data.decisions.map((d: any) => (
                <Link key={d.decisionId} className="list-row" to={`/decisions/${d.decisionId}`}>
                  <div>
                    <div className="di-title">{d.title}</div>
                    <div className="di-domain">
                      {statusLabel(d.status)} · {d.recommendedAction}
                      {d.financialExposureAed != null
                        ? ` · ${formatAed(d.financialExposureAed)}`
                        : ""}
                    </div>
                  </div>
                  <div className={`dc-status ${decisionStatusBadge(d.status)}`}>
                    {statusLabel(d.status)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
        <div className="col-side">
          <div className="section-title">Score history</div>
          <div className="card">
            {data.history.length === 0 ? (
              <p className="empty">No historical snapshots for this domain.</p>
            ) : (
              <div
                className="trend-bars"
                role="img"
                aria-label={`Score history for ${data.shortLabel}`}
              >
                {data.history.map((h: any) => (
                  <div key={h.snapshotId} className="trend-col">
                    <div
                      className="trend-bar"
                      style={{
                        height: `${Math.max(8, h.score)}%`,
                        background: scoreColor(h.severity),
                      }}
                      title={`${Math.round(h.score)}`}
                    />
                    <div className="trend-label">{monthLabel(h.snapshotAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="section-title">Recent domain activity</div>
          <div className="card">
            {(data.activity ?? []).length === 0 ? (
              <p className="empty">
                No domain-tagged activity rows in the sample feed for this
                domain.
              </p>
            ) : (
              data.activity.map((a: any) => (
                <div key={a.activityId} className="activity-item">
                  <div className="act-dot" style={{ background: "var(--cyan)" }} />
                  <div>
                    <div>{a.summary}</div>
                    <div className="act-meta">{relativeTime(a.occurredAt)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FindingsPage() {
  const { orgId, ready } = useAppState();
  const [findings, setFindings] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    api
      .findings()
      .then((r) => setFindings(r.findings))
      .catch((e) => setError(e.message));
  }, [orgId, ready]);
  if (error) return <div className="page"><p className="banner-error">{error}</p></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Risk signals</div>
          <h1 className="page-title">Risk Findings</h1>
          <p className="page-sub">
            Risk evidence with linked business impact — escalate to Decision for action.
          </p>
        </div>
      </div>
      <div className="card">
        {findings.map((f) => (
          <Link key={f.findingId} className="list-row" to={`/findings/${f.findingId}`}>
            <div>
              <div className="di-title">{f.title}</div>
              <div className="di-domain">
                {f.domainLabel} · {f.status} · {formatAed(f.financialExposureAed)}
              </div>
            </div>
            <div className={`dc-status ${severityBadge(f.severity)}`}>{f.severity}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function FindingDetailPage() {
  const { id } = useParams();
  const { orgId, ready } = useAppState();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !ready) return;
    api.finding(id).then(setData).catch((e) => setError(e.message));
  }, [id, orgId, ready]);
  if (error) return <div className="page"><p className="banner-error">{error}</p></div>;
  if (!data) return <div className="page"><div className="skeleton" /></div>;

  const awaiting = (data.decisions ?? []).find(
    (d: any) => d.status === "awaiting_decision",
  );

  return (
    <div className="page">
      <Link className="text-link" to="/findings">← Findings</Link>
      <div className="page-head">
        <div>
          <div className="eyebrow">{data.domainLabel} · Risk finding</div>
          <h1 className="page-title">{data.title}</h1>
          <p className="page-sub">{data.description ?? data.affectedAsset}</p>
        </div>
        <div className={`dc-status ${severityBadge(data.severity)}`}>{data.severity}</div>
      </div>

      <div className="card">
        <div className="section-title">Risk → Impact → Decision</div>
        <div className="di-flow">
          <span className="seg">
            Risk: {data.severity} · {data.status} · {data.affectedAsset ?? "asset n/a"}
          </span>
          <span className="arrow">→</span>
          <span className="seg">
            Impact: {formatAed(data.financialExposureAed)}
            {data.affectedBusinessUnit ? ` · ${data.affectedBusinessUnit}` : ""}
            {data.complianceScopeImpact ? ` · ${data.complianceScopeImpact}` : ""}
          </span>
          <span className="arrow">→</span>
          <span className="seg">
            {awaiting
              ? `Decision: ${awaiting.recommendedAction}`
              : data.decisions?.length
                ? `Decision status: ${data.decisions[0].status}`
                : "Decision: none escalated"}
          </span>
        </div>
        {awaiting && (
          <div className="di-actions">
            <Link className="di-btn approve" to={`/decisions/${awaiting.decisionId}`}>
              Take executive action
            </Link>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card col-main">
          <div className="section-title">Business impact</div>
          <dl className="kv">
            <div><dt>Financial exposure</dt><dd>{formatAed(data.financialExposureAed)}</dd></div>
            <div><dt>Downtime cost / hour</dt><dd>{formatAed(data.downtimeCostPerHourAed)}</dd></div>
            <div><dt>Business unit</dt><dd>{data.affectedBusinessUnit ?? "—"}</dd></div>
            <div><dt>Compliance scope</dt><dd>{data.complianceScopeImpact ?? "—"}</dd></div>
            <div><dt>Status</dt><dd>{data.status}</dd></div>
            <div><dt>Detected</dt><dd>{new Date(data.detectedAt).toLocaleString()}</dd></div>
          </dl>
        </div>
        <div className="card col-side">
          <div className="section-title">Linked decisions</div>
          {data.decisions?.length ? (
            data.decisions.map((d: any) => (
              <Link key={d.decisionId} className="list-row" to={`/decisions/${d.decisionId}`}>
                <div>
                  <div className="di-title">{d.title}</div>
                  <div className="di-domain">{d.status} · {d.recommendedAction}</div>
                </div>
              </Link>
            ))
          ) : (
            <p className="empty">No executive decision linked.</p>
          )}
        </div>
      </div>
    </div>
  );
}
