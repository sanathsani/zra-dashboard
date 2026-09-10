import { Card, Stat, RankRow } from "../components";
import { VolumeTrend, ResolutionBars, SplitBar, SplitLegend, LevelSplitBars } from "../charts";
import { useTheme } from "../theme";
import { fmtDate, fmtMonth, todayKey, addDays, pct } from "../data";

export default function Overview({ d, meta, isAllTime, colorForCategory, onNavCustomer }) {
  const t = useTheme();
  const s = d.summary;
  const today = todayKey();

  const dayRow = key => d.daily.find(x => x.date === key) || { total: 0, resolved: 0, pending: 0, inProgress: 0 };
  const todayRow = dayRow(today);
  const ydayRow = dayRow(addDays(today, -1));

  // Month-to-date is derived from whichever month we are actually in.
  const mtdKey = today.slice(0, 7);
  const mtd = d.monthly.find(m => m.key === mtdKey);

  const avg = d.daily.length ? d.daily.reduce((a, x) => a + x.total, 0) / d.daily.length : 0;
  const busiest = d.daily.reduce((a, x) => (x.total > (a?.total ?? -1) ? x : a), null);

  const resolutionParts = [
    { name: "Resolved", value: s.resolved, color: t.chartOk },
    { name: "In progress", value: s.inProgress, color: t.chartProg },
    { name: "Pending", value: s.pending, color: t.chartWait },
  ];
  const originParts = [
    { name: "Automated alerts", value: meta?.autoAlert || 0, color: t.series[0] },
    { name: "Customer tickets", value: meta?.customerTicket || 0, color: t.series[1] },
  ];
  const originTotal = originParts.reduce((a, p) => a + p.value, 0);

  const rangeLabel = `${fmtDate(s.from)} – ${fmtDate(s.to)}`;
  const topCustomers = d.customers.slice(0, 8);

  return (
    <div className="stack">
      {/* ── Headline numbers. One number per tile — not a one-bar chart. ── */}
      <div className="grid grid--4">
        <Stat label="Total tickets" value={s.total.toLocaleString()} sub={rangeLabel} accent={t.series[0]} />
        <Stat label="Resolved" value={s.resolved.toLocaleString()} sub={`${s.rate}% resolve rate`} accent={t.good} />
        <Stat label="Unresolved" value={s.unresolved} accent={s.unresolved > 0 ? t.critical : t.text3}
          alert={s.unresolved > 15} sub={`${s.pending} pending · ${s.inProgress} in progress`} />
        <Stat label="Escalated to L3" value={s.l3.toLocaleString()} accent={t.series[1]}
          sub={`${pct(s.l3, s.total)}% of tickets · ${s.l1.toLocaleString()} handled at L1`} />
      </div>

      {/* ── Period context ── */}
      <Card title="Recent activity"
        sub={mtd ? `Month to date · ${mtd.monthLong}` : "No tickets logged this month yet"}>
        <div className="grid grid--4" style={{ gap: 14, marginTop: 6 }}>
          {[
            ["Today", todayRow, today],
            ["Yesterday", ydayRow, addDays(today, -1)],
          ].map(([label, row, key]) => (
            <div key={label}>
              <div className="stat__label" style={{ marginBottom: 4 }}>
                {label}
                {label === "Today" && <span className="livedot" />}
              </div>
              <div style={{ fontSize: 24, fontWeight: 680, letterSpacing: "-.02em" }}>{row.total}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{fmtDate(key)}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12, flexWrap: "wrap" }}>
                <span style={{ color: "var(--goodText)" }}>{row.resolved} resolved</span>
                {row.pending > 0 && <span style={{ color: "var(--warningText)" }}>{row.pending} pending</span>}
                {row.inProgress > 0 && <span style={{ color: "var(--text2)" }}>{row.inProgress} in progress</span>}
              </div>
            </div>
          ))}
          <div>
            <div className="stat__label" style={{ marginBottom: 4 }}>Month to date</div>
            <div style={{ fontSize: 24, fontWeight: 680, letterSpacing: "-.02em" }}>{mtd?.total ?? 0}</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{fmtMonth(mtdKey, true)}</div>
            <div style={{ fontSize: 12, marginTop: 6, color: "var(--text2)" }}>
              {mtd ? `${mtd.rate}% resolved` : "—"}
            </div>
          </div>
          <div>
            <div className="stat__label" style={{ marginBottom: 4 }}>Daily average</div>
            <div style={{ fontSize: 24, fontWeight: 680, letterSpacing: "-.02em" }}>{avg.toFixed(1)}</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>over {d.daily.length} days</div>
            {busiest && (
              <div style={{ fontSize: 12, marginTop: 6, color: "var(--text2)" }}>
                peak {busiest.total} on {busiest.label}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Trend + composition ── */}
      <div className="grid grid--wide grid--top">
        <Card title="Daily ticket volume" sub={rangeLabel}>
          <VolumeTrend data={d.daily} height={236} />
        </Card>

        <div className="stack">
          <Card title="Resolution status" sub={`${s.total.toLocaleString()} tickets in range`}>
            <SplitBar parts={resolutionParts} />
            <SplitLegend parts={resolutionParts} total={s.total} />
          </Card>
          <Card title="Ticket origin"
            sub={isAllTime ? "All tickets" : "Reported for the full period, not the selected range"}>
            <SplitBar parts={originParts} />
            <SplitLegend parts={originParts} total={originTotal} />
          </Card>
        </div>
      </div>

      {/* ── Monthly + shifts ── */}
      <div className="grid grid--2 grid--top">
        <Card title="Resolution by month" sub="Each bar is the month's total, split by status">
          <ResolutionBars data={d.monthly} xKey="month" height={300} />
        </Card>
        <Card title="Load by shift" sub="Share of tickets opened during each shift">
          <div className="stack" style={{ gap: 14, marginTop: 8 }}>
            {d.shifts.map((sh, i) => (
              <div key={sh.label}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {sh.name}
                    <span style={{ color: "var(--text3)", fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{sh.time}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
                    {sh.tickets}
                    <span style={{ color: "var(--text3)", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{sh.pct}%</span>
                  </span>
                </div>
                <div className="meter" style={{ height: 8 }}>
                  <span className="meter__fill" style={{ width: `${sh.pct}%`, background: t.series[i % t.series.length] }} />
                </div>
              </div>
            ))}
            {!d.shifts.length && <div style={{ color: "var(--text3)", fontSize: 13 }}>No shift data in this range.</div>}
          </div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <div className="stat__label" style={{ marginBottom: 4 }}>L1 vs L3 per agent</div>
            <LevelSplitBars data={d.agents.slice(0, 6)} height={Math.max(150, d.agents.length * 34 + 46)} />
          </div>
        </Card>
      </div>

      {/* ── Categories + customers ── */}
      <div className="grid grid--2 grid--top">
        <Card title="Issue categories" sub={`${d.categories.length} categories · ${s.total.toLocaleString()} tickets`}>
          <div className="stack" style={{ gap: 2, marginTop: 6 }}>
            {d.categories.map(c => (
              <RankRow key={c.type} label={c.type} color={colorForCategory(c.type)}
                value={c.count} max={d.categories[0]?.count || 1} pct={c.pct} nameWidth={200} />
            ))}
            {!d.categories.length && <div style={{ color: "var(--text3)", fontSize: 13 }}>No tickets in this range.</div>}
          </div>
        </Card>

        <Card title="Top customers" sub="By ticket volume — select one for its full history" flush>
          <div className="tablewrap" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead>
                <tr><th>Customer</th><th className="num">Tickets</th><th className="num">Open</th><th className="num">Robots</th></tr>
              </thead>
              <tbody>
                {topCustomers.map(c => (
                  <tr key={c.name} style={{ cursor: "pointer" }} onClick={() => onNavCustomer(c.name)}>
                    <td className="cell--strong cell--clip" style={{ maxWidth: 220 }} title={c.name}>{c.name}</td>
                    <td className="num">{c.total}</td>
                    <td className="num" style={{ color: c.open > 0 ? "var(--criticalText)" : "var(--text3)", fontWeight: c.open > 0 ? 650 : 400 }}>
                      {c.open || "—"}
                    </td>
                    <td className="num">{c.robotCount || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
