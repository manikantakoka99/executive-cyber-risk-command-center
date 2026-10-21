import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { AppProvider, useAppState } from "./context/AppState";
import { ThemeProvider } from "./context/Theme";
import { api } from "./lib/api";
import { forbiddenReason } from "./lib/format";
import type { OverviewResponse } from "./data/types";
import { AdminPage } from "./pages/AdminPage";
import { CommandCenter } from "./pages/command/CommandCenter";
import { ConnectorsPage } from "./pages/ConnectorsPage";
import {
  AuditPage,
  CompliancePage,
  DecisionDetailPage,
  ReportsPage,
} from "./pages/DecisionsReports";
import {
  DomainDetailPage,
  DomainsPage,
  FindingDetailPage,
  FindingsPage,
} from "./pages/DomainsFindings";
import { EmptyState } from "./components/EmptyState";
import { IngestionProofPage } from "./pages/IngestionProofPage";
import { IntelligencePage } from "./pages/IntelligencePage";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PolicyAppetitePage } from "./pages/PolicyAppetitePage";
import { RegisterPage } from "./pages/RegisterPage";
import { ScenarioDetailPage, ScenariosPage } from "./pages/ScenariosPage";
import "./index.css";
import "./design.css";
import "./command.css";

function Permit({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const { me } = useAppState();
  if (!me?.permissions.includes(permission)) {
    return (
      <EmptyState
        code="403"
        title="Outside this role"
        reason={forbiddenReason(me?.role)}
        home={me?.home ?? "/"}
      />
    );
  }
  return children;
}

function OperationsRoute() {
  const { me, ready, orgId, userId } = useAppState();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await api.overview());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Operational data is unavailable");
    }
  }, []);

  useEffect(() => {
    if (!ready || !me?.permissions.includes("ops.overview")) return;
    void load();
  }, [ready, orgId, userId, me, load]);

  // Permission already enforced by parent <Permit>; keep a defensive guard.
  if (!me?.permissions.includes("ops.overview")) {
    return null;
  }
  if (error && !overview) {
    return (
      <div className="page">
        <h1 className="page-title">Operational overview</h1>
        <p className="page-sub">{error}</p>
        <button className="btn primary sm" type="button" onClick={() => void load()}>
          Retry
        </button>
        <p className="note">
          Start PostgreSQL and import the sample workbook to populate this page. The command center
          still runs from the reference model.
        </p>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="page">
        <div className="skeleton" />
      </div>
    );
  }
  return (
    <OverviewPage
      data={overview}
      onExport={async () => {
        setExporting(true);
        try {
          const report = await api.generateReport("board_briefing");
          const blob = new Blob([report.content], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `board-briefing-${overview.org.name}.md`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : "Export failed");
        } finally {
          setExporting(false);
        }
      }}
      exporting={exporting}
      canApprove={me.role === "cxo"}
      canRequestInfo={me.role === "cxo" || me.role === "program_office"}
      actorRole={me.role}
      onOverviewChanged={async () => {
        await load();
      }}
    />
  );
}

function EccApp() {
  const { ready, me, error, retry } = useAppState();
  const location = useLocation();
  if (location.pathname.startsWith("/invite/")) {
    return (
      <Routes>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Routes>
    );
  }
  if (!ready) {
    return (
      <div className="page">
        {error ? (
          <>
            <p className="eyebrow">Session</p>
            <h1 className="page-title">Could not load Command Center</h1>
            <p className="page-sub">{error}</p>
            <button className="btn primary sm" type="button" onClick={retry}>
              Retry
            </button>
          </>
        ) : (
          <>
            <div className="skeleton" />
            <p className="empty">Connecting to Command Center…</p>
          </>
        )}
      </div>
    );
  }
  if (!me) return <LoginPage />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to={me.home} replace />} />
        <Route path="/c/:view" element={<CommandCenter />} />
        <Route
          path="/operations"
          element={
            <Permit permission="ops.overview">
              <OperationsRoute />
            </Permit>
          }
        />
        <Route path="/intelligence" element={<Permit permission="intelligence.read"><IntelligencePage /></Permit>} />
        <Route path="/scenarios" element={<Permit permission="scenarios.read"><ScenariosPage /></Permit>} />
        <Route path="/scenarios/:id" element={<Permit permission="scenarios.read"><ScenarioDetailPage /></Permit>} />
        <Route path="/ingestion" element={<Permit permission="ingestion.read"><IngestionProofPage /></Permit>} />
        {/* Merged nav aliases — deep links still work */}
        <Route path="/risk-domains" element={<Permit permission="domains.read"><DomainsPage /></Permit>} />
        <Route path="/risk-domains/:id" element={<Permit permission="domains.read"><DomainDetailPage /></Permit>} />
        <Route path="/findings" element={<Permit permission="findings.read"><FindingsPage /></Permit>} />
        <Route path="/findings/:id" element={<Permit permission="findings.read"><FindingDetailPage /></Permit>} />
        <Route path="/register" element={<Permit permission="register.read"><RegisterPage /></Permit>} />
        <Route path="/remediation" element={<Navigate to="/c/closure" replace />} />
        <Route path="/connectors" element={<Permit permission="connectors.read"><ConnectorsPage /></Permit>} />
        <Route path="/policy" element={<Permit permission="policy.read"><PolicyAppetitePage /></Permit>} />
        <Route path="/decisions" element={<Navigate to="/c/queue" replace />} />
        <Route path="/decisions/:id" element={<Permit permission="decisions.read"><DecisionDetailPage /></Permit>} />
        <Route path="/compliance" element={<Permit permission="compliance.read"><CompliancePage /></Permit>} />
        <Route path="/reports" element={<Permit permission="reports.read"><ReportsPage /></Permit>} />
        <Route path="/audit" element={<Permit permission="audit.read"><AuditPage /></Permit>} />
        <Route path="/admin" element={<Permit permission="admin.users"><AdminPage /></Permit>} />
        <Route
          path="*"
          element={
            <EmptyState
              code="404"
              title="Page not found"
              reason="That route is not part of this demo."
              home={me.home}
            />
          }
        />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppProvider>
        <BrowserRouter>
          <EccApp />
        </BrowserRouter>
      </AppProvider>
    </ThemeProvider>
  );
}
