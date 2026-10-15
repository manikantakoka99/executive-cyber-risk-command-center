/** One money formatter for the whole app: AED x.xxM at/above 1M, AED xxx.xK below. */
export function formatAed(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = n / 1_000_000;
    return `AED ${m.toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    const k = n / 1_000;
    return `AED ${k.toFixed(1)}K`;
  }
  return `AED ${n.toLocaleString("en-AE", { maximumFractionDigits: 0 })}`;
}

/** Format AED millions figure already stored as millions (command loss model). */
export function formatAedMillions(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `AED ${n.toFixed(2)}M`;
}

export function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Number(n).toFixed(n % 1 === 0 ? 0 : 1)}%`;
}

export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short" });
}

export function severityClass(sev: string): string {
  if (sev === "critical") return "crit";
  if (sev === "high") return "high";
  if (sev === "medium") return "med";
  return "good";
}

export function severityBadge(sev: string): string {
  if (sev === "critical") return "st-crit";
  if (sev === "high") return "st-high";
  if (sev === "medium") return "st-med";
  return "st-good";
}

export function scoreColor(sev: string): string {
  if (sev === "critical") return "var(--critical)";
  if (sev === "high") return "var(--high)";
  if (sev === "medium") return "var(--medium)";
  return "var(--good)";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

/** Decision workflow status → badge class */
export function decisionStatusBadge(status: string): string {
  switch (status) {
    case "awaiting_decision":
      return "st-crit";
    case "info_requested":
      return "st-high";
    case "approved":
      return "st-good";
    case "declined":
      return "st-med";
    case "closed":
      return "st-good";
    default:
      return "st-med";
  }
}

export function roleLabel(role: string): string {
  switch (role) {
    case "cxo":
      return "CxO";
    case "ciso":
      return "CISO";
    case "board_member":
      return "Board Member";
    case "risk_lead":
      return "Risk Lead";
    case "admin":
      return "Admin";
    case "program_office":
      return "Program Office";
    case "domain_analyst":
      return "Domain Analyst";
    case "auditor":
      return "Auditor";
    default:
      return role.replaceAll("_", " ");
  }
}

/** Normalize stray casings like cXO / CXO / cxo → CxO in free text. */
export function normalizeCxO(text: string): string {
  return text.replace(/\bcxo\b/gi, "CxO");
}

export function trendDirection(delta: number | null | undefined): string {
  if (delta == null) return "Trend unavailable";
  if (delta > 0) return `Risk rising (+${delta} pts)`;
  if (delta < 0) return `Risk improving (${delta} pts)`;
  return "Risk unchanged vs prior snapshot";
}

/** Score deltas: lower is improved. */
export function scoreDeltaPhrase(delta: number): string {
  const mag = Math.abs(delta).toFixed(1);
  if (delta <= -0.05) return `improved by ${mag}`;
  if (delta >= 0.05) return `worsened by ${mag}`;
  return "unchanged";
}
