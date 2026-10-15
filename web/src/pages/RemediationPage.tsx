import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppState } from "../context/AppState";
import { ApiError, api } from "../lib/api";

export function RemediationPage() {
  const { me } = useAppState();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .remediation()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Remediation unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [me?.userId]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Closure loop</p>
          <h1 className="page-title">{data?.title ?? "Remediation tracking"}</h1>
          <p className="page-sub">
            {data?.lede ??
              "Fixes reported for verification and treatment actions. Work done ≠ closed until re-scan passes."}
          </p>
        </div>
        {me?.permissions.includes("command.closure") && (
          <Link className="btn sm" to="/c/closure">
            Closure workspace
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
              <p className="lbl">Fix reported</p>
              <p className="big">{data.counts.fixReported}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Verified closed</p>
              <p className="big">{data.counts.verified}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Reopened</p>
              <p className="big">{data.counts.reopened}</p>
            </article>
            <article className="card kpi">
              <p className="lbl">Actions</p>
              <p className="big">{data.counts.actions}</p>
            </article>
          </div>

          <section className="card" style={{ marginTop: 16 }}>
            <h3>Verification queue</h3>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Owner</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.fixes ?? []).map((f: any) => (
                    <tr key={f.id}>
                      <td>
                        <b>{f.title}</b>
                      </td>
                      <td>{f.status}</td>
                      <td>{f.attempts}</td>
                      <td>{f.owner}</td>
                      <td className="mono note">{f.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h3>Treatment actions</h3>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Owner</th>
                    <th>Due</th>
                    <th>Scenario</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.actions ?? []).map((a: any) => (
                    <tr key={a.id}>
                      <td>
                        <b>{a.title}</b>
                      </td>
                      <td>{a.status}</td>
                      <td>{a.priority ?? "—"}</td>
                      <td>{a.owner}</td>
                      <td className="note">{a.dueAt ? String(a.dueAt).slice(0, 10) : "—"}</td>
                      <td className="note">{a.scenario ?? "—"}</td>
                    </tr>
                  ))}
                  {(data.actions ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="note">
                        No treatment actions in the live database for this org yet. Closure fixes above still track
                        verification.
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
