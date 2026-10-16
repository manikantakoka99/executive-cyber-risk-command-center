import type { ReactNode } from "react";
import type { Band } from "../../data/commandTypes";

export function Chip({
  tone,
  children,
}: {
  tone: "crit" | "high" | "med" | "low" | "info" | "mute";
  children: string;
}) {
  return <span className={`chip c-${tone}`}>{children}</span>;
}

export function bandTone(band: Band): "crit" | "high" | "med" | "low" {
  if (band === "Critical") return "crit";
  if (band === "High") return "high";
  if (band === "Medium") return "med";
  return "low";
}

export function Answer({
  question,
  title,
  lede,
}: {
  question: string;
  title: ReactNode;
  lede: string;
}) {
  return (
    <header className="answer">
      <p className="q">{question}</p>
      <h1>{title}</h1>
      <p>{lede}</p>
    </header>
  );
}

/** Static numeral display (count-up animations removed for trust / single source of truth). */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <span className="count-up mono">
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export function Delta({
  value,
  invert = false,
  label,
}: {
  value: number;
  invert?: boolean;
  label?: string;
}) {
  const improving = invert ? value > 0 : value < 0;
  const tone = value === 0 ? "flat" : improving ? "good" : "bad";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "▬";
  return (
    <span className={`delta tone-${tone}`} title={label}>
      {arrow} {value > 0 ? "+" : ""}
      {value.toFixed(1)}
    </span>
  );
}

export function Spark({
  values,
  tone,
  label,
}: {
  values: number[];
  tone: "up" | "down" | "flat";
  label?: string;
}) {
  const w = 120;
  const h = 40;
  const padL = 22;
  const padR = 4;
  const padT = 4;
  const padB = 12;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 4);
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const points = values.map((value, index) => {
    const x = padL + (index * plotW) / Math.max(values.length - 1, 1);
    const y = padT + plotH - ((value - min) / range) * plotH;
    return { x, y };
  });
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${padL},${padT + plotH} ${line} ${padL + plotW},${padT + plotH}`;
  const last = points[points.length - 1] ?? { x: 0, y: 0 };
  const color = tone === "up" ? "var(--crit)" : tone === "down" ? "var(--low)" : "var(--muted)";
  const uid = `spark-${tone}-${Math.round(min * 10)}-${Math.round(max * 10)}`;
  return (
    <div className="spark-wrap">
      <svg
        className="spark"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={
          label ??
          `Trend from ${values[0]} to ${values[values.length - 1]} (scale ${min.toFixed(0)}–${max.toFixed(0)})`
        }
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <text x={0} y={padT + 8} className="spark-axis" fill="currentColor">
          {max.toFixed(0)}
        </text>
        <text x={0} y={padT + plotH} className="spark-axis" fill="currentColor">
          {min.toFixed(0)}
        </text>
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={padT + plotH}
          stroke="var(--border)"
          strokeWidth="1"
        />
        <polygon points={area} fill={`url(#${uid}-fill)`} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={last.x} cy={last.y} r="2.8" fill={color} />
      </svg>
    </div>
  );
}

export function RiskGauge({
  score,
  band,
  label = "Risk",
}: {
  score: number;
  band: Band;
  label?: string;
}) {
  const tone = bandTone(band);
  const clamped = Math.max(0, Math.min(100, score));
  const r = 54;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped / 100);
  const color =
    tone === "crit"
      ? "var(--crit)"
      : tone === "high"
        ? "var(--high)"
        : tone === "med"
          ? "var(--med)"
          : "var(--low)";
  return (
    <div className="gauge-wrap" role="img" aria-label={`${label} ${score.toFixed(1)}, ${band}`}>
      <svg viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
        <circle
          cx="66"
          cy="66"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform="rotate(-90 66 66)"
        />
      </svg>
      <div className="gauge-center">
        <b className="mono">{score.toFixed(1)}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

export function Heatmap({
  rows,
  onOpen,
}: {
  rows: {
    id: string;
    name: string;
    score: number;
    band: Band;
    appetiteState?: string;
  }[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="heatmap" role="list">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          role="listitem"
          className={`heat-cell b-${bandTone(row.band)}`}
          onClick={() => onOpen(row.id)}
        >
          <strong>{row.name}</strong>
          <span className="score mono">{row.score.toFixed(1)}</span>
          <Chip tone={bandTone(row.band)}>{row.band}</Chip>
        </button>
      ))}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  display,
  delta,
  invertDelta,
  spark,
  sparkTone = "flat",
  tone,
  note,
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  /** Preformatted value (e.g. formatAedMillions); skips prefix/number/suffix. */
  display?: string;
  delta?: number;
  invertDelta?: boolean;
  spark?: number[];
  sparkTone?: "up" | "down" | "flat";
  tone?: "crit" | "high" | "med" | "low" | "info";
  note?: string;
}) {
  return (
    <article className={`card kpi${tone ? ` tone-${tone}` : ""}`}>
      <p className="lbl">{label}</p>
      <div className="kpi-main">
        <p className="big mono">
          {display ?? (
            <>
              {prefix}
              {value.toFixed(decimals)}
              {suffix}
            </>
          )}
        </p>
        {typeof delta === "number" && <Delta value={delta} invert={invertDelta} />}
      </div>
      {spark && spark.length > 1 && <Spark values={spark} tone={sparkTone} label={`${label} trend`} />}
      {note && <p className="note">{note}</p>}
    </article>
  );
}

export function ScoreBar({
  score,
  appetite,
  band,
}: {
  score: number;
  appetite: number;
  band: Band;
  hatch?: boolean;
}) {
  return (
    <div className="sbar" title={`Score ${score.toFixed(1)}, appetite limit ${appetite}`}>
      <i className={`k-${bandTone(band)}`} style={{ width: `${Math.min(100, score)}%` }} />
      <b style={{ left: `${Math.min(100, appetite)}%` }} aria-label={`Appetite ${appetite}`} />
    </div>
  );
}

export function RangeBar({ ale, p90, max }: { ale: number; p90: number; max: number }) {
  const mark = (ale / max) * 100;
  const hi = (p90 / max) * 100;
  return (
    <div className="range" aria-hidden>
      <span className="t above" style={{ left: `${mark}%` }}>
        {ale.toFixed(1)}
      </span>
      <div className="rail" />
      <div className="span" style={{ left: 0, width: `${hi}%` }} />
      <div className="mk" style={{ left: `${mark}%` }} />
    </div>
  );
}

export function fmt1(n: number) {
  return n.toFixed(1);
}

export function fmt2(n: number) {
  return n.toFixed(2);
}

export function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ minHeight: i === 0 ? 120 : 72 }} />
      ))}
    </div>
  );
}
