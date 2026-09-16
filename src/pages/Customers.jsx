import { useState } from "react";
import { Card, Stat, RankRow, PageHead, TicketTable, Empty, RobotId, Tag } from "../components";
import FaultBreakdown from "../FaultBreakdown";
import { SplitBar, SplitLegend, VolumeTrend } from "../charts";
import { useTheme } from "../theme";
import { pct } from "../data";

export function CustomerList({ d, colorForCategory, onSelect }) {
  const t = useTheme();
  const [q, setQ] = useState("");
  const list = d.customers.filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase()));

  if (!d.customers.length) return <Empty icon="—" title="No customers in this range" />;

  return (
    <div className="stack">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input className="input" style={{ width: 280 }} value={q} placeholder="Search customers…"
          onChange={e => setQ(e.target.value)} aria-label="Search customers" />
        <span style={{ fontSize: 13, color: "var(--text3)" }}>
          {list.length} of {d.customers.length} customers
        </span>
      </div>

      <div className="grid grid--cards">
        {list.map(c => {
          const top = Object.entries(c.types).sort((a, b) => b[1] - a[1]).slice(0, 6);
          return (
            <button key={c.name} className="stat" type="button" onClick={() => onSelect(c.name)}
              style={{ gap: 10 }}>
              <span className="stat__rail" style={{ background: c.open > 0 ? t.critical : t.series[0] }} />
              <span style={{ fontSize: 14, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis",
                             whiteSpace: "nowrap" }} title={c.name}>{c.name}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className="chip chip--accent">{c.total} tickets</span>
                {c.robotCount > 0 && <span className="chip">{c.robotCount} robots</span>}
                {c.open > 0 && <span className="chip chip--critical">{c.open} open</span>}
              </span>
              <SplitBar height={6} parts={top.map(([type, n]) => ({
                name: type, value: n, color: colorForCategory(type),
              }))} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CustomerDetail({ name, d, colorForCategory, onRobot, onBack, onDrill }) {
  const t = useTheme();
  const c = d.cmap[name];
  if (!c) return <Empty icon="—" title={`${name} has no tickets in this range`} body="Widen the date range." />;

  const cats = Object.entries(c.types).sort((a, b) => b[1] - a[1]);
  const robots = c.robots.map(id => d.rmap[id]).filter(Boolean).sort((a, b) => b.total - a.total);
  const parts = [
    { name: "Resolved", value: c.resolved, color: t.chartOk },
    { name: "In progress", value: c.inProgress, color: t.chartProg },
    { name: "Pending", value: c.pending, color: t.chartWait },
  ];
  const daily = d.daily.map(day => ({
    ...day, total: c.rows.filter(r => (r.dt || "").slice(0, 10) === day.date).length,
  }));

  return (
    <div className="stack">
      <PageHead onBack={onBack} title={name}
        sub={`${c.total} tickets · ${c.robotCount} tracked robots · ${pct(c.resolved, c.total)}% resolved`} />

      <div className="grid grid--4">
        <Stat label="Total" value={c.total} accent={t.series[0]} small
          onClick={() => onDrill({ title: name, sub: `${c.total} tickets`, rows: c.rows.slice().reverse() })} />
        <Stat label="Resolved at L1" value={c.l1} accent={t.good} small sub={`${pct(c.l1, c.total)}% self-served`}
          onClick={() => onDrill({ title: `${name} — L1`, sub: `${c.l1} tickets`,
            rows: c.rows.filter(r => r.level === "L1").reverse() })} />
        <Stat label="Escalated to L3" value={c.l3} accent={t.series[1]} small sub={`${pct(c.l3, c.total)}% escalated`}
          onClick={() => onDrill({ title: `${name} — L3`, sub: `${c.l3} tickets`,
            rows: c.rows.filter(r => r.level !== "L1").reverse() })} />
        <Stat label="Still open" value={c.open} small accent={c.open ? t.critical : t.text3} alert={c.open > 2}
          onClick={c.open ? () => onDrill({ title: `${name} — open`, sub: `${c.open} tickets`,
            rows: c.rows.filter(r => !["solved", "closed"].includes((r.status || "").toLowerCase())).reverse() }) : undefined} />
      </div>

      <div className="grid grid--wide grid--top">
        <Card title="Their ticket volume" sub="Same range as the rest of the dashboard">
          <VolumeTrend data={daily} height={200} />
        </Card>
        <Card title="Resolution status">
          <SplitBar parts={parts} />
          <SplitLegend parts={parts} total={c.total} />
        </Card>
      </div>

      <Card title="Issue categories" sub={`${cats.length} categories`}>
        <div className="stack" style={{ gap: 2, marginTop: 4 }}>
          {cats.map(([type, count]) => (
            <RankRow key={type} label={type} color={colorForCategory(type)} value={count}
              max={cats[0][1]} pct={pct(count, c.total)} nameWidth={200} />
          ))}
        </div>
      </Card>

      <FaultBreakdown rows={c.rows} onDrill={onDrill}
        title="What goes wrong across their fleet" max={12} />

      {robots.length > 0 && (
        <Card title={`Tracked robots (${robots.length})`} sub="Select a robot for its full fault history" flush>
          <div className="tablewrap" style={{ maxHeight: 340 }}>
            <table className="table">
              <thead>
                <tr><th>Robot</th><th className="num">Tickets</th><th>Leading issue</th><th className="num">Resolved</th><th></th></tr>
              </thead>
              <tbody>
                {robots.map(rb => {
                  const top = Object.entries(rb.types).sort((a, b) => b[1] - a[1])[0];
                  return (
                    <tr key={rb.id} style={{ cursor: "pointer" }} onClick={() => onRobot(rb.id)}>
                      <td><RobotId id={rb.id} /></td>
                      <td className="num cell--strong">{rb.total}</td>
                      <td>{top ? <Tag type={top[0]} color={colorForCategory(top[0])} /> : "—"}</td>
                      <td className="num" style={{ color: "var(--goodText)" }}>{rb.resolved}</td>
                      <td>{rb.total >= 10 && <span className="chip chip--critical">review</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title={`All tickets (${c.total})`} flush>
        <TicketTable rows={c.rows.slice().reverse()} maxH={460} colorFor={colorForCategory}
          columns={["ticket", "date", "owner", "type", "issue", "robot", "status", "level"]} />
      </Card>
    </div>
  );
}

export function RobotDetail({ robotId, d, colorForCategory, onBack, onDrill }) {
  const t = useTheme();
  const rb = d.rmap[robotId];
  if (!rb) return <Empty icon="—" title={`Robot ${robotId} has no tickets in this range`} body="Widen the date range." />;

  const rows = rb.rows.slice().sort((a, b) => (a.dt || "").localeCompare(b.dt || ""));
  const cats = Object.entries(rb.types).sort((a, b) => b[1] - a[1]);
  const open = rb.total - rb.resolved;
  const l3 = rows.filter(r => r.level === "L3").length;
  const severity = rb.total >= 15 ? t.critical : rb.total >= 8 ? t.warning : t.good;
  const daily = d.daily.map(day => ({
    ...day, total: rows.filter(r => (r.dt || "").slice(0, 10) === day.date).length,
  }));

  return (
    <div className="stack">
      <PageHead onBack={onBack} title={`Robot ${robotId}`} sub={rb.customer}
        right={rb.total >= 8 && (
          <span className={`chip ${rb.total >= 15 ? "chip--critical" : "chip--warning"}`}>
            Repeat fault pattern — {rb.total} tickets
          </span>
        )} />

      <div className="grid grid--4">
        <Stat label="Total tickets" value={rb.total} accent={severity} small
          onClick={() => onDrill({ title: `Robot ${robotId}`, sub: `${rb.total} tickets`,
            rows: rows.slice().reverse() })} />
        <Stat label="Escalated to L3" value={l3} accent={t.series[1]} small sub={`${pct(l3, rb.total)}% escalated`} />
        <Stat label="Resolved" value={rb.resolved} accent={t.good} small sub={`${pct(rb.resolved, rb.total)}% resolved`} />
        <Stat label="Still open" value={open} small accent={open ? t.critical : t.text3} alert={open > 0}
          onClick={open ? () => onDrill({ title: `Robot ${robotId} — open`, sub: `${open} tickets`,
            rows: rows.filter(r => !["solved", "closed"].includes((r.status || "").toLowerCase())).reverse() }) : undefined} />
      </div>

      <div className="grid grid--wide grid--top">
        <Card title="Fault timeline" sub="When this robot generated tickets">
          <VolumeTrend data={daily} height={200} />
        </Card>
        <Card title="Ticket categories" sub={`${cats.length} as filed in Zendesk`}>
          <div className="stack" style={{ gap: 2, marginTop: 4 }}>
            {cats.map(([type, count]) => (
              <RankRow key={type} label={type} color={colorForCategory(type)} value={count}
                max={cats[0][1]} pct={pct(count, rb.total)} nameWidth={150} />
            ))}
          </div>
        </Card>
      </div>

      <FaultBreakdown rows={rows} onDrill={onDrill}
        title={`What actually went wrong on robot ${robotId}`}
        max={20} />

      <Card title={`Ticket history (${rows.length})`} flush>
        <TicketTable rows={rows.slice().reverse()} maxH={480} colorFor={colorForCategory}
          columns={["ticket", "date", "owner", "type", "issue", "status", "level"]} />
      </Card>
    </div>
  );
}
