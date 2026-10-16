import { useCallback, useEffect, useState } from "react";
import { useAppState } from "../context/AppState";
import { ApiError, api } from "../lib/api";

type Policy = {
  policyId: string;
  version: number;
  status: string;
  unobservedDefault: number;
  bandMediumMin: number;
  bandHighMin: number;
  bandCriticalMin: number;
  floorEnabled: boolean;
  floorBand: string;
  notes: string;
  proposedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  effectiveFrom: string | null;
};

type Appetite = {
  appetiteId: string;
  domainCode: string | null;
  domainName: string;
  maxScore: number;
  status: string;
  proposedByName: string | null;
  approvedByName: string | null;
  rationale: string;
};

export function PolicyAppetitePage() {
  const { me } = useAppState();
  const [versions, setVersions] = useState<Policy[]>([]);
  const [active, setActive] = useState<Policy | null>(null);
  const [appetites, setAppetites] = useState<Appetite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notes, setNotes] = useState("Draft: tighten Critical band / refresh weights.");
  const [criticalMin, setCriticalMin] = useState(68);
  const [appetiteDomain, setAppetiteDomain] = useState<string>("soc");
  const [appetiteMax, setAppetiteMax] = useState(45);
  const [busy, setBusy] = useState(false);

  const canPropose = !!me?.permissions.includes("policy.propose");
  const canApprove = !!me?.permissions.includes("policy.approve");

  const load = useCallback(async () => {
    const data = await api.policyBundle();
    setVersions(data.versions);
    setActive(data.active);
    setAppetites(data.appetites);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Policy unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [load, me?.userId]);

  const propose = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await api.proposePolicy({
        notes,
        bandCriticalMin: criticalMin,
      });
      setVersions(data.versions);
      setActive(data.active);
      setAppetites(data.appetites);
      setNotice(`Draft policy v${data.policy.version} proposed. Board must approve to lock.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Propose failed");
    } finally {
      setBusy(false);
    }
  };

  const approve = async (policyId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await api.approvePolicy(policyId);
      setVersions(data.versions);
      setActive(data.active);
      setAppetites(data.appetites);
      setNotice(`Policy v${data.policy.version} approved and locked.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed");
    } finally {
      setBusy(false);
    }
  };

  const proposeAppetite = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await api.proposeAppetite({
        domainCode: appetiteDomain === "enterprise" ? null : appetiteDomain,
        maxScore: appetiteMax,
        rationale: `Proposed appetite ${appetiteMax} for ${appetiteDomain}`,
      });
      setAppetites(data.appetites);
      setNotice("Appetite draft proposed. Board must approve to lock.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Appetite propose failed");
    } finally {
      setBusy(false);
    }
  };

  const approveAppetite = async (id: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await api.approveAppetite(id);
      setAppetites(data.appetites);
      setNotice("Appetite approved and locked.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Appetite approve failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Governance</p>
          <h1 className="page-title">Scoring policy & appetite</h1>
          <p className="page-sub">
            CISO proposes drafts. Board and CxO may approve and lock the version. The proposer
            cannot approve their own proposal; approved versions are immutable.
          </p>
        </div>
      </div>
      {error && (
        <p className="banner-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner-ok" role="status">
          {notice}
        </p>
      )}

      <div className="card-grid" style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        <article className="card kpi">
          <p className="lbl">Active policy</p>
          <p className="big">{active ? `v${active.version}` : "—"}</p>
          <p className="note">{active?.status ?? "none approved"}</p>
        </article>
        <article className="card kpi">
          <p className="lbl">Critical band ≥</p>
          <p className="big">{active?.bandCriticalMin ?? "—"}</p>
          <p className="note">Floor {active?.floorEnabled ? `on (${active.floorBand})` : "off"}</p>
        </article>
        <article className="card kpi">
          <p className="lbl">Your authority</p>
          <p className="big">{canPropose || canApprove ? "Act" : "View"}</p>
          <p className="note">
            {canPropose && canApprove
              ? "Propose and approve"
              : canPropose
                ? "Propose drafts"
                : canApprove
                  ? "Approve & lock"
                  : "Read-only"}
          </p>
        </article>
      </div>

      {canPropose && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Propose scoring policy</h3>
          <p className="note">Creates a new draft version. Board approval locks it.</p>
          <div className="form">
            <label>
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </label>
            <label>
              Critical band minimum
              <input
                type="number"
                min={0}
                max={100}
                value={criticalMin}
                onChange={(e) => setCriticalMin(Number(e.target.value))}
              />
            </label>
            <button className="btn primary sm" type="button" disabled={busy} onClick={() => void propose()}>
              Propose draft
            </button>
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Policy versions</h3>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Bands</th>
                <th>Proposed by</th>
                <th>Approved by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((p) => (
                <tr key={p.policyId}>
                  <td>
                    <b>v{p.version}</b>
                    <div className="note">{p.notes}</div>
                  </td>
                  <td>
                    <span className={`chip ${p.status === "approved" ? "info" : p.status === "draft" ? "med" : "mute"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="mono">
                    {p.bandMediumMin}/{p.bandHighMin}/{p.bandCriticalMin}
                  </td>
                  <td>{p.proposedByName ?? "—"}</td>
                  <td>{p.approvedByName ?? "—"}</td>
                  <td>
                    {p.status === "draft" && canApprove && (
                      <button
                        className="btn primary sm"
                        type="button"
                        disabled={busy}
                        onClick={() => void approve(p.policyId)}
                      >
                        Approve & lock
                      </button>
                    )}
                    {p.status === "approved" && <span className="note">Immutable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canPropose && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Propose appetite change</h3>
          <div className="form form-row">
            <label>
              Domain
              <select value={appetiteDomain} onChange={(e) => setAppetiteDomain(e.target.value)}>
                <option value="enterprise">Enterprise</option>
                <option value="att">Attack Surface</option>
                <option value="soc">SOC / MDR</option>
                <option value="tpr">Third-Party</option>
                <option value="ran">Ransomware</option>
                <option value="pci">PCI DSS</option>
              </select>
            </label>
            <label>
              Max score
              <input
                type="number"
                min={0}
                max={100}
                value={appetiteMax}
                onChange={(e) => setAppetiteMax(Number(e.target.value))}
              />
            </label>
            <button className="btn primary sm" type="button" disabled={busy} onClick={() => void proposeAppetite()}>
              Propose appetite
            </button>
          </div>
        </section>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Board appetite</h3>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Max</th>
                <th>Status</th>
                <th>Proposed</th>
                <th>Approved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {appetites.map((a) => (
                <tr key={a.appetiteId}>
                  <td>
                    <b>{a.domainName}</b>
                    <div className="note">{a.rationale}</div>
                  </td>
                  <td className="mono">{a.maxScore}</td>
                  <td>{a.status}</td>
                  <td>{a.proposedByName ?? "—"}</td>
                  <td>{a.approvedByName ?? "—"}</td>
                  <td>
                    {a.status === "draft" && canApprove && (
                      <button
                        className="btn primary sm"
                        type="button"
                        disabled={busy}
                        onClick={() => void approveAppetite(a.appetiteId)}
                      >
                        Approve & lock
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
