import { formatAedMillions } from "../lib/money.js";
import {
  BASELINE,
  DOMAINS,
  ENTERPRISE_LOSS,
  LOSS,
  MONTHS,
  RANSOM_CATEGORIES,
  UNOBSERVED_ASSUMPTION,
  appetiteState,
  boardComparison,
  compute,
  confidenceLabel,
  daysUntil,
  domainById,
  feedTotals,
  format1,
  format2,
  monthScorecards,
  numWord,
  describeScenario,
  ransomRaw,
  round1,
  scoredById,
  weightedCoverage,
  type Band,
  type GapKey,
} from "./model.js";
import {
  CAPABILITY,
  ROLE_LABEL,
  VIEW_LABEL,
  VIEW_PERMISSION,
  canAcceptRisk,
  hasPermission,
  homeFor,
  isRoleCode,
  landingFor,
  permissionsFor,
  viewsFor,
  type Permission,
  type RoleCode,
  type ViewId,
} from "./rbac.js";
import { listPolicyBundle } from "./policyStore.js";
import type { CommandState, SavedScenario } from "./store.js";

function activePolicyLabel(orgId?: string): string {
  if (!orgId) return "v1 (approved)";
  const active = listPolicyBundle(orgId).active;
  if (!active) return "v1 (approved)";
  return `v${active.version} (approved)`;
}

function sourceLabel(table: string): string {
  switch (table) {
    case "enterprise_scores_v2":
      return "Enterprise scorecard";
    case "domain_scores_v2":
      return "Domain scorecard";
    case "loss_models":
      return "Loss model";
    case "risk_findings":
      return "Risk findings";
    case "executive_decisions":
      return "Decision log";
    case "risk_appetite, risk_acceptances":
      return "Appetite register";
    case "ingestion_runs, asset_coverage":
      return "Feed confidence";
    default:
      return table.replaceAll("_", " ");
  }
}

export interface CommandWorkspace {
  asOf: string;
  snapshotLabel: string;
  orgName: string;
  role: string;
  roleLabel: string;
  permissions: Permission[];
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
  complianceLive: ComplianceLive | null;
}

export interface ComplianceLive {
  posturePct: number | null;
  frameworks: { name: string; coveragePct: number | null }[];
}

interface HeadlineView {
  question: string;
  title: string;
  lede: string;
  band: Band;
  arithmetic: number;
  plain: number;
  floored: boolean;
  floorNote: string | null;
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
  lookFirst: LookFirst[];
  trend: { month: string; score: number; headline: Band }[];
  complianceDomain: { name: string; score: number; band: Band; appetiteState: string } | null;
}

interface LookFirst {
  id: string;
  name: string;
  csf: string;
  score: number;
  band: Band;
  appetiteState: string;
  outside: boolean;
}

interface PostureView {
  question: string;
  title: string;
  lede: string;
  technical: boolean;
  rows: PostureRow[];
}

interface PostureRow {
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
}

interface TrustView {
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
  rows: TrustRow[];
  note: string;
}

interface TrustRow {
  id: string;
  name: string;
  fresh: number;
  total: number;
  coveragePct: number;
  confidencePct: number;
  confidenceLabel: string;
  tone: "crit" | "med" | "low";
  reading: string;
}

interface QueueView {
  question: string;
  title: string;
  lede: string;
  canAct: boolean;
  canAccept: boolean;
  /** False for roles without command.loss — UI omits money KPI entirely. */
  canSeeLoss: boolean;
  items: QueueItemView[];
  log: string[];
}

interface QueueItemView {
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
}

interface WhatIfView {
  question: string;
  title: string;
  lede: string;
  gaps: Record<GapKey, number>;
  weights: { key: GapKey; name: string; weight: number }[];
  cost: string;
  preset: string | null;
  changed: boolean;
  canSave: boolean;
  /** False for roles without command.loss — omit cost field and money columns. */
  canSeeLoss: boolean;
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

interface ClosureView {
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

interface ChangedView {
  question: string;
  title: string;
  lede: string;
  movers: { name: string; from: number; to: number; delta: number; direction: "up" | "down" | "flat" }[];
  also: { label: string; value: string }[];
  note: string;
}

interface PackView {
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

function toneForAppetite(state: string): "crit" | "med" | "low" {
  if (state === "Outside appetite") return "crit";
  if (state === "Approaching") return "med";
  return "low";
}

function outsideCount() {
  return BASELINE.rows.filter((row) => row.adjusted > row.domain.appetite).length;
}

export function scenarioFromState(state: CommandState): SavedScenario {
  return describeScenario(
    {
      edr: state.whatif.edr,
      siem: state.whatif.siem,
      imm: state.whatif.imm,
      dr: state.whatif.dr,
    },
    state.whatif.cost,
    state.whatif.preset,
  );
}

export function presentWorkspace(
  role: string,
  state: CommandState,
  orgName = "Al Dhabi Holdings",
  orgId?: string,
): CommandWorkspace {
  const known = isRoleCode(role);
  const views = viewsFor(role);
  const allow = (permission: Permission) => hasPermission(role, permission);
  const technical = allow("command.posture.technical");
  const loss = allow("command.loss");
  const outside = outsideCount();
  const expiring = state.accept.filter((item) => daysUntil(item.expires) <= 30).length;
  const policyVersion = activePolicyLabel(orgId);
  const openDecisions = state.queue.filter((item) => item.state === "open").length;

  return {
    asOf: "2026-09-05T00:00:00.000Z",
    snapshotLabel: "5 Sep 2026",
    orgName,
    role,
    roleLabel: known ? ROLE_LABEL[role] : role,
    permissions: permissionsFor(role),
    capability: known ? CAPABILITY[role] : "This role has no command-center permissions.",
    landing: landingFor(role),
    views: views.map((id) => ({ id, label: VIEW_LABEL[id] })),
    home: homeFor(role),
    openDecisions,
    headline: allow("command.headline")
      ? presentHeadline(state, loss, expiring, outside, policyVersion, openDecisions)
      : null,
    posture: allow("command.posture") ? presentPosture(technical, outside) : null,
    trust: allow("command.trust") ? presentTrust() : null,
    queue: allow("command.queue") ? presentQueue(role, state, technical, loss) : null,
    whatif: allow("command.whatif") ? presentWhatIf(role, state, loss) : null,
    closure: allow("command.closure") ? presentClosure(role, state) : null,
    changed: allow("command.changed") ? presentChanged(state) : null,
    pack: allow("command.pack") ? presentPack(role, state, orgName) : null,
    complianceLive: null,
  };
}

function presentHeadline(
  _state: CommandState,
  loss: boolean,
  expiring: number,
  outside: number,
  policyVersion: string,
  openDecisions: number,
): HeadlineView {
  const card = BASELINE;
  const critical = card.rows.filter((row) => row.band === "Critical").map((row) => row.domain.name);
  const title = critical.length
    ? critical.length === 1
      ? "One domain is Critical and needs a decision this week."
      : `${numWord(critical.length)} domains are Critical and need decisions this week.`
    : "No domain is Critical.";
  const cmp = scoredById("cmp");
  return {
    question: "Are we OK?",
    title,
    lede: `The headline shows the worst band the evidence supports, not a simple average. A plain average of the 12 domain scores would read ${format1(card.plain)} (${bandName(card.plain)}); the coverage-adjusted average is ${format1(card.arithmetic)} (${bandName(card.arithmetic)}).`,
    band: card.headline,
    arithmetic: round1(card.arithmetic),
    plain: round1(card.plain),
    floored: card.floored,
    floorNote: card.floored
      ? `Floor rule applied. The coverage-adjusted average (${format1(card.arithmetic)}) is ${bandName(card.arithmetic)}, but ${card.counts.Critical} domain${card.counts.Critical > 1 ? "s are" : " is"} Critical, so the headline cannot read better than High.`
      : null,
    counts: card.counts,
    confidencePct: Math.round(card.confidence * 100),
    confidenceLabel: confidenceLabel(card.confidence),
    policyVersion,
    outsideAppetite: outside,
    domainCount: DOMAINS.length,
    expiringAcceptances: expiring,
    // Same open-queue count as workspace.openDecisions (not accept-register size).
    acceptanceCount: openDecisions,
    loss: loss
      ? {
          ale: ENTERPRISE_LOSS.ale,
          p90: ENTERPRISE_LOSS.p90,
          p95: ENTERPRISE_LOSS.p95,
          note: `In most years no major event occurs; the range is driven by rare, large events. A bad year (1 in 10) is about ${formatAedMillions(ENTERPRISE_LOSS.p90)} and 1 in 20 about ${formatAedMillions(ENTERPRISE_LOSS.p95)}. Sum of three simulated scenarios, draw by draw.`,
          drivers: Object.values(LOSS).map((item) => ({ name: item.name, ale: item.ale })),
        }
      : null,
    lookFirst: card.rows
      .filter((row) => row.band === "Critical" || row.band === "High")
      .sort((a, b) => b.adjusted - a.adjusted)
      .map((row) => ({
        id: row.domain.id,
        name: row.domain.name,
        csf: row.domain.csf,
        score: round1(row.adjusted),
        band: row.band,
        appetiteState: appetiteState(row.adjusted, row.domain.appetite),
        outside: row.adjusted > row.domain.appetite,
      })),
    trend: monthScorecards().map(({ month, card: monthCard }) => ({
      month,
      score: round1(monthCard.arithmetic),
      headline: monthCard.headline,
    })),
    complianceDomain: cmp
      ? {
          name: cmp.domain.name,
          score: round1(cmp.adjusted),
          band: cmp.band,
          appetiteState: appetiteState(cmp.adjusted, cmp.domain.appetite),
        }
      : null,
  };
}

function bandName(score: number): string {
  if (score >= 70) return "Critical";
  if (score >= 55) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

function presentPosture(technical: boolean, outside: number): PostureView {
  const rows = [...BASELINE.rows].sort((a, b) => b.adjusted - a.adjusted);
  return {
    question: "Where are we weakest?",
    title: `${outside} of ${DOMAINS.length} domains are outside the board’s appetite.`,
    lede: technical
      ? "Scores are adjusted for coverage. A hatched bar means confidence is below 80%. The tick on each bar is the board’s appetite limit for that domain. Select a row for its evidence."
      : "Scores are coverage-adjusted. The tick on each bar is the board’s appetite limit. Select a row for the executive evidence summary.",
    technical,
    rows: rows.map((row) => {
      const direction =
        row.domain.trend[5]! > row.domain.trend[0]!
          ? "up"
          : row.domain.trend[5]! < row.domain.trend[0]!
            ? "down"
            : "flat";
      const state = appetiteState(row.adjusted, row.domain.appetite);
      const base: PostureRow = {
        id: row.domain.id,
        name: row.domain.name,
        csf: row.domain.csf,
        adjusted: round1(row.adjusted),
        band: row.band,
        appetite: row.domain.appetite,
        appetiteState: state,
        appetiteTone: toneForAppetite(state),
        trend: row.domain.trend,
        trendDirection: direction,
      };
      if (technical) {
        base.raw = row.raw;
        base.coveragePct = Math.round(row.domain.coverage * 100);
        base.confidenceLabel = confidenceLabel(row.confidence);
        base.confidencePct = Math.round(row.confidence * 100);
        base.lowConfidence = row.confidence < 0.8;
      }
      return base;
    }),
  };
}

function presentTrust(): TrustView {
  const feeds = feedTotals();
  const rows = [...BASELINE.rows].sort((a, b) => a.confidence - b.confidence);
  return {
    question: "Can I believe the numbers?",
    title: `${feeds.fresh} of ${feeds.total} feeds are fresh; confidence is ${confidenceLabel(BASELINE.confidence).toLowerCase()} at ${Math.round(BASELINE.confidence * 100)}%.`,
    lede: `Confidence = fresh feeds ÷ total feeds × coverage. Stale or partial feeds are flagged and lower confidence; they are never counted as good. Assets that no tool sees are assumed to be at least as weak as the policy default (${UNOBSERVED_ASSUMPTION}).`,
    fresh: feeds.fresh,
    total: feeds.total,
    weightedCoveragePct: Math.round(weightedCoverage() * 100),
    confidencePct: Math.round(BASELINE.confidence * 100),
    confidenceLabel: confidenceLabel(BASELINE.confidence),
    doubleCount: "Pass",
    policy: "v1",
    policyNote: "Draft, awaiting Board approval (CISO proposes).",
    rows: rows.map((row) => {
      const domain = row.domain;
      const reading =
        domain.fresh < domain.total
          ? `${domain.total - domain.fresh} of ${domain.total} feeds stale`
          : domain.coverage < 0.8
            ? `Low coverage (${Math.round(domain.coverage * 100)}% of assets seen)`
            : "Fresh feeds, good coverage";
      const tone = row.confidence >= 0.8 ? "low" : row.confidence >= 0.5 ? "med" : "crit";
      return {
        id: domain.id,
        name: domain.name,
        fresh: domain.fresh,
        total: domain.total,
        coveragePct: Math.round(domain.coverage * 100),
        confidencePct: Math.round(row.confidence * 100),
        confidenceLabel: confidenceLabel(row.confidence),
        tone,
        reading,
      };
    }),
    note: "Coverage and feed counts are illustrative. In production each row links to its connector runs, rejected-row rate and the asset list behind the denominator.",
  };
}

function presentQueue(role: string, state: CommandState, technical: boolean, loss: boolean): QueueView {
  const open = state.queue.filter((item) => item.state === "open").length;
  const items = [...state.queue].sort((a, b) => b.priority - a.priority);
  return {
    question: "What needs my decision today?",
    title: open ? `${open} decision${open > 1 ? "s" : ""} waiting, ranked by priority.` : "The queue is clear.",
    lede: `Priority = exploitability × asset criticality × exposure. ${isRoleCode(role) ? CAPABILITY[role] : ""}`,
    canAct: hasPermission(role, "command.queue.act"),
    canAccept: canAcceptRisk(role),
    canSeeLoss: loss,
    log: state.decisions,
    items: items.map((item) => {
      const domain = domainById(item.domainId);
      const scenario = LOSS[item.domainId];
      const stateLabel =
        item.state === "approved"
          ? "Approved, fix tracked"
          : item.state === "accepted"
            ? `Accepted until ${item.until}`
            : item.state === "deferred"
              ? "Deferred"
              : null;
      return {
        id: item.id,
        domainId: item.domainId,
        domainName: domain?.name ?? item.domainId,
        title: item.title,
        priority: round1(item.priority * 10),
        priorityTone: item.priority >= 0.9 ? "crit" : item.priority >= 0.6 ? "high" : "med",
        kev: technical ? item.kev : null,
        epss: technical && item.epss !== "n/a" ? item.epss : null,
        asset: item.asset,
        owner: item.owner,
        sla: item.sla,
        recommendation: item.recommendation,
        state: item.state,
        stateLabel,
        until: item.until ?? null,
        loss:
          loss && scenario
            ? { name: scenario.name, ale: scenario.ale, p90: scenario.p90 }
            : null,
      };
    }),
  };
}

function presentWhatIf(role: string, state: CommandState, loss: boolean): WhatIfView {
  const gaps = {
    edr: state.whatif.edr,
    siem: state.whatif.siem,
    imm: state.whatif.imm,
    dr: state.whatif.dr,
  };
  const raw = ransomRaw(gaps);
  const before = scoredById("ran")!;
  const afterCard = compute(DOMAINS, { ran: raw });
  const ranAfter = scoredById("ran", afterCard)!;
  const ratio = ranAfter.adjusted / before.adjusted;
  const aleB = LOSS.ran!.ale;
  const aleA = aleB * ratio;
  const p90A = LOSS.ran!.p90 * ratio;
  const entA = ENTERPRISE_LOSS.ale - aleB + aleA;
  const red = aleB - aleA;
  const changed =
    gaps.edr !== 52 || gaps.siem !== 30 || gaps.imm !== 50 || gaps.dr !== 75;
  const cost = Number.parseFloat(state.whatif.cost);
  const rows: WhatIfView["rows"] = [
    cmp("Ransomware raw score", format1(before.raw), format1(raw)),
    cmp("Ransomware adjusted score", format1(before.adjusted), format1(ranAfter.adjusted)),
    cmp("Ransomware band", before.band, ranAfter.band),
    cmp("Enterprise arithmetic score", format1(BASELINE.arithmetic), format1(afterCard.arithmetic)),
    cmp("Enterprise headline", BASELINE.headline, afterCard.headline),
  ];
  if (loss) {
    rows.push(
      cmp("Ransomware expected loss (AED M a year)", format2(aleB), format2(aleA)),
      cmp("Ransomware bad year (AED M)", format2(LOSS.ran!.p90), format2(p90A)),
      cmp("Enterprise expected loss (AED M a year)", format2(ENTERPRISE_LOSS.ale), format2(entA)),
    );
  }
  const lossDirection = red < 0 ? "rises" : "falls";
  const lossAmount = formatAedMillions(Math.abs(red));
  const title = changed
    ? loss
      ? `Ransomware Readiness moves from ${format1(before.raw)} to ${format1(raw)}, and expected loss ${lossDirection} by ${lossAmount} a year.`
      : `Ransomware Readiness moves from ${format1(before.raw)} to ${format1(raw)}.`
    : "Move a slider to see what a control investment would do.";
  return {
    question: "What should I fund?",
    title,
    lede: "Each slider is the remaining gap for a ransomware control category, using the deck’s weights. The engine reuses the production scoring rules; nothing here changes the live score.",
    gaps,
    weights: RANSOM_CATEGORIES.map((cat) => ({ key: cat.key, name: cat.name, weight: cat.weight })),
    cost: loss ? state.whatif.cost : "",
    preset: state.whatif.preset,
    changed,
    canSave: changed && hasPermission(role, "command.whatif.save"),
    rows,
    roi:
      loss && cost > 0 && red > 0
        ? `${format2(red / cost)} AED of expected annual loss avoided per AED spent (at ${formatAedMillions(cost)}). Show the bad-year reduction as well, since boards often fund against the tail.`
        : null,
    floorNote:
      afterCard.floored || BASELINE.floored
        ? "The headline stays High while any domain is Critical, so a ransomware investment alone does not change it. That is the floor rule working as designed."
        : null,
    canSeeLoss: loss,
    modelNote: loss
      ? "Modelled output. Expected loss scales with the adjusted score: ALE after = ALE before × (score after ÷ score before), exponent 1 (illustrative). Replace with the client’s calibrated loss model."
      : "Modelled output. The engine reuses production scoring rules; nothing here changes the live score.",
    saved: state.scenarios.map((scenario, index) => ({
      index,
      name: scenario.name,
      score: scenario.score,
      lossAvoided: loss ? scenario.lossAvoided : null,
      cost: loss ? scenario.cost || "n/a" : null,
    })),
  };
}

function cmp(label: string, now: string, after: string) {
  return { label, now, after, improved: now !== after };
}

function presentClosure(role: string, state: CommandState): ClosureView {
  const reported = state.fixes.filter((fix) => fix.state === "fix_reported").length;
  const expiring = state.accept.filter((item) => daysUntil(item.expires) <= 30).length;
  return {
    question: "Did it work?",
    title: `${reported} fix${reported === 1 ? "" : "es"} reported but not verified; ${expiring} accepted risk${expiring === 1 ? "" : "s"} expiring in 30 days.`,
    lede: "A fix is closed only when the next scan confirms the weakness is gone. Accepted risks always carry a reason, an approver and an expiry.",
    canVerify: hasPermission(role, "command.closure.verify"),
    canRegister: hasPermission(role, "command.closure.register"),
    fixes: state.fixes.map((fix) => ({
      id: fix.id,
      title: fix.title,
      state: fix.state,
      label:
        fix.state === "verified_closed"
          ? "Verified closed"
          : fix.state === "reopened"
            ? "Reopened: still present"
            : "Fix reported, not verified",
      tone: fix.state === "verified_closed" ? "low" : fix.state === "reopened" ? "crit" : "med",
    })),
    acceptances: state.accept.map((item) => {
      const days = daysUntil(item.expires);
      return {
        id: item.id,
        title: item.title,
        reason: item.reason,
        approver: item.approver,
        expires: item.expires,
        days,
        label: days <= 0 ? "Expired" : `Expires in ${days} days`,
        tone: days <= 0 ? "crit" : days <= 30 ? "med" : "mute",
      };
    }),
  };
}

function presentChanged(state: CommandState): ChangedView {
  const { current, previous, month } = boardComparison();
  const rows = DOMAINS.map((domain, index) => {
    const before = previous.rows[index]!;
    const after = current.rows[index]!;
    return {
      name: domain.name,
      from: round1(before.adjusted),
      to: round1(after.adjusted),
      delta: round1(after.adjusted - before.adjusted),
    };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const worsened = rows.filter((row) => row.delta >= 1).length;
  const improved = rows.filter((row) => row.delta <= -1).length;
  const headline =
    previous.headline === current.headline
      ? `Headline unchanged at ${current.headline}`
      : `Headline moved from ${previous.headline} to ${current.headline}`;
  return {
    question: "What moved since the last board meeting?",
    title: `${headline}; ${worsened} domains worsened, ${improved} improved.`,
    lede: `Compared with the ${month} snapshot (illustrative history). Methodology and policy are the same in both columns, so the difference is real change, not a model change.`,
    movers: rows.slice(0, 8).map((row) => ({
      ...row,
      direction: row.delta >= 1 ? "up" : row.delta <= -1 ? "down" : "flat",
    })),
    also: [
      { label: "Arithmetic score", value: `${format1(previous.arithmetic)} → ${format1(current.arithmetic)}` },
      { label: "Critical domains", value: `${previous.counts.Critical} → ${current.counts.Critical}` },
      { label: "High domains", value: `${previous.counts.High} → ${current.counts.High}` },
      { label: "Decisions taken this session", value: String(state.decisions.length) },
      { label: "Mean time to remediate (illustrative)", value: "41 → 36 days" },
      { label: "SLA breaches (illustrative)", value: "9 → 7" },
    ],
    note: "Trend colours are paired with arrows and signs so the meaning survives print and colour-blind use.",
  };
}

function presentPack(role: string, state: CommandState, orgName: string): PackView {
  const card = BASELINE;
  const { previous, month } = boardComparison();
  const movers = DOMAINS.map((domain, index) => ({
    name: domain.name,
    delta: round1(card.rows[index]!.adjusted - previous.rows[index]!.adjusted),
  }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);
  const critical = card.rows.filter((row) => row.band === "Critical");
  const open = state.queue.filter((item) => item.state === "open");
  const expiring = state.accept.filter((item) => daysUntil(item.expires) <= 30);
  const outside = outsideCount();
  const lowest = [...card.rows]
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, 3)
    .map((row) => `${row.domain.name} (${Math.round(row.confidence * 100)}%)`)
    .join(", ");
  const lossAllowed = hasPermission(role, "command.loss");
  return {
    question: "What do I send the board?",
    title: "A draft pack, built from the changes and ready for your review.",
    lede: "Every sentence below comes from a data row and carries its source. The pack is assembled from a fixed template; a named person reviews and approves it before it is shared.",
    meta: `DWAN Executive Cyber Risk Command Center · Board pack · ${orgName} · snapshot 5 Sep 2026 · DRAFT (sample data)`,
    heading: `Cyber risk is ${card.headline}, driven by ${critical.length} Critical domain${critical.length === 1 ? "" : "s"}`,
    canReview: hasPermission(role, "command.pack.review"),
    reviewedBy: state.packReviewedBy,
    blocks: [
      {
        heading: "Posture",
        text: `The weighted, coverage-adjusted score is ${format1(card.arithmetic)} (${bandName(card.arithmetic)}); the floor rule raises the headline to ${card.headline} because ${critical.map((row) => row.domain.name).join(" and ")} ${critical.length > 1 ? "are" : "is"} Critical. Spread: ${card.counts.Critical} Critical, ${card.counts.High} High, ${card.counts.Medium} Medium, ${card.counts.Low} Low.`,
        items: [{ text: "Enterprise score", source: sourceLabel("enterprise_scores_v2") }],
      },
      ...(lossAllowed
        ? [
            {
              heading: "Money",
              text: `Modelled annualised loss exposure is ${formatAedMillions(ENTERPRISE_LOSS.ale)} expected, and about ${formatAedMillions(ENTERPRISE_LOSS.p90)} in a bad year (1 in 10). The largest driver is ${LOSS.ran!.name.toLowerCase()} at ${formatAedMillions(LOSS.ran!.ale)} expected.`,
              items: [{ text: "Loss model", source: sourceLabel("loss_models") }],
            },
          ]
        : []),
      {
        heading: `What changed since the ${month} meeting`,
        items: movers.map((mover) => {
          const mag = format1(Math.abs(mover.delta));
          const phrase =
            mover.delta <= -0.05
              ? `improved by ${mag}`
              : mover.delta >= 0.05
                ? `worsened by ${mag}`
                : "unchanged";
          return {
            text: `${mover.name} ${phrase}.`,
            source: sourceLabel("domain_scores_v2"),
          };
        }),
      },
      {
        heading: "Decisions needed",
        items: open.length
          ? open.map((item) => ({
              text: `${item.title}. Recommended: ${item.recommendation.charAt(0).toLowerCase()}${item.recommendation.slice(1)}`,
              source: sourceLabel("risk_findings"),
            }))
          : [{ text: "No open decisions.", source: sourceLabel("risk_findings") }],
      },
      ...(state.decisions.length
        ? [
            {
              heading: "Decisions taken",
              items: state.decisions.map((line) => ({
                text: line,
                source: sourceLabel("executive_decisions"),
              })),
            },
          ]
        : []),
      {
        heading: "Appetite and accepted risks",
        text: `${outside} of 12 domains are outside the board’s appetite. ${
          expiring.length
            ? `${expiring.length} accepted risk${expiring.length > 1 ? "s expire" : " expires"} within 30 days and need a renewal decision: ${expiring.map((item) => item.title).join("; ")}.`
            : "No accepted risks expire within 30 days."
        }`,
        items: [{ text: "Appetite register", source: sourceLabel("risk_appetite, risk_acceptances") }],
      },
      {
        heading: "Confidence",
        text: `Overall confidence is ${confidenceLabel(card.confidence).toLowerCase()} (${Math.round(card.confidence * 100)}%). Lowest-confidence domains: ${lowest}.`,
        items: [{ text: "Feed confidence", source: sourceLabel("ingestion_runs, asset_coverage") }],
      },
    ],
  };
}

export function presentEvidence(role: string, domainId: string): EvidenceView | null {
  const allowed =
    hasPermission(role, "command.headline") ||
    hasPermission(role, "command.posture") ||
    hasPermission(role, "command.queue") ||
    hasPermission(role, "command.whatif");
  if (!allowed) return null;
  const row = scoredById(domainId);
  if (!row) return null;
  const technical = hasPermission(role, "command.posture.technical");
  const lossAllowed = hasPermission(role, "command.loss");
  const showBuild =
    domainId === "ran" && (technical || hasPermission(role, "command.whatif"));
  const weightTotal = DOMAINS.reduce((sum, domain) => sum + domain.weight, 0);
  const scenario = LOSS[domainId];
  return {
    id: row.domain.id,
    name: row.domain.name,
    csf: row.domain.csf,
    band: row.band,
    appetiteState: appetiteState(row.adjusted, row.domain.appetite),
    adjusted: round1(row.adjusted),
    appetite: row.domain.appetite,
    trend: row.domain.trend,
    months: [...MONTHS],
    raw: technical ? row.raw : null,
    coveragePct: technical ? Math.round(row.domain.coverage * 100) : null,
    unobserved: technical ? Math.max(row.raw, UNOBSERVED_ASSUMPTION) : null,
    weight: technical ? row.domain.weight : null,
    contribution: technical ? round1((row.adjusted * row.domain.weight) / weightTotal) : null,
    confidencePct: technical ? Math.round(row.confidence * 100) : null,
    fresh: technical ? row.domain.fresh : null,
    total: technical ? row.domain.total : null,
    loss:
      lossAllowed && scenario ? { name: scenario.name, ale: scenario.ale, p90: scenario.p90 } : null,
    scoreBuild: showBuild
      ? RANSOM_CATEGORIES.map((cat) => ({
          category: cat.name,
          weight: cat.weight,
          gap: cat.gap,
          points: round1((cat.weight * cat.gap) / 100),
        }))
      : null,
    scoreBuildTotal: showBuild ? 54 : null,
    scoreBuildNote: showBuild ? "Largest driver: only 7 of 28 recovery tests met target." : null,
    productionNote: showBuild
      ? null
      : "In production this drawer lists each tool category, its numerator and denominator, the connector run, and a link to the raw payload, so any score traces back to the tool data.",
  };
}

export function viewAllowed(role: string, view: ViewId): boolean {
  return hasPermission(role, VIEW_PERMISSION[view]);
}
