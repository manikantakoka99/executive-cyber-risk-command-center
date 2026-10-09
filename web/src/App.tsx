import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider, useAppState } from "./context/AppState";
import { Shell } from "./components/Shell";
import { OverviewPage } from "./pages/OverviewPage";
import {
  DomainDetailPage,
  DomainsPage,
  FindingDetailPage,
  FindingsPage,
} from "./pages/DomainsFindings";
import {
  AuditPage,
  CompliancePage,
  DecisionDetailPage,
  DecisionsPage,
  ReportsPage,
} from "./pages/DecisionsReports";
import {
  ScenarioDetailPage,
  ScenariosPage,
} from "./pages/ScenariosPage";
import { IntelligencePage } from "./pages/IntelligencePage";
import { IngestionProofPage } from "./pages/IngestionProofPage";
import { api } from "./lib/api";
import type { OverviewResponse } from "./data/types";
import { relativeTime } from "./lib/format";
import "./index.css";

function EccApp() {
  const { ready, orgId, userId, me } = useAppState();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const data = await api.overview();
      setOverview(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadOverview();
    const t = setInterval(() => loadOverview(true), 45000);
    return () => clearInterval(t);
  }, [ready, orgId, userId, loadOverview]);

  const onExport = async () => {
    setExporting(true);
    try {
      const report = await api.generateReport("board_briefing");
      const blob = new Blob([report.content], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `board-briefing-${overview?.org.name ?? "org"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      await loadOverview(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  const canApprove = me?.role === "cxo";
  const canRequestInfo = me?.role === "cxo" || me?.role === "program_office";

  return (
    <Shell
      lastUpdated={overview ? relativeTime(overview.asOf) : null}
      refreshing={refreshing}
      dataError={error}
    >
      {!ready ? (
        <div className="page">
          <div className="skeleton" />
          <p className="empty">Connecting to Command Center…</p>
        </div>
      ) : (
        <Routes>
          <Route
            path="/"
            element={
              error && !overview ? (
                <div className="page">
                  <p className="banner-error">{error}</p>
                </div>
              ) : overview ? (
                <OverviewPage
                  data={overview}
                  onExport={onExport}
                  exporting={exporting}
                  canApprove={!!canApprove}
                  canRequestInfo={!!canRequestInfo}
                  actorRole={me?.role ?? null}
                  onOverviewChanged={() => loadOverview(true)}
                />
              ) : (
                <div className="page">
                  <div className="skeleton" />
                </div>
              )
            }
          />
          <Route path="/intelligence" element={<IntelligencePage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/scenarios/:id" element={<ScenarioDetailPage />} />
          <Route path="/ingestion" element={<IngestionProofPage />} />
          <Route path="/risk-domains" element={<DomainsPage />} />
          <Route path="/risk-domains/:id" element={<DomainDetailPage />} />
          <Route path="/findings" element={<FindingsPage />} />
          <Route path="/findings/:id" element={<FindingDetailPage />} />
          <Route path="/decisions" element={<DecisionsPage />} />
          <Route path="/decisions/:id" element={<DecisionDetailPage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </Shell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <EccApp />
      </BrowserRouter>
    </AppProvider>
  );
}
