import { Card, Stat, RankRow, PageHead, TicketTable, Empty } from "../components";
import { AgentBars, LevelSplitBars, SplitBar, SplitLegend, VolumeTrend } from "../charts";
import { useTheme } from "../theme";
import { pct, fmtMonth } from "../data";

export function AgentsPage({ d, colorForAgent, onSelect }) {
  if (!d.agents.length) return <Empty icon="—" title="No agent activity in this range" />;

  const agentNames = d.agents.map(a => a.name);
  const byMonth = d.monthly.map(m => {
    const row = { month: m.month };
    d.agents.forEach(a => { row[a.name] = a.months[m.key] || 0; });
    return row;
  });
  const max = d.agents[0]?.total || 1;

  return (
    <div className="stack">
      <div className="grid grid--cards">
        {d.agents.map(a => {
          const color = colorForAgent(a.name);
          return (
            <button key={a.name} className="stat" onClick={() => onSelect(a.name)} type="button"
              style={{ gap: 10, alignItems: "stretch" }}>
              <span className="stat__rail" style={{ background: color }} />
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  width: 34, height: 34, borderRadius: 99, background: color, color: "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700, flexShrink: 0,
                }}>{a.name[0]}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 650 }}>{a.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text3)" }}>
                    {a.rate}% resolved
                  </span>
                </span>
                <span style={{ marginLeft: "auto", fontSize: 24, fontWeight: 680, letterSpacing: "-.02em" }}>
                  {a.total}
                </span>
              </span>
              <span style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--text2)" }}>
                <span>L1 <strong style={{ color: "var(--text)" }}>{a.l1}</strong></span>
                <span>L3 <strong style={{ color: "var(--text)" }}>{a.l3}</strong></span>
                {a.pending + a.inProgress > 0 && (
                  <span style={{ color: "var(--criticalText)" }}>{a.pending + a.inProgress} open</span>
                )}
              </span>
              <span className="meter" style={{ height: 6 }}>
                <span className="meter__fill" style={{ width: `${(a.total / max) * 100}%`, background: color }} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid--2">
        <Card title="Output by month" sub="Colors stay fixed per agent across every view">
          <AgentBars data={byMonth} agents={agentNames} colorFor={colorForAgent} height={260} />
        </Card>
        <Card title="L1 vs L3 split" sub="How much each agent resolves without escalating">
          <LevelSplitBars data={d.agents} height={Math.max(180, d.agents.length * 36 + 50)} />
        </Card>
      </div>

      <Card title="Agent detail" flush>
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th><th className="num">Total</th><th className="num">L1</th><th className="num">L3</th>
                <th className="num">Resolved</th><th className="num">Open</th><th className="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {d.agents.map(a => (
                <tr key={a.name} style={{ cursor: "pointer" }} onClick={() => onSelect(a.name)}>
                  <td className="cell--strong">
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span className="chip__dot" style={{ background: colorForAgent(a.name), width: 8, height: 8 }} />
                      {a.name}
                    </span>
                  </td>
                  <td className="num cell--strong">{a.total}</td>
                  <td className="num">{a.l1}</td>
                  <td className="num">{a.l3}</td>
                  <td className="num" style={{ color: "var(--goodText)" }}>{a.resolved}</td>
                  <td className="num" style={{ color: a.pending + a.inProgress ? "var(--criticalText)" : "var(--text3)" }}>
                    {a.pending + a.inProgress || "—"}
                  </td>
                  <td className="num">{a.rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export function AgentDetail({ name, d, colorForAgent, colorForCategory, onBack }) {
  const t = useTheme();
  const a = d.agents.find(x => x.name === name);
  if (!a) return <Empty icon="—" title={`${name} has no tickets in this range`} body="Widen the date range." />;

  const rows = d.rows.filter(r => r.owner === name);
  const color = colorForAgent(name);
  const cats = Object.entries(a.types).sort((x, y) => y[1] - x[1]);
  const parts = [
    { name: "Resolved", value: a.resolved, color: t.chartOk },
    { name: "In progress", value: a.inProgress, color: t.chartProg },
    { name: "Pending", value: a.pending, color: t.chartWait },
  ];
  const daily = d.daily.map(day => ({
    ...day,
    total: rows.filter(r => (r.dt || "").slice(0, 10) === day.date).length,
  }));

  return (
    <div className="stack">
      <PageHead onBack={onBack} title={name}
        sub={`${a.total} tickets · ${a.rate}% resolved · ${pct(a.l3, a.total)}% escalated to L3`} />

      <div className="grid grid--4">
        <Stat label="Total" value={a.total} accent={color} small />
        <Stat label="Resolved at L1" value={a.l1} accent={t.good} small sub={`${pct(a.l1, a.total)}% of their tickets`} />
        <Stat label="Escalated to L3" value={a.l3} accent={t.series[1]} small sub={`${pct(a.l3, a.total)}% of their tickets`} />
        <Stat label="Still open" value={a.pending + a.inProgress} small
          accent={a.pending + a.inProgress ? t.critical : t.text3} alert={a.pending + a.inProgress > 3} />
      </div>

      <div className="grid grid--wide grid--top">
        <Card title="Their daily volume" sub="Same range as the rest of the dashboard">
          <VolumeTrend data={daily} height={200} />
        </Card>
        <div className="stack">
          <Card title="Resolution status">
            <SplitBar parts={parts} />
            <SplitLegend parts={parts} total={a.total} />
          </Card>
          <Card title="Monthly output">
            <div className="stack" style={{ gap: 2, marginTop: 4 }}>
              {d.monthly.map(m => (
                <RankRow key={m.key} label={fmtMonth(m.key, true)} color={color}
                  value={a.months[m.key] || 0}
                  max={Math.max(1, ...d.monthly.map(x => a.months[x.key] || 0))} nameWidth={120} dot={false} />
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="What they work on" sub={`${cats.length} categories`}>
        <div className="stack" style={{ gap: 2, marginTop: 4 }}>
          {cats.map(([type, count]) => (
            <RankRow key={type} label={type} color={colorForCategory(type)} value={count}
              max={cats[0][1]} pct={pct(count, a.total)} nameWidth={200} />
          ))}
        </div>
      </Card>

      <Card title={`Ticket history (${rows.length})`} flush>
        <TicketTable rows={rows.slice().reverse()} maxH={460} colorFor={colorForCategory}
          columns={["ticket", "date", "customer", "type", "issue", "status", "level"]} />
      </Card>
    </div>
  );
}
