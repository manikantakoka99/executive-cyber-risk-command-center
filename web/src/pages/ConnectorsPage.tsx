import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../context/AppState";
import { ApiError, api } from "../lib/api";

export function ConnectorsPage() {
  const { me } = useAppState();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .connectorHealth()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Connectors unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [me?.userId]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Evidence feeds</p>
          <h1 className="page-title">{data?.title ?? "Connector health"}</h1>
          <p className="page-sub">
            {data?.lede ?? "Freshness and sync status for tool connectors that feed domain scores."}
          </p>
        </div>
        {me?.permissions.includes("ingestion.read") && (
          <Link className="btn sm" to="/ingestion">
            Ingestion proof
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
            style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}
          >
            <article className="card kpi">
              <p className="lbl">Total</p>
              <p className="big">{data.counts.total}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Healthy</p>
              <p className="big">{data.counts.healthy}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Stale</p>
              <p className="big">{data.counts.stale}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Down</p>
              <p className="big">{data.counts.down}</p>
            </article>
          </div>
          <section className="card" style={{ marginTop: 16 }}>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Connector</th>
                    <th>Domain</th>
                    <th>Health</th>
                    <th>Status</th>
                    <th>Last success</th>
                    <th>Age (h)</th>
                    <th>Credential ref</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.connectors ?? []).map((c: any) => (
                    <tr key={c.connectorId}>
                      <td>
                        <b>{c.name}</b>
                        <div className="note">{c.vendor ?? c.adapterKey}</div>
                      </td>
                      <td>{c.domainLabel ?? c.domainCode}</td>
                      <td>
                        <span
                          className={`chip ${
                            c.health === "healthy" ? "low" : c.health === "stale" ? "med" : "crit"
                          }`}
                        >
                          {c.health}
                        </span>
                      </td>
                      <td>{c.status}</td>
                      <td className="note">{c.lastSuccessAt ? String(c.lastSuccessAt).replace("T", " ").slice(0, 16) : "—"}</td>
                      <td className="mono">{c.ageHours ?? "—"}</td>
                      <td className="mono note">{c.credentialsReference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
