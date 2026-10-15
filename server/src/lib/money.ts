/**
 * Shared AED display formatter for API text and seeds.
 * ≥ 1M → "AED x.xM" (one decimal); ≥ 1K → "AED xxxK" (no decimals); else whole dirhams.
 */

export function formatAed(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `AED ${(n / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `AED ${Math.round(n / 1_000)}K`;
  }
  return `AED ${Math.round(n).toLocaleString("en-AE", { maximumFractionDigits: 0 })}`;
}

/** Values already stored as AED millions (command loss model). */
export function formatAedMillions(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return formatAed(n * 1_000_000);
}

/** Match "AED 1,539,905", "AED 610959.62", "AED 2.9M", "AED 611K".
 * Do not allow whitespace before K/M — a trailing `\s*` would swallow the
 * space before "exposure" and glue the replacement to the next word.
 */
const AED_AMOUNT =
  /\bAED\s*([\d,]+(?:\.\d+)?)([KkMm])?\b/g;

/**
 * Rewrite every AED amount in free text through formatAed.
 * Already-compact forms (…K / …M) are normalized via the same rules.
 */
export function reformatAedInText(text: string | null | undefined): string {
  if (text == null || text === "") return text ?? "";
  return text.replace(AED_AMOUNT, (_full, raw: string, suffix?: string) => {
    const cleaned = String(raw).replace(/,/g, "");
    const base = Number(cleaned);
    if (!Number.isFinite(base)) return _full;
    let amount = base;
    if (suffix) {
      const u = suffix.toUpperCase();
      if (u === "M") amount = base * 1_000_000;
      else if (u === "K") amount = base * 1_000;
    }
    return formatAed(amount);
  });
}

/**
 * Prefer regenerating impact chip text from numeric columns; fall back to
 * rewriting any AED literals already present in stored text.
 */
export function formatImpactSummary(opts: {
  text?: string | null;
  financialExposureAed?: number | null;
  downtimeCostPerHourAed?: number | null;
}): string {
  const exposure =
    opts.financialExposureAed != null && Number.isFinite(opts.financialExposureAed)
      ? Number(opts.financialExposureAed)
      : null;
  const downtime =
    opts.downtimeCostPerHourAed != null && Number.isFinite(opts.downtimeCostPerHourAed)
      ? Number(opts.downtimeCostPerHourAed)
      : null;

  if (exposure != null || downtime != null) {
    const parts: string[] = [];
    if (exposure != null) parts.push(`${formatAed(exposure)} exposure`);
    if (downtime != null) parts.push(`downtime ~${formatAed(downtime)}/hr`);
    return parts.join(", ");
  }
  return reformatAedInText(opts.text ?? "");
}
