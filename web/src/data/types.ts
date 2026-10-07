export type Severity = "low" | "medium" | "high" | "critical";

export interface Organization {
  orgId: string;
  name: string;
  industry: string;
  hqCountry?: string;
}

export interface UserRef {
  userId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: string;
}

export interface OverviewResponse {
  org: { orgId: string; name: string; industry: string };
  asOf: string;
  enterpriseRisk: {
    score: number;
    severity: Severity;
    driverSummary: string | null;
    snapshotAt: string;
    priorScore: number | null;
    deltaVsPrior: number | null;
  } | null;
  businessImpactExposureAed: number;
  compliancePosturePct: number | null;
  decisionsAwaitingCxo: number;
  decisionsAwaitingCritical: number;
  criticalFindingsOpen: number;
  domainsMonitored: number;
  domains: DomainCard[];
  pendingDecisions: PendingDecision[];
  compliance: ComplianceRow[];
  riskTrend: TrendPoint[];
  activity: ActivityItem[];
  riskAppetite: number;
}

export interface DomainCard {
  riskDomainId: string;
  code: string;
  shortLabel: string;
  displayName: string;
  score: number;
  severity: Severity;
  headlineDetail: string | null;
  snapshotAt: string;
}

export interface PendingDecision {
  decisionId: string;
  findingId?: string | null;
  title: string;
  priority: string;
  riskSummary: string;
  impactSummary: string;
  recommendedAction: string;
  status: string;
  escalatedAt: string;
  domainLabel: string | null;
  financialExposureAed?: number | null;
  affectedBusinessUnit?: string | null;
  complianceScopeImpact?: string | null;
}

export interface ComplianceRow {
  frameworkId: string;
  code: string;
  displayName: string;
  coveragePct: number;
  controlsTotal: number | null;
  controlsEvidenced: number | null;
  nextRenewalDate: string | null;
}

export interface TrendPoint {
  snapshotAt: string;
  score: number;
  severity: Severity;
  driverSummary: string | null;
}

export interface ActivityItem {
  activityId: string;
  activityType: string;
  summary: string;
  occurredAt: string;
  domainLabel: string | null;
}
