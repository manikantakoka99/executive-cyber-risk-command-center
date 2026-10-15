import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../context/AppState";
import { ApiError, api } from "../lib/api";

type Row = {
  id: string;
  kind: string;
  title: string;
  domain: string;
  severity: string;
  status: string;
  owner: string;
  sla?: string | null;
  reason?: string;
  source: string;
};

export function RegisterPage() {
  const { me } = useAppState();
  const [data, setData] = useState<{
    title: string;
    lede: string;
    counts: Record<string, number>;
    items: Row[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .register()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Register unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [me?.userId]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Register</p>
          <h1 className="page-title">{data?.title ?? "Combined risk register"}</h1>
          <p className="page-sub">{data?.lede ?? "Open decisions, acceptances and findings."}</p>
        </div>
        {me?.permissions.includes("command.queue") && (
          <Link className="btn sm" to="/c/queue">
            Decision queue
          </Link>
        )}
      </div>
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <div
            className="card-grid"
            style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}
          >
            <article className="card kpi">
              <p className="lbl">Open queue</p>
              <p className="big">{data.counts.open}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Accepted</p>
              <p className="big">{data.counts.accepted}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Findings</p>
              <p className="big">{data.counts.findings}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Total</p>
              <p className="big">{data.counts.total}</p>
            </article>
          </div>
          <section className="card" style={{ marginTop: 16 }}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Title</th>
                    <th>Domain</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Owner</th>
                    <th>SLA / expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td className="mono">{row.kind}</td>
                      <td>
                        <b>{row.title}</b>
                        {row.reason && <div className="note">{row.reason}</div>}
                      </td>
                      <td>{row.domain}</td>
                      <td>{row.severity}</td>
                      <td>{row.status}</td>
                      <td>{row.owner}</td>
                      <td className="note">{row.sla ?? "—"}</td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="note">
                        No register items for this organization.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
