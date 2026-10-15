import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppState } from "../../context/AppState";
import type { CommandWorkspace, EvidenceView, ViewId } from "../../data/commandTypes";
import { ApiError, api } from "../../lib/api";
import {
  ChangedView,
  ClosureView,
  EvidenceDrawer,
  HeadlineView,
  PackView,
  PostureView,
  QueueView,
  TrustView,
  WhatIfView,
} from "./views";

const VIEWS: ViewId[] = ["headline", "posture", "trust", "queue", "whatif", "closure", "changed", "pack"];

function isView(value: string | undefined): value is ViewId {
  return !!value && (VIEWS as string[]).includes(value);
}

export function CommandCenter() {
  const { view: viewParam } = useParams();
  const navigate = useNavigate();
  const { me, ready } = useAppState();
  const [workspace, setWorkspace] = useState<CommandWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [acceptFor, setAcceptFor] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.commandWorkspace();
      setWorkspace(data);
      setError(null);
    } catch (err) {
      setWorkspace(null);
      setError(err instanceof ApiError ? err.message : "Command center unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !me) return;
    // Clear cached workspace/evidence on persona switch so stale 403 views cannot linger.
    setWorkspace(null);
    setEvidence(null);
    setAcceptFor(null);
    setError(null);
    void load();
  }, [ready, me?.userId, me?.role, load]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!evidence) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEvidence(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [evidence]);

  const apply = async (run: () => Promise<{ toast?: string; workspace: CommandWorkspace }>) => {
    try {
      const result = await run();
      setWorkspace(result.workspace);
      if (result.toast) setToast(result.toast);
      setError(null);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "Action was refused");
    }
  };

  const openEvidence = async (id: string) => {
    try {
      const { evidence: next } = await api.commandDomain(id);
      setEvidence(next);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "Evidence is outside this role");
    }
  };

  const requested = workspace && isView(viewParam) ? viewParam : workspace?.landing;
  const view =
    workspace && requested && workspace.views.some((item) => item.id === requested)
      ? requested
      : workspace?.landing;

  useEffect(() => {
    if (!workspace || !me || workspace.role !== me.role) return;
    if (!view || viewParam === view) return;
    navigate(`/c/${view}`, { replace: true });
  }, [navigate, view, viewParam, workspace, me]);

  if (!me) return null;
  if (loading && !workspace) {
    return (
      <div className="cc">
        <div className="skeleton-stack">
          <div className="skeleton" style={{ minHeight: 64 }} />
          <div className="kpi-row">
            <div className="skeleton" style={{ minHeight: 120 }} />
            <div className="skeleton" style={{ minHeight: 120 }} />
            <div className="skeleton" style={{ minHeight: 120 }} />
            <div className="skeleton" style={{ minHeight: 120 }} />
          </div>
          <div className="skeleton" style={{ minHeight: 220 }} />
        </div>
        <p className="empty">Loading the command center…</p>
      </div>
    );
  }
  if (error || !workspace) {
    return (
      <div className="page">
        <h1 className="page-title">This view is outside your role</h1>
        <p className="page-sub">{error}</p>
      </div>
    );
  }

  const current = workspace.views.find((item) => item.id === view);

  return (
    <div className="cc">
      <div className="cc-tabs" role="tablist" aria-label="Command views">
        {workspace.views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === view}
            onClick={() => navigate(`/c/${item.id}`)}
          >
            {item.label}
            {item.id === "queue" && workspace.openDecisions > 0 && (
              <span className="dot">{workspace.openDecisions}</span>
            )}
          </button>
        ))}
      </div>
      {view === "headline" && workspace.headline && (
        <HeadlineView
          data={workspace.headline}
          openDecisions={workspace.openDecisions}
          compliance={workspace.complianceLive}
          onOpen={(id) => void openEvidence(id)}
        />
      )}
      {view === "posture" && workspace.posture && (
        <PostureView data={workspace.posture} onOpen={(id) => void openEvidence(id)} />
      )}
      {view === "trust" && workspace.trust && <TrustView data={workspace.trust} />}
      {view === "queue" && workspace.queue && (
        <QueueView
          data={workspace.queue}
          acceptFor={acceptFor}
          onAcceptFor={setAcceptFor}
          onApprove={(id) => void apply(() => api.commandPost(`queue/${id}/approve`))}
          onDefer={(id) => void apply(() => api.commandPost(`queue/${id}/defer`))}
          onReopen={(id) => void apply(() => api.commandPost(`queue/${id}/reopen`))}
          onAccept={(id, body) => {
            setAcceptFor(null);
            void apply(() => api.commandPost(`queue/${id}/accept`, body));
          }}
          onEvidence={(id) => void openEvidence(id)}
        />
      )}
      {view === "whatif" && workspace.whatif && (
        <WhatIfView
          data={workspace.whatif}
          onChange={(body) => void apply(() => api.commandWhatIf(body))}
          onSave={() => void apply(() => api.commandPost("whatif/scenarios"))}
          onConvert={(index) => void apply(() => api.commandPost(`whatif/scenarios/${index}/decision`))}
        />
      )}
      {view === "closure" && workspace.closure && (
        <ClosureView
          data={workspace.closure}
          onVerify={(id) => void apply(() => api.commandPost(`fixes/${id}/verify`))}
          onRenew={(id) => void apply(() => api.commandPost(`acceptances/${id}/renew`))}
          onRevoke={(id) => void apply(() => api.commandPost(`acceptances/${id}/revoke`))}
        />
      )}
      {view === "changed" && workspace.changed && <ChangedView data={workspace.changed} />}
      {view === "pack" && workspace.pack && (
        <PackView
          data={workspace.pack}
          onPrint={() => window.print()}
          onReview={() => void apply(() => api.commandPost("pack/review"))}
        />
      )}
      {!current && <p className="empty">This view is not available for {workspace.roleLabel}.</p>}
      {evidence && (
        <>
          <button className="scrim" type="button" aria-label="Close evidence" onClick={() => setEvidence(null)} />
          <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(null)} />
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
