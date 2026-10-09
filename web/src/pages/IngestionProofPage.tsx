import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../lib/api";

type SampleRow = {
  signalId: string;
  title: string;
  signalKind: string;
  domainLabel: string;
  lifecycle: string;
  metricId?: string | null;
  numerator?: number | null;
  denominator?: number | null;
};

function formatStepData(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2).slice(0, 4000);
  } catch {
    return String(data);
  }
}

export function IngestionProofPage() {
  const [status, setStatus] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [trace, setTrace] = useState<any>(null);
  const [traceTitle, setTraceTitle] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [traceBusy, setTraceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const traceRef = useRef<HTMLElement | null>(null);

  const refresh = async () => {
    try {
      const [s, r] = await Promise.all([
        api.sampleWorkbookStatus(),
        api.sampleWorkbookResults(),
      ]);
      setStatus(s);
      setResults(r);
      setError(null);
      return r;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (trace && traceRef.current) {
      traceRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [trace]);

  const run = async (resetFirst: boolean) => {
    setBusy(true);
    setMsg(null);
    setError(null);
    setTrace(null);
    setTraceTitle(null);
    setSelectedId(null);
    try {
      if (resetFirst) await api.sampleWorkbookReset();
      const out = await api.sampleWorkbookRun();
      setMsg(
        `Ingestion completed · received ${out.result?.receivedCount ?? "—"} · accepted ${out.result?.acceptedCount ?? "—"} · duplicates ${out.result?.duplicateCount ?? "—"}`,
      );
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openTrace = async (sample: SampleRow) => {
    setTraceBusy(true);
    setSelectedId(sample.signalId);
    setError(null);
    try {
      const t = await api.sampleWorkbookTrace(sample.signalId);
      setTrace(t);
      setTraceTitle(sample.title);
    } catch (e: any) {
      setTrace(null);
      setTraceTitle(null);
      if (e instanceof ApiError && e.status === 404) {
        await refresh();
        setError(
          "Trace target was stale (signal replaced after reset/re-ingest). Sample list refreshed — click Trace again.",
        );
      } else {
        setError(e.message ?? "Failed to load ingestion trace");
      }
    } finally {
      setTraceBusy(false);
    }
  };

  const m = results?.metrics ?? status?.result ?? {};
  const runStatus = status?.status ?? "idle";
  const samples: SampleRow[] = results?.samples ?? [];

  return (
    <div className="page demo-present">
      <div className="page-head">
        <div>
          <div className="eyebrow">Phase 6 · Ingestion Proof of Feasibility</div>
          <h1 className="page-title">ECC Sample Ingestion</h1>
          <p className="page-sub">
            Synthetic workbook fixture → raw events → canonical records. Not live
            vendor integrations. Workbook Domain Risk Calc is{" "}
            <strong>not</strong> the ECC risk engine.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || traceBusy}
            onClick={() => run(true)}
          >
            {busy ? "Running…" : "Reset + Run ingestion"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || traceBusy}
            onClick={() => run(false)}
          >
            Run again (idempotency)
          </button>
        </div>
      </div>

      {error && <div className="banner-error">{error}</div>}
      {msg && <p className="banner-ok">{msg}</p>}

      <section className="panel exec-hero">
        <div className="exec-grid">
          <div>
            <div className="kpi-label">Source</div>
            <div className="exec-body">
              CyberCommandCenter_Tool_To_Risk_Domain_Solution.xlsx
            </div>
          </div>
          <div>
            <div className="kpi-label">Run status</div>
            <div className="exec-body">
              <strong>{String(runStatus).toUpperCase()}</strong>
            </div>
          </div>
          <div>
            <div className="kpi-label">Records received</div>
            <div className="risk-number sm">
              {m.receivedCount ?? status?.recordsReceived ?? "—"}
            </div>
          </div>
          <div>
            <div className="kpi-label">Raw events created</div>
            <div className="risk-number sm">
              {Array.isArray(m.rawEventIds) ? m.rawEventIds.length : m.acceptedCount ?? "—"}
            </div>
          </div>
        </div>
      </section>

      <div className="kpi-row">
        <div className="kpi">
          <div className="kpi-label">Canonical</div>
          <div className="kpi-value">{m.acceptedCount ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Posture metrics</div>
          <div className="kpi-value">{m.postureMetrics ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Event signals</div>
          <div className="kpi-value">{m.eventSignals ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Duplicates</div>
          <div className="kpi-value">{m.duplicateCount ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Rejected</div>
          <div className="kpi-value">{m.rejectedCount ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Unresolved assets</div>
          <div className="kpi-value">{m.unresolvedAssets ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Ready for correlation</div>
          <div className="kpi-value">{m.readyForCorrelation ?? "—"}</div>
        </div>
      </div>

      <section className="panel">
        <h2>By domain</h2>
        <p className="muted">
          Normalized into the existing 12 ECC domains — not a second taxonomy.
        </p>
        <div className="card-grid">
          {(results?.byDomain ?? []).map((d: any) => (
            <div key={d.domainCode} className="domain-card scenario-card">
              <div className="domain-card-top">
                <strong>{d.label}</strong>
                <span className="muted">{d.qualityState}</span>
              </div>
              <p className="scenario-meta">
                <span>
                  Source <strong>{d.sourceRecords}</strong>
                </span>
                <span className="muted">
                  Normalized {d.normalizedRecords} · posture {d.posture} · events{" "}
                  {d.events}
                </span>
              </p>
            </div>
          ))}
          {!results?.byDomain?.length && (
            <p className="muted">Run ingestion to populate domain metrics.</p>
          )}
        </div>
      </section>

      {(trace || traceBusy) && (
        <section
          className="panel trace-panel"
          ref={traceRef}
          id="ingestion-trace"
        >
          <div className="page-head" style={{ marginBottom: 8 }}>
            <div>
              <div className="eyebrow">Lineage</div>
              <h2>Ingestion trace</h2>
              <p className="muted">
                {traceTitle
                  ? traceTitle
                  : traceBusy
                    ? "Loading trace…"
                    : "Select a sample below"}
              </p>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                disabled={traceBusy}
                onClick={() => {
                  setTrace(null);
                  setTraceTitle(null);
                  setSelectedId(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
          <p className="muted">
            ECC received it · preserved it · understood it · normalized it — without
            copying workbook composite scores.
          </p>
          {traceBusy && !trace && <p className="empty">Loading ingestion trace…</p>}
          {trace?.steps && (
            <ol className="trace-steps">
              {trace.steps.map((step: any) => (
                <li key={step.step}>
                  <div className="kpi-label">{step.step}</div>
                  <div className="exec-body">{step.label}</div>
                  <pre className="report-pre">{formatStepData(step.data)}</pre>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Normalized samples</h2>
        <p className="muted">
          Open Trace on a row to show source → raw → canonical → resolution →
          dedupe → risk-ready.
        </p>
        <ul className="action-list">
          {samples.map((s) => (
            <li
              key={s.signalId}
              className={`action-item${selectedId === s.signalId ? " is-selected" : ""}`}
            >
              <button
                type="button"
                className="sample-row-hit"
                disabled={busy || traceBusy}
                onClick={() => openTrace(s)}
              >
                <strong>{s.title}</strong>
                <div className="muted">
                  {s.signalKind} · {s.domainLabel} · {s.lifecycle}
                  {s.metricId ? ` · ${s.metricId}` : ""}
                  {s.numerator != null ? ` · ${s.numerator}/${s.denominator}` : ""}
                </div>
              </button>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || traceBusy}
                  onClick={() => openTrace(s)}
                >
                  {traceBusy && selectedId === s.signalId ? "Loading…" : "Trace"}
                </button>
                <Link className="btn" to={`/risk-domains`}>
                  Domains
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

    </div>
  );
}
