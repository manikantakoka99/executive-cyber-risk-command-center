export function formatAed(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(1)}K`;
  return `AED ${n.toLocaleString("en-AE", { maximumFractionDigits: 0 })}`;
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
      return "CXO";
    case "board_member":
      return "Board";
    case "program_office":
      return "Program Office";
    case "domain_analyst":
      return "Analyst";
    case "auditor":
      return "Auditor";
    default:
      return role;
  }
}

export function trendDirection(delta: number | null | undefined): string {
  if (delta == null) return "Trend unavailable";
  if (delta > 0) return `Risk rising (+${delta} pts)`;
  if (delta < 0) return `Risk improving (${delta} pts)`;
  return "Risk unchanged vs prior snapshot";
}

