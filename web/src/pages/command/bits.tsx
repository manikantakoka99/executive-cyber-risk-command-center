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
    <header className="answer">
      <p className="q">{question}</p>
      <h1>{title}</h1>
      <p>{lede}</p>
    </header>
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
  const w = 88;
  const h = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 4);
  const pts = values
    .map((value, index) => {
      const x = (index * (w - 6)) / (values.length - 1) + 3;
      const y = h - 4 - ((value - min) / range) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = pts.split(" ").pop()?.split(",") ?? ["0", "0"];
  const color = tone === "up" ? "var(--crit)" : tone === "down" ? "var(--low)" : "var(--muted)";
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label ?? `Trend from ${values[0]} to ${values[values.length - 1]}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
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
