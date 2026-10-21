export type Band = "Critical" | "High" | "Medium" | "Low";
export type ViewId =
  | "headline"
  | "posture"
  | "trust"
  | "queue"
  | "whatif"
  | "closure"
  | "changed"
  | "pack";

export interface CommandWorkspace {
  asOf: string;
  snapshotLabel: string;
  orgName: string;
  role: string;
  roleLabel: string;
  permissions: string[];
  capability: string;
  landing: ViewId;
  views: { id: ViewId; label: string }[];
  home: string;
  openDecisions: number;
  headline: HeadlineView | null;
  posture: PostureView | null;
  trust: TrustView | null;
  queue: QueueView | null;
  whatif: WhatIfView | null;
  closure: ClosureView | null;
  changed: ChangedView | null;
  pack: PackView | null;
  complianceLive: {
    posturePct: number | null;
    frameworks: { name: string; code?: string; coveragePct: number | null }[];
    nist: {
      label: string;
      empty?: boolean;
      coveragePct: number | null;
      evidenced: number;
      total: number;
      note: string;
      functions: { name: string; covered: number; total: number; gaps: string[]; partial: string[] }[];
    } | null;
  } | null;
}

export interface HeadlineView {
  question: string;
  title: string;
  lede: string;
  band: Band;
  arithmetic: number;
  plain: number;
  floored: boolean;
  floorNote: string | null;
  floorDomainId: string | null;
  floorDomainName: string | null;
  counts: Record<Band, number>;
  confidencePct: number | null;
  confidenceLabel: string | null;
  policyVersion: string;
  outsideAppetite: number;
  domainCount: number;
  expiringAcceptances: number | null;
  acceptanceCount: number | null;
  loss: null | {
    ale: number;
    p90: number;
    p95: number;
    note: string;
    drivers: { name: string; ale: number }[];
  };
  lookFirst: {
    id: string;
    name: string;
    csf: string;
    score: number;
    band: Band;
    appetiteState: string;
    outside: boolean;
  }[];
  trend: { month: string; score: number; headline: Band }[];
  complianceDomain: { name: string; score: number; band: Band; appetiteState: string } | null;
}

export interface PostureView {
  question: string;
  title: string;
  lede: string;
  technical: boolean;
  rows: {
    id: string;
    name: string;
    csf: string;
    adjusted: number;
    band: Band;
    appetite: number;
    appetiteState: string;
    appetiteTone: "crit" | "med" | "low";
    trend: number[];
    trendDirection: "up" | "down" | "flat";
    raw?: number;
    coveragePct?: number;
    confidenceLabel?: string;
    confidencePct?: number;
    lowConfidence?: boolean;
  }[];
}

export interface TrustView {
  question: string;
  title: string;
  lede: string;
  fresh: number;
  total: number;
  weightedCoveragePct: number;
  confidencePct: number;
  confidenceLabel: string;
  doubleCount: string;
  policy: string;
  policyNote: string;
  rows: {
    id: string;
    name: string;
    fresh: number;
    total: number;
    coveragePct: number;
    confidencePct: number;
    confidenceLabel: string;
    tone: "crit" | "med" | "low";
    reading: string;
  }[];
  note: string;
}

export interface QueueView {
  question: string;
  title: string;
  lede: string;
  canAct: boolean;
  /** CxO + Risk Lead (server canAcceptRisk); independent of Decide/canAct */
  canAccept?: boolean;
  /** When false, omit modelled-exposure KPI (no AED placeholders). */
  canSeeLoss?: boolean;
  items: {
    id: string;
    domainId: string;
    domainName: string;
    title: string;
    priority: number;
    priorityTone: "crit" | "high" | "med";
    kev: boolean | null;
    epss: string | null;
    asset: string | null;
    owner: string;
    sla: string;
    recommendation: string;
    state: string;
    stateLabel: string | null;
    until: string | null;
    loss: { name: string; ale: number; p90: number } | null;
  }[];
  log: string[];
}

export interface WhatIfView {
  question: string;
  title: string;
  lede: string;
  gaps: { edr: number; siem: number; imm: number; dr: number };
  weights: { key: "edr" | "siem" | "imm" | "dr"; name: string; weight: number }[];
  cost: string;
  preset: string | null;
  changed: boolean;
  canSave: boolean;
  /** When false, omit cost input and money columns (no AED placeholders). */
  canSeeLoss?: boolean;
  rows: { label: string; now: string; after: string; improved: boolean }[];
  roi: string | null;
  floorNote: string | null;
  modelNote: string;
  saved: {
    index: number;
    name: string;
    score: string;
    lossAvoided: string | null;
    cost: string | null;
  }[];
}

export interface ClosureView {
  question: string;
  title: string;
  lede: string;
  canVerify: boolean;
  canRegister: boolean;
  fixes: { id: string; title: string; state: string; label: string; tone: "crit" | "med" | "low" }[];
  acceptances: {
    id: string;
    title: string;
    reason: string;
    approver: string;
    expires: string;
    days: number;
    label: string;
    tone: "crit" | "med" | "mute";
  }[];
}

export interface ChangedView {
  question: string;
  title: string;
  lede: string;
  movers: { name: string; from: number; to: number; delta: number; direction: "up" | "down" | "flat" }[];
  also: { label: string; value: string }[];
  note: string;
}

export interface PackView {
  question: string;
  title: string;
  lede: string;
  meta: string;
  heading: string;
  blocks: { heading: string; text?: string; items?: { text: string; source: string }[] }[];
  canReview: boolean;
  reviewedBy: string | null;
}

export interface EvidenceView {
  id: string;
  name: string;
  csf: string;
  band: Band;
  appetiteState: string;
  adjusted: number;
  appetite: number;
  trend: number[];
  months: string[];
  raw: number | null;
  coveragePct: number | null;
  unobserved: number | null;
  weight: number | null;
  contribution: number | null;
  confidencePct: number | null;
  fresh: number | null;
  total: number | null;
  loss: { name: string; ale: number; p90: number } | null;
  scoreBuild: { category: string; weight: number; gap: number; points: number }[] | null;
  scoreBuildTotal: number | null;
  scoreBuildNote: string | null;
  productionNote: string | null;
}

export interface CommandMutation {
  toast?: string;
  workspace: CommandWorkspace;
}
