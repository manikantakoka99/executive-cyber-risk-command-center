import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ChangedView,
  ClosureView,
  CommandWorkspace,
  EvidenceView,
  HeadlineView,
  PackView,
  PostureView,
  QueueView,
  TrustView,
  WhatIfView,
} from "../../data/commandTypes";
import {
  Answer,
  Chip,
  CountUp,
  Heatmap,
  KpiCard,
  RangeBar,
  RiskGauge,
  ScoreBar,
  Spark,
  bandTone,
  fmt1,
  fmt2,
} from "./bits";

const chartTooltip = {
  background: "var(--surface-solid)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  color: "var(--fg)",
  boxShadow: "var(--shadow)",
};

export function HeadlineView({
  data,
  compliance,
  onOpen,
}: {
  data: HeadlineView;
  compliance: CommandWorkspace["complianceLive"];
  onOpen: (id: string) => void;
}) {
  const trendDelta =
    data.trend.length > 1
      ? data.trend[data.trend.length - 1]!.score - data.trend[0]!.score
      : 0;
  const sparkValues = data.trend.map((row) => row.score);

  return (
    <div className="view-board">
      <Answer question={data.question} title={data.title} lede={data.lede} />

      <div className="kpi-row">
        <KpiCard
          label="Enterprise score"
          value={data.arithmetic}
          decimals={1}
          delta={trendDelta}
          spark={sparkValues}
          sparkTone={trendDelta > 0.2 ? "up" : trendDelta < -0.2 ? "down" : "flat"}
          tone={bandTone(data.band)}
          note={`${data.band} · ${data.policyVersion}`}
        />
        <KpiCard
          label="Outside appetite"
          value={data.outsideAppetite}
          suffix={` / ${data.domainCount}`}
          tone={data.outsideAppetite > 0 ? "crit" : "low"}
          note="Domains above board limit"
        />
        {data.loss && (
          <KpiCard
            label="Expected annual loss"
            value={data.loss.ale}
            decimals={1}
            prefix="AED "
            suffix="M"
            tone="high"
            note={`P90 bad year AED ${fmt1(data.loss.p90)}M`}
          />
        )}
        <KpiCard
          label="Confidence"
          value={data.confidencePct ?? 0}
          suffix="%"
          tone={
            (data.confidencePct ?? 0) >= 80 ? "low" : (data.confidencePct ?? 0) >= 60 ? "med" : "crit"
          }
          note={data.confidenceLabel ?? "Coverage-adjusted"}
        />
      </div>

      <div className="cc-hero">
        <article className="card hero-story">
          <p className="lbl">Enterprise cyber risk</p>
          <div className="band-big">
            <RiskGauge score={data.arithmetic} band={data.band} label={data.band} />
            <div>
              <span className={`word tone-${bandTone(data.band)}`}>{data.band}</span>
              <p className="note">Weighted, coverage-adjusted score with floor rule.</p>
              <div className="spread" aria-label="Spread of domains by band">
                <Chip tone="crit">{`${data.counts.Critical} Critical`}</Chip>
                <Chip tone="high">{`${data.counts.High} High`}</Chip>
                <Chip tone="med">{`${data.counts.Medium} Medium`}</Chip>
                <Chip tone="low">{`${data.counts.Low} Low`}</Chip>
              </div>
            </div>
          </div>
          {data.floorNote && (
            <div className="why">
              <b>Floor rule applied.</b> {data.floorNote.replace(/^Floor rule applied\.\s*/, "")}
            </div>
          )}
          <div className="rule" />
          <dl className="kv">
            {data.confidencePct != null && (
              <>
                <dt>Confidence</dt>
                <dd>
                  {data.confidencePct}% · {data.confidenceLabel}
                </dd>
              </>
            )}
            <dt>Policy version</dt>
            <dd>{data.policyVersion}</dd>
            <dt>Domains outside board appetite</dt>
            <dd>
              {data.outsideAppetite} of {data.domainCount}
            </dd>
            {data.expiringAcceptances != null && (
              <>
                <dt>Accepted risks expiring in 30 days</dt>
                <dd>
                  {data.expiringAcceptances} of {data.acceptanceCount}
                </dd>
              </>
            )}
          </dl>
        </article>
        {data.loss && (
          <article className="card">
            <p className="lbl">Annualised loss exposure (modelled)</p>
            <div className="big loss-figure">
              AED <CountUp value={data.loss.ale} decimals={1} />M <span>expected per year</span>
            </div>
            <RangeBar ale={data.loss.ale} p90={data.loss.p90} max={data.loss.p95} />
            <p className="note">{data.loss.note}</p>
            <div className="rule" />
            <p className="lbl">Drivers</p>
            <ul className="drivers">
              {data.loss.drivers.map((driver) => (
                <li key={driver.name}>
                  <span>{driver.name}</span>
                  <span className="mono">{fmt2(driver.ale)}M</span>
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>

      <article className="card chart-card">
        <h3>Six-month arithmetic score</h3>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.trend} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="month" stroke="var(--muted)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis
                stroke="var(--muted)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={32}
                domain={["dataMin - 2", "dataMax + 2"]}
              />
              <Tooltip
                contentStyle={chartTooltip}
                formatter={(value) => [
                  typeof value === "number" ? value.toFixed(1) : String(value ?? ""),
                  "Score",
                ]}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke="var(--accent)"
                fill="url(#scoreFill)"
                strokeWidth={2.4}
                activeDot={{ r: 5, fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </article>

      <section className="card">
        <h3>Where to look first</h3>
        <Heatmap
          rows={data.lookFirst.map((row) => ({
            id: row.id,
            name: row.name,
            score: row.score,
            band: row.band,
            appetiteState: row.appetiteState,
          }))}
          onOpen={onOpen}
        />
      </section>

      <ComplianceCard data={data} compliance={compliance} />
    </div>
  );
}

function ComplianceCard({
  data,
  compliance,
}: {
  data: HeadlineView;
  compliance: CommandWorkspace["complianceLive"];
}) {
  const frameworks = compliance?.frameworks ?? [];
  const donut = frameworks
    .filter((row) => row.coveragePct != null)
    .map((row, index) => ({
      name: row.name,
      value: row.coveragePct ?? 0,
      fill: ["var(--accent)", "var(--accent-2)", "var(--low)", "var(--med)", "var(--high)"][index % 5],
    }));
  const avg = compliance?.posturePct ?? (donut.length ? donut.reduce((s, r) => s + r.value, 0) / donut.length : 0);

  return (
    <section className="card">
      <h3>Compliance summary</h3>
      {frameworks.length > 0 ? (
        <div className="compliance-grid">
          <div className="donut-wrap" aria-hidden={donut.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donut.length ? donut : [{ name: "n/a", value: 1, fill: "var(--surface-2)" }]}
                  dataKey="value"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={3}
                  stroke="none"
                >
                  {(donut.length ? donut : [{ fill: "var(--surface-2)" }]).map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltip} formatter={(v) => [`${Number(v).toFixed(0)}%`, "Coverage"]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <b>
                <CountUp value={avg} decimals={0} />%
              </b>
              <span>avg coverage</span>
            </div>
          </div>
          <ul className="frameworks">
            {frameworks.map((row) => (
              <li key={row.name}>
                <span>{row.name}</span>
                <span className="bar">
                  <i style={{ width: `${Math.min(100, row.coveragePct ?? 0)}%` }} />
                </span>
                <span className="mono">
                  {row.coveragePct == null ? "—" : `${row.coveragePct.toFixed(0)}%`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : data.complianceDomain ? (
        <p>
          Framework rollup is not connected. Continuous Compliance is {data.complianceDomain.band.toLowerCase()} at{" "}
          <b>{fmt1(data.complianceDomain.score)}</b> and {data.complianceDomain.appetiteState.toLowerCase()}.
        </p>
      ) : (
        <p className="note">Compliance summary is not available for this role.</p>
      )}
    </section>
  );
}

export function PostureView({
  data,
  onOpen,
}: {
  data: PostureView;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="view-ciso">
      <Answer question={data.question} title={data.title} lede={data.lede} />
      <section className="card">
        <h3>Domain posture heatmap</h3>
        <Heatmap
          rows={data.rows.map((row) => ({
            id: row.id,
            name: row.name,
            score: row.adjusted,
            band: row.band,
            appetiteState: row.appetiteState,
          }))}
          onOpen={onOpen}
        />
      </section>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th>CSF 2.0</th>
              <th>Adjusted score</th>
              {data.technical && <th className="num">Raw</th>}
              {data.technical && <th className="num">Coverage</th>}
              {data.technical && <th>Confidence</th>}
              <th>Appetite</th>
              <th>6-month trend</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr
                key={row.id}
                className="click"
                tabIndex={0}
                onClick={() => onOpen(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(row.id);
                  }
                }}
              >
                <td>
                  <b>{row.name}</b>
                </td>
                <td className="muted">{row.csf}</td>
                <td>
                  <div className="score-cell">
                    <ScoreBar
                      score={row.adjusted}
                      appetite={row.appetite}
                      band={row.band}
                      hatch={row.lowConfidence}
                    />
                    <b className="mono">{fmt1(row.adjusted)}</b>
                  </div>
                  <div className="chip-gap">
                    <Chip tone={bandTone(row.band)}>{row.band}</Chip>
                  </div>
                </td>
                {data.technical && <td className="num">{row.raw}</td>}
                {data.technical && <td className="num">{row.coveragePct}%</td>}
                {data.technical && (
                  <td>
                    {row.confidenceLabel}{" "}
                    <span className="muted mono">{row.confidencePct}%</span>
                  </td>
                )}
                <td>
                  <Chip tone={row.appetiteTone}>{row.appetiteState}</Chip>
                  <div className="note mono">limit {row.appetite}</div>
                </td>
                <td>
                  <Spark values={row.trend} tone={row.trendDirection} label={`${row.name} six month trend`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span>
          <i className="sw k-crit" />
          Critical 70+
        </span>
        <span>
          <i className="sw k-high" />
          High 55 to 69
        </span>
        <span>
          <i className="sw k-med" />
          Medium 35 to 54
        </span>
        <span>
          <i className="sw k-low" />
          Low under 35
        </span>
        {data.technical && (
          <span>
            <i className="sw hatch-key" />
            Hatched: confidence under 80%
          </span>
        )}
        <span>Trend colour: red up, green down, grey flat</span>
      </div>
    </div>
  );
}

export function TrustView({ data }: { data: TrustView }) {
  return (
    <div>
      <Answer question={data.question} title={data.title} lede={data.lede} />
      <div className="kpi-row">
        <KpiCard label="Feeds fresh" value={data.fresh} suffix={` / ${data.total}`} tone="info" />
        <KpiCard label="Weighted coverage" value={data.weightedCoveragePct} suffix="%" tone="low" />
        <KpiCard
          label="Confidence"
          value={data.confidencePct}
          suffix="%"
          tone={data.confidencePct >= 80 ? "low" : data.confidencePct >= 60 ? "med" : "crit"}
          note={data.confidenceLabel}
        />
        <article className="card kpi">
          <p className="lbl">Double-counting check</p>
          <p className="big tone-low">{data.doubleCount}</p>
          <p className="note">No signal carries weight in two domains.</p>
        </article>
      </div>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Domain</th>
              <th className="num">Fresh / total</th>
              <th className="num">Coverage</th>
              <th>Confidence</th>
              <th>Reading</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <b>{row.name}</b>
                </td>
                <td className="num">
                  {row.fresh} / {row.total}
                </td>
                <td className="num">{row.coveragePct}%</td>
                <td>
                  <Chip tone={row.tone}>{`${row.confidenceLabel} ${row.confidencePct}%`}</Chip>
                </td>
                <td className="muted">{row.reading}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{data.note}</p>
    </div>
  );
}

export function QueueView({
  data,
  acceptFor,
  onAcceptFor,
  onApprove,
  onDefer,
  onReopen,
  onAccept,
  onEvidence,
}: {
  data: QueueView;
  acceptFor: string | null;
  onAcceptFor: (id: string | null) => void;
  onApprove: (id: string) => void;
  onDefer: (id: string) => void;
  onReopen: (id: string) => void;
  onAccept: (id: string, body: { reason: string; approver: string; days: number }) => void;
  onEvidence: (id: string) => void;
}) {
  const open = data.items.filter((item) => item.state === "open").length;
  const totalLoss = data.items.reduce((sum, item) => sum + (item.loss?.ale ?? 0), 0);

  return (
    <div className="view-cxo">
      <Answer question={data.question} title={data.title} lede={data.lede} />
      <div className="kpi-row">
        <KpiCard label="Open decisions" value={open} tone={open > 0 ? "high" : "low"} note={`${data.items.length} in queue`} />
        <KpiCard
          label="Modelled exposure"
          value={totalLoss}
          decimals={1}
          prefix="AED "
          suffix="M"
          tone="crit"
          note="Sum of linked scenarios"
        />
        <article className="card kpi">
          <p className="lbl">Authority</p>
          <p className="big">{data.canAct || data.canAccept ? "Act" : "View"}</p>
          <p className="note">
            {data.canAct && data.canAccept
              ? "Approve and accept risk"
              : data.canAct
                ? "Approvals enabled for this role"
                : data.canAccept
                  ? "Accept risk enabled (Decide stays with CxO/CISO)"
                  : "Read-only for this persona"}
          </p>
        </article>
      </div>
      {data.items.length === 0 && (
        <div className="empty-state card">
          <h3>Queue clear</h3>
          <p className="note">No open decisions for this persona. Switch role or reopen a deferred item from Closure.</p>
        </div>
      )}
      {data.items.map((item, index) => {
        const done = item.state !== "open";
        return (
          <motion.article
            key={item.id}
            className={`item${done ? " done" : ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04, duration: 0.28 }}
          >
            <div>
              <p className="lbl">{item.domainName}</p>
              <h3>{item.title}</h3>
              <div className="meta">
                <Chip tone={item.priorityTone}>{`Priority ${fmt1(item.priority)} / 10`}</Chip>
                {item.kev && <Chip tone="crit">On CISA KEV</Chip>}
                {item.epss && <Chip tone="high">{`EPSS ${item.epss}`}</Chip>}
                <Chip tone="mute">{`Owner: ${item.owner}`}</Chip>
                <Chip tone="mute">{`SLA ${item.sla}`}</Chip>
                {item.stateLabel && (
                  <Chip
                    tone={
                      item.state === "approved" ? "info" : item.state === "accepted" ? "med" : "mute"
                    }
                  >
                    {item.stateLabel}
                  </Chip>
                )}
              </div>
              <p className="note">
                {item.asset}
                {item.loss
                  ? ` · scenario: ${item.loss.name}, expected AED ${fmt2(item.loss.ale)}M a year, bad year AED ${fmt2(item.loss.p90)}M`
                  : ""}
              </p>
              <p className="rec">
                <b>Recommended:</b> {item.recommendation}
              </p>
              {acceptFor === item.id && (
                <AcceptForm onCancel={() => onAcceptFor(null)} onSubmit={(body) => onAccept(item.id, body)} />
              )}
            </div>
            <div className="acts">
              {done ? (
                <button className="btn sm" type="button" disabled={!data.canAct} onClick={() => onReopen(item.id)}>
                  Reopen
                </button>
              ) : (
                <>
                  <button
                    className="btn primary sm"
                    type="button"
                    disabled={!data.canAct}
                    onClick={() => onApprove(item.id)}
                  >
                    Approve
                  </button>
                  <button
                    className="btn sm"
                    type="button"
                    disabled={!(data.canAccept ?? data.canAct)}
                    onClick={() => onAcceptFor(item.id)}
                  >
                    Accept risk
                  </button>
                  <button className="btn sm" type="button" disabled={!data.canAct} onClick={() => onDefer(item.id)}>
                    Defer
                  </button>
                </>
              )}
              <button className="btn sm" type="button" onClick={() => onEvidence(item.domainId)}>
                Evidence
              </button>
            </div>
          </motion.article>
        );
      })}
      {data.log.length > 0 && (
        <section className="card">
          <h3>Decision log (this session)</h3>
          {data.log.map((line) => (
            <p key={line} className="note log-line">
              {line}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}

function AcceptForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (body: { reason: string; approver: string; days: number }) => void;
}) {
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("CFO");
  const [days, setDays] = useState(90);
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ reason, approver, days });
      }}
    >
      <label>
        Reason (required)
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why accept rather than fix?"
          required
        />
      </label>
      <label>
        Approver
        <select value={approver} onChange={(event) => setApprover(event.target.value)}>
          <option>CFO</option>
          <option>COO</option>
          <option>CEO</option>
          <option>Risk Lead</option>
        </select>
      </label>
      <label>
        Expires in
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={30}>30 days</option>
          <option value={90}>90 days (default)</option>
          <option value={180}>180 days</option>
          <option value={365}>365 days (non-Critical max)</option>
        </select>
      </label>
      <div className="acts">
        <button className="btn primary sm" type="submit">
          Record acceptance
        </button>
        <button className="btn sm" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="note">Expiry is required. On expiry the finding reopens and appears on the board agenda.</p>
    </form>
  );
}

export function WhatIfView({
  data,
  onChange,
  onSave,
  onConvert,
}: {
  data: WhatIfView;
  onChange: (body: Record<string, unknown>) => void;
  onSave: () => void;
  onConvert: (index: number) => void;
}) {
  const [gaps, setGaps] = useState(data.gaps);
  const [cost, setCost] = useState(data.cost);
  const timer = useRef<number | null>(null);
  useEffect(() => setGaps(data.gaps), [data.gaps]);
  useEffect(() => setCost(data.cost), [data.cost]);

  return (
    <div className="view-cxo">
      <Answer question={data.question} title={data.title} lede={data.lede} />
      <div className="grid g2">
        <section className="card">
          <h3>Control gaps</h3>
          <div className="presets" role="group" aria-label="Scenarios">
            <button className="btn sm" type="button" aria-pressed={!data.changed} onClick={() => onChange({ preset: "now" })}>
              Today
            </button>
            <button
              className="btn sm"
              type="button"
              aria-pressed={data.preset === "A"}
              onClick={() => onChange({ preset: "A" })}
            >
              A. Immutable backup
            </button>
            <button
              className="btn sm"
              type="button"
              aria-pressed={data.preset === "B"}
              onClick={() => onChange({ preset: "B" })}
            >
              B. Recovery testing
            </button>
            <button
              className="btn sm"
              type="button"
              aria-pressed={data.preset === "C"}
              onClick={() => onChange({ preset: "C" })}
            >
              C. Both
            </button>
          </div>
          {data.weights.map((row) => (
            <div className="sl" key={row.key}>
              <label htmlFor={`wi-${row.key}`}>
                <span>
                  {row.name}
                  <span className="w">weight {row.weight}</span>
                </span>
                <b>{gaps[row.key]}% gap</b>
              </label>
              <input
                id={`wi-${row.key}`}
                type="range"
                min={0}
                max={100}
                value={gaps[row.key]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  const next = { ...gaps, [row.key]: value };
                  setGaps(next);
                  if (timer.current) window.clearTimeout(timer.current);
                  timer.current = window.setTimeout(() => onChange(next), 160);
                }}
              />
            </div>
          ))}
          <div className="sl">
            <label htmlFor="wi-cost">Estimated cost (AED millions, optional)</label>
            <input
              id="wi-cost"
              className="text-input mono"
              type="number"
              min={0}
              step={0.1}
              placeholder="e.g. 0.4"
              value={cost}
              onChange={(event) => {
                setCost(event.target.value);
                onChange({ cost: event.target.value });
              }}
            />
          </div>
        </section>
        <section className="card">
          <h3>Before and after</h3>
          <div className="cmp">
            <span className="h">Measure</span>
            <span className="h num">Now</span>
            <span className="h num">After</span>
            {data.rows.map((row) => (
              <span key={row.label} className="cmp-row">
                <span>{row.label}</span>
                <span className="n">{row.now}</span>
                <span className={`n${row.improved ? " d" : ""}`}>{row.after}</span>
              </span>
            ))}
          </div>
          {data.roi && (
            <div className="why good">
              <b>{data.roi}</b>
            </div>
          )}
          {data.floorNote && <p className="note">{data.floorNote}</p>}
          <div className="acts">
            <button className="btn primary sm" type="button" disabled={!data.canSave} onClick={onSave}>
              Save scenario
            </button>
          </div>
          <p className="note">{data.modelNote}</p>
        </section>
      </div>
      {data.saved.length > 0 && (
        <section className="card">
          <h3>Saved scenarios</h3>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th className="num">Score after</th>
                  <th className="num">Loss avoided (AED M)</th>
                  <th className="num">Cost (AED M)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.saved.map((row) => (
                  <tr key={`${row.index}-${row.name}`}>
                    <td>{row.name}</td>
                    <td className="num">{row.score}</td>
                    <td className="num">{row.lossAvoided}</td>
                    <td className="num">{row.cost || "n/a"}</td>
                    <td>
                      <button
                        className="btn sm"
                        type="button"
                        disabled={!data.canSave}
                        onClick={() => onConvert(row.index)}
                      >
                        Convert to decision
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export function ClosureView({
  data,
  onVerify,
  onRenew,
  onRevoke,
}: {
  data: ClosureView;
  onVerify: (id: string) => void;
  onRenew: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <div>
      <Answer question={data.question} title={data.title} lede={data.lede} />
      <div className="grid g2">
        <section className="card">
          <h3>Verified closure</h3>
          {data.fixes.map((fix) => (
            <div className="split" key={fix.id}>
              <div>
                <div>{fix.title}</div>
                <div className="chip-gap">
                  <Chip tone={fix.tone}>{fix.label}</Chip>
                </div>
              </div>
              {fix.state !== "verified_closed" && (
                <button className="btn sm" type="button" disabled={!data.canVerify} onClick={() => onVerify(fix.id)}>
                  Run verification scan
                </button>
              )}
            </div>
          ))}
          <p className="note">
            In this sample the first fix passes its re-scan and the second fails, so you can see both paths. Failed
            checks stay open and count against the owner’s SLA.
          </p>
        </section>
        <section className="card">
          <h3>Risk-acceptance register</h3>
          {data.acceptances.length === 0 && <p className="note">No accepted risks.</p>}
          {data.acceptances.map((item) => (
            <div className="split block" key={item.id}>
              <div className="split-head">
                <b>{item.title}</b>
                <Chip tone={item.tone}>{item.label}</Chip>
              </div>
              <p className="note">{item.reason}</p>
              <p className="note mono">
                Approver {item.approver} · expires {item.expires}
              </p>
              <div className="acts">
                <button className="btn sm" type="button" disabled={!data.canRegister} onClick={() => onRenew(item.id)}>
                  Renew 90 days
                </button>
                <button className="btn sm" type="button" disabled={!data.canRegister} onClick={() => onRevoke(item.id)}>
                  Revoke and reopen
                </button>
              </div>
            </div>
          ))}
          <p className="note">Accepted risks still count in the score. Use the decision queue to add one.</p>
        </section>
      </div>
    </div>
  );
}

export function ChangedView({ data }: { data: ChangedView }) {
  return (
    <div>
      <Answer question={data.question} title={data.title} lede={data.lede} />
      <div className="grid g2">
        <section className="card">
          <h3>Biggest movers</h3>
          <div className="diff">
            {data.movers.map((row) => (
              <div className="row" key={row.name}>
                <span>{row.name}</span>
                <span className="mono muted">{fmt1(row.from)}</span>
                <span className="mono">→ {fmt1(row.to)}</span>
                <span className={`mono arrow-${row.direction}`}>
                  {row.direction === "up" ? "▲" : row.direction === "down" ? "▼" : "▬"}{" "}
                  {row.delta > 0 ? "+" : ""}
                  {fmt1(row.delta)}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <h3>Also changed</h3>
          <dl className="kv">
            {data.also.map((row) => (
              <span key={row.label} className="kv-pair">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </span>
            ))}
          </dl>
          <p className="note">{data.note}</p>
        </section>
      </div>
    </div>
  );
}

export function PackView({
  data,
  onPrint,
  onReview,
}: {
  data: PackView;
  onPrint: () => void;
  onReview: () => void;
}) {
  return (
    <div className="view-board">
      <Answer question={data.question} title={data.title} lede={data.lede} />
      <div className="acts noprint">
        <button className="btn primary sm" type="button" onClick={onPrint}>
          Export to PDF / print
        </button>
        <button className="btn sm" type="button" disabled={!data.canReview} onClick={onReview}>
          {data.reviewedBy ? `Reviewed · ${data.reviewedBy}` : "Mark reviewed"}
        </button>
      </div>
      <article className="pack">
        <p className="meta">{data.meta}</p>
        <h2>{data.heading}</h2>
        {data.blocks.map((block) => (
          <section key={block.heading}>
            <h4>{block.heading}</h4>
            {block.text && <p>{block.text}</p>}
            {block.items && block.items.length > 0 && (
              <ul>
                {block.items.map((item) => (
                  <li key={`${block.heading}-${item.text}`}>
                    {item.text}
                    <span className="src">[{item.source}]</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>
    </div>
  );
}

export function EvidenceDrawer({
  evidence,
  onClose,
}: {
  evidence: EvidenceView;
  onClose: () => void;
}) {
  const pairs: [string, string][] = [];
  if (evidence.raw != null) pairs.push(["Raw score", String(evidence.raw)]);
  if (evidence.coveragePct != null) pairs.push(["Coverage", `${evidence.coveragePct}%`]);
  if (evidence.unobserved != null) pairs.push(["Unobserved assets assumed at", String(evidence.unobserved)]);
  pairs.push(["Adjusted score", fmt1(evidence.adjusted)]);
  if (evidence.weight != null) pairs.push(["Business weight", String(evidence.weight)]);
  if (evidence.contribution != null) pairs.push(["Contribution to composite", `${fmt1(evidence.contribution)} pts`]);
  if (evidence.confidencePct != null) pairs.push(["Confidence", `${evidence.confidencePct}%`]);
  if (evidence.fresh != null && evidence.total != null)
    pairs.push(["Feeds fresh", `${evidence.fresh} of ${evidence.total}`]);
  pairs.push(["Appetite limit", String(evidence.appetite)]);
  return (
    <aside className="drawer open" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
      <button className="btn sm drawer-x" type="button" onClick={onClose}>
        Close
      </button>
      <p className="lbl">Evidence</p>
      <h2 id="evidence-title">{evidence.name}</h2>
      <div className="spread">
        <Chip tone={bandTone(evidence.band)}>{evidence.band}</Chip>
        <Chip
          tone={
            evidence.appetiteState === "Outside appetite"
              ? "crit"
              : evidence.appetiteState === "Approaching"
                ? "med"
                : "low"
          }
        >
          {evidence.appetiteState}
        </Chip>
      </div>
      <p className="note">{evidence.csf}</p>
      <dl className="kv">
        {pairs.map(([label, value]) => (
          <span className="kv-pair" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </span>
        ))}
      </dl>
      {evidence.loss && (
        <p className="note">
          Scenario {evidence.loss.name}: expected AED {fmt2(evidence.loss.ale)}M a year, bad year AED{" "}
          {fmt2(evidence.loss.p90)}M.
        </p>
      )}
      <div className="rule" />
      <p className="lbl">
        Trend, {evidence.months[0]} to {evidence.months[evidence.months.length - 1]} (raw)
      </p>
      <Spark
        values={evidence.trend}
        tone={
          evidence.trend[evidence.trend.length - 1]! > evidence.trend[0]!
            ? "up"
            : evidence.trend[evidence.trend.length - 1]! < evidence.trend[0]!
              ? "down"
              : "flat"
        }
      />
      {evidence.scoreBuild && (
        <>
          <div className="rule" />
          <p className="lbl">Score build (from the deck)</p>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="num">Weight</th>
                <th className="num">Gap</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {evidence.scoreBuild.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td className="num">{row.weight}</td>
                  <td className="num">{row.gap}%</td>
                  <td className="num">{fmt1(row.points)}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Domain score</b>
                </td>
                <td className="num">100</td>
                <td />
                <td className="num">
                  <b>{fmt1(evidence.scoreBuildTotal ?? 0)}</b>
                </td>
              </tr>
            </tbody>
          </table>
          {evidence.scoreBuildNote && <p className="note">{evidence.scoreBuildNote}</p>}
        </>
      )}
      {evidence.productionNote && <p className="note">{evidence.productionNote}</p>}
    </aside>
  );
}
