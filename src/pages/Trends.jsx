import { useState, useMemo } from "react";
import { Card, Stat, Empty } from "../components";
import { DailyBars, ResolutionBars, AgentBars } from "../charts";
import { useTheme } from "../theme";
import { fmtDate, fmtMonth, pct } from "../data";

/** Weeks are cut on the ISO week boundary of the actual dates in range. */
function toWeeks(daily) {
  const weeks = [];
  let cur = null;
  for (const day of daily) {
    const dt = new Date(day.date + "T12:00:00");
    const dow = (dt.getDay() + 6) % 7; // Monday = 0
    if (!cur || dow === 0) {
      cur = { start: day.date, end: day.date, total: 0, resolved: 0, pending: 0, inProgress: 0 };
      weeks.push(cur);
    }
    cur.end = day.date;
    cur.total += day.total; cur.resolved += day.resolved;
    cur.pending += day.pending; cur.inProgress += day.inProgress;
  }
  return weeks.map((w, i) => ({
    ...w, week: `W${i + 1}`,
    label: `${fmtDate(w.start).replace(/ \d{4}$/, "")} – ${fmtDate(w.end).replace(/ \d{4}$/, "")}`,
    rate: pct(w.resolved, w.total),
  }));
}

export default function Trends({ d, colorForAgent }) {
  const t = useTheme();
  const [tab, setTab] = useState("monthly");

  const weeks = useMemo(() => toWeeks(d.daily), [d.daily]);
  const avg = d.daily.length ? d.daily.reduce((a, x) => a + x.total, 0) / d.daily.length : 0;

  const agentNames = d.agents.map(a => a.name);
  const agentByMonth = useMemo(() => d.monthly.map(m => {
    const row = { month: m.month };
    d.agents.forEach(a => { row[a.name] = a.months[m.key] || 0; });
    return row;
  }), [d.monthly, d.agents]);

  const best = d.monthly.reduce((a, m) => (m.total > (a?.total ?? -1) ? m : a), null);

  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="Time grain">
        {[["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k}
            className={`segmented__btn ${tab === k ? "segmented__btn--active" : ""}`}
            onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {!d.summary.total && <Empty icon="—" title="No tickets in this range" body="Widen the date range to see trends." />}

      {tab === "daily" && d.summary.total > 0 && (
        <div className="stack">
          <div className="grid grid--4">
            <Stat label="Days in range" value={d.daily.length} accent={t.series[0]} small />
            <Stat label="Daily average" value={avg.toFixed(1)} accent={t.series[2]} small />
            <Stat label="Busiest day" small accent={t.series[1]}
              value={Math.max(0, ...d.daily.map(x => x.total))}
              sub={d.daily.reduce((a, x) => (x.total > (a?.total ?? -1) ? x : a), null)?.label} />
            <Stat label="Quiet days" small accent={t.text3}
              value={d.daily.filter(x => x.total === 0).length} sub="no tickets opened" />
          </div>
          <Card title="Daily volume" sub="Bars above 1.8× the range average are flagged">
            <DailyBars data={d.daily} avg={avg} height={260} />
          </Card>
        </div>
      )}

      {tab === "weekly" && d.summary.total > 0 && (
        <div className="stack">
          <Card title="Weekly resolution" sub="Each bar is the week's total, split by status">
            <ResolutionBars data={weeks} xKey="week" height={250} />
          </Card>
          <Card title="Week by week" flush>
            <div className="tablewrap" style={{ maxHeight: 420 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Week</th><th>Dates</th><th className="num">Total</th>
                    <th className="num">Resolved</th><th className="num">Pending</th>
                    <th className="num">In progress</th><th className="num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map(w => (
                    <tr key={w.start}>
                      <td className="cell--strong">{w.week}</td>
                      <td>{w.label}</td>
                      <td className="num cell--strong">{w.total}</td>
                      <td className="num" style={{ color: "var(--goodText)" }}>{w.resolved}</td>
                      <td className="num" style={{ color: w.pending ? "var(--warningText)" : "var(--text3)" }}>{w.pending || "—"}</td>
                      <td className="num">{w.inProgress || "—"}</td>
                      <td className="num cell--strong">{w.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "monthly" && d.summary.total > 0 && (
        <div className="stack">
          <div className="grid grid--4">
            {d.monthly.map(m => (
              <Stat key={m.key} label={m.monthLong} value={m.total} small
                accent={m.key === best?.key ? t.series[1] : t.series[0]}
                sub={`${m.rate}% resolved · ${m.pending + m.inProgress} open`} />
            ))}
          </div>
          <Card title="Resolution by month" sub="Each bar is the month's total, split by status">
            <ResolutionBars data={d.monthly} xKey="month" height={260} />
          </Card>
          <Card title="Agent output by month" sub="Colors stay fixed per agent across every view">
            {agentNames.length
              ? <AgentBars data={agentByMonth} agents={agentNames} colorFor={colorForAgent} height={270} />
              : <Empty icon="—" title="No agent activity in this range" />}
          </Card>
          <Card title="Monthly detail" flush>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th><th className="num">Total</th><th className="num">Resolved</th>
                    <th className="num">Pending</th><th className="num">In progress</th><th className="num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {d.monthly.map(m => (
                    <tr key={m.key}>
                      <td className="cell--strong">{fmtMonth(m.key, true)}</td>
                      <td className="num cell--strong">{m.total}</td>
                      <td className="num" style={{ color: "var(--goodText)" }}>{m.resolved}</td>
                      <td className="num" style={{ color: m.pending ? "var(--warningText)" : "var(--text3)" }}>{m.pending || "—"}</td>
                      <td className="num">{m.inProgress || "—"}</td>
                      <td className="num cell--strong">{m.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
