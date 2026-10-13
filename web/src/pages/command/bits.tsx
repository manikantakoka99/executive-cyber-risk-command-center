import { useEffect, useState } from "react";
import { motion } from "framer-motion";
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
  title: string;
  lede: string;
}) {
  return (
    <motion.header
      className="answer"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="q">{question}</p>
      <h1>{title}</h1>
      <p>{lede}</p>
    </motion.header>
  );
}

export function CountUp({
  value,
  decimals = 0,
  duration = 900,
  prefix = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return (
    <span className="count-up mono">
      {prefix}
      {display.toFixed(decimals)}
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
  const w = 104;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 4);
  const points = values.map((value, index) => {
    const x = (index * (w - 8)) / Math.max(values.length - 1, 1) + 4;
    const y = h - 5 - ((value - min) / range) * (h - 10);
    return { x, y };
  });
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `4,${h} ${line} ${w - 4},${h}`;
  const last = points[points.length - 1] ?? { x: 0, y: 0 };
  const color = tone === "up" ? "var(--crit)" : tone === "down" ? "var(--low)" : "var(--muted)";
  const fill =
    tone === "up"
      ? "url(#spark-up)"
      : tone === "down"
        ? "url(#spark-down)"
        : "url(#spark-flat)";
  return (
    <svg
      className="spark"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label ?? `Trend from ${values[0]} to ${values[values.length - 1]}`}
    >
      <defs>
        <linearGradient id="spark-up" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--crit)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--crit)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="spark-down" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--low)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--low)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="spark-flat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--muted)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--muted)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={fill} />
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
          style={{ filter: `drop-shadow(0 0 10px ${color})`, transition: "stroke-dashoffset 0.8s var(--ease)" }}
        />
      </svg>
      <div className="gauge-center">
        <b>
          <CountUp value={score} decimals={1} />
        </b>
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
      {rows.map((row, index) => (
        <motion.button
          key={row.id}
          type="button"
          role="listitem"
          className={`heat-cell b-${bandTone(row.band)}`}
          onClick={() => onOpen(row.id)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04, duration: 0.28 }}
        >
          <strong>{row.name}</strong>
          <span className="score">
            <CountUp value={row.score} decimals={1} />
          </span>
          <Chip tone={bandTone(row.band)}>{row.band}</Chip>
        </motion.button>
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
  delta?: number;
  invertDelta?: boolean;
  spark?: number[];
  sparkTone?: "up" | "down" | "flat";
  tone?: "crit" | "high" | "med" | "low" | "info";
  note?: string;
}) {
  return (
    <motion.article
      className={`card kpi${tone ? ` tone-${tone}` : ""}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="lbl">{label}</p>
      <div className="kpi-main">
        <p className="big">
          <CountUp value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
        </p>
        {typeof delta === "number" && <Delta value={delta} invert={invertDelta} />}
      </div>
      {spark && spark.length > 1 && <Spark values={spark} tone={sparkTone} label={`${label} trend`} />}
      {note && <p className="note">{note}</p>}
    </motion.article>
  );
}

export function ScoreBar({
  score,
  appetite,
  band,
  hatch,
}: {
  score: number;
  appetite: number;
  band: Band;
  hatch?: boolean;
}) {
  return (
    <div className="sbar" title={`Score ${score.toFixed(1)}, appetite limit ${appetite}`}>
      <i className={`k-${bandTone(band)}${hatch ? " hatch" : ""}`} style={{ width: `${Math.min(100, score)}%` }} />
      <b style={{ left: `${Math.min(100, appetite)}%` }} />
    </div>
  );
}

export function RangeBar({ ale, p90, max }: { ale: number; p90: number; max: number }) {
  const mark = (ale / max) * 100;
  const hi = (p90 / max) * 100;
  return (
    <div className="range" aria-hidden>
      <div className="rail" />
      <div className="span" style={{ left: 0, width: `${hi}%` }} />
      <div className="mk" style={{ left: `${mark}%` }} />
      <span className="t" style={{ left: `${mark}%` }}>
        {ale.toFixed(1)}
      </span>
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
