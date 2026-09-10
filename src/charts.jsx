// ============================================================================
// charts.jsx — chart components.
//
// Rules applied throughout: one y-axis per plot (never dual), hairline
// recessive grid, thin marks, a hover tooltip on every plot, a legend whenever
// two or more series share a plot, and a 2px surface gap between stacked
// segments so fills separate without a border.
// ============================================================================

import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell, ReferenceLine,
} from "recharts";
import { useTheme } from "./theme";

const GAP = 2; // surface gap between stacked segments

/* ─── Shared tooltip ──────────────────────────────────────────────────── */
export function ChartTip({ active, payload, label, totalKey }) {
  if (!active || !payload?.length) return null;
  const shown = payload.filter(p => p.value != null && p.dataKey !== totalKey);
  return (
    <div className="tooltip">
      <div className="tooltip__label">{label}</div>
      {shown.map((p, i) => (
        <div className="tooltip__row" key={i}>
          <span className="tooltip__dot" style={{ background: p.color || p.fill }} />
          <span className="tooltip__name">{p.name}</span>
          <span className="tooltip__val">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function axisProps(t) {
  return {
    tick: { fontSize: 12, fill: t.text3 },
    tickLine: false,
    axisLine: { stroke: t.axis },
  };
}
const legendStyle = { fontSize: 12.5, paddingTop: 8 };

/* ─── Volume trend (single series → no legend; the title names it) ────── */
export function VolumeTrend({ data, height = 220 }) {
  const t = useTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={44} {...axisProps(t)} />
        <YAxis width={44} allowDecimals={false} {...axisProps(t)} />
        <Tooltip content={<ChartTip />} cursor={{ stroke: t.axis, strokeWidth: 1 }} />
        <Area type="monotone" isAnimationActive={false} dataKey="total" name="Tickets"
          stroke={t.series[0]} strokeWidth={2} fill={t.series[0]} fillOpacity={0.13}
          dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: t.surface }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── Resolution over time (stacked parts of the total) ───────────────── */
export function ResolutionBars({ data, xKey = "month", height = 240 }) {
  const t = useTheme();
  const series = [
    ["resolved", "Resolved", t.chartOk],
    ["inProgress", "In progress", t.chartProg],
    ["pending", "Pending", t.chartWait],
  ];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey={xKey} {...axisProps(t)} />
        <YAxis width={44} allowDecimals={false} {...axisProps(t)} />
        <Tooltip content={<ChartTip />} cursor={{ fill: t.grid, fillOpacity: 0.5 }} />
        <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
        {series.map(([key, name, color], i) => (
          <Bar key={key} isAnimationActive={false} dataKey={key} name={name} stackId="a" fill={color}
            stroke={t.surface} strokeWidth={GAP}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={54} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Daily bars, severity-coded against the window's own average ─────── */
export function DailyBars({ data, height = 230, avg }) {
  const t = useTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={36} {...axisProps(t)} />
        <YAxis width={44} allowDecimals={false} {...axisProps(t)} />
        <Tooltip content={<ChartTip />} cursor={{ fill: t.grid, fillOpacity: 0.5 }} />
        {avg > 0 && (
          <ReferenceLine y={avg} stroke={t.text3} strokeOpacity={0.5}
            label={{ value: `avg ${Math.round(avg)}`, position: "insideTopRight", fill: t.text3, fontSize: 11.5 }} />
        )}
        <Bar dataKey="total" isAnimationActive={false} name="Tickets" radius={[4, 4, 0, 0]} maxBarSize={26}>
          {data.map((d, i) => (
            <Cell key={i} fill={avg > 0 && d.total > avg * 1.8 ? t.critical : t.series[0]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Grouped bars by agent (identity colors, fixed per agent) ─────────── */
export function AgentBars({ data, agents, colorFor, height = 250 }) {
  const t = useTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} vertical={false} />
        <XAxis dataKey="month" {...axisProps(t)} />
        <YAxis width={44} allowDecimals={false} {...axisProps(t)} />
        <Tooltip content={<ChartTip />} cursor={{ fill: t.grid, fillOpacity: 0.5 }} />
        <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
        {agents.map(a => (
          <Bar key={a} isAnimationActive={false} dataKey={a} name={a} fill={colorFor(a)} radius={[3, 3, 0, 0]} maxBarSize={26} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── L1 / L3 split per agent, horizontal ─────────────────────────────── */
export function LevelSplitBars({ data, height = 200 }) {
  const t = useTheme();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 0 }}>
        <CartesianGrid stroke={t.grid} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps(t)} />
        <YAxis type="category" dataKey="name" width={86} {...axisProps(t)} />
        <Tooltip content={<ChartTip />} cursor={{ fill: t.grid, fillOpacity: 0.5 }} />
        <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
        <Bar dataKey="l1" isAnimationActive={false} name="L1 · self-served" stackId="a" fill={t.series[0]}
          stroke={t.surface} strokeWidth={GAP} maxBarSize={20} />
        <Bar dataKey="l3" isAnimationActive={false} name="L3 · escalated" stackId="a" fill={t.series[1]}
          stroke={t.surface} strokeWidth={GAP} radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Split bar: a proportion, without resorting to a two-slice pie ───── */
export function SplitBar({ parts, height = 12 }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div style={{ display: "flex", gap: GAP, height, borderRadius: 99, overflow: "hidden" }}>
      {parts.filter(p => p.value > 0).map((p, i) => (
        <div key={i} title={`${p.name}: ${p.value}`}
          style={{ flex: p.value / total, background: p.color, minWidth: 3 }} />
      ))}
    </div>
  );
}

export function SplitLegend({ parts, total }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
      {parts.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
          <span className="chip__dot" style={{ background: p.color, width: 8, height: 8 }} />
          <span style={{ color: "var(--text2)", flex: 1 }}>{p.name}</span>
          <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{p.value}</span>
          {total > 0 && (
            <span style={{ color: "var(--text3)", fontSize: 12, width: 46, textAlign: "right",
                           fontVariantNumeric: "tabular-nums" }}>
              {((p.value / total) * 100).toFixed(1)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
