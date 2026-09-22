import { useMemo, useState } from "react";
import { Card, Stat, RankRow } from "../components";
import { VolumeTrend, ResolutionBars, SplitBar, SplitLegend, LevelSplitBars } from "../charts";
import { useTheme } from "../theme";
import { FAMILIES } from "../faults";
import { fmtDate, fmtMonth, todayKey, addDays, dayKey, pct } from "../data";

const FAMILY_ORDER = ["navigation", "docking", "payload", "motor", "battery", "sensor", "other"];

export default function Overview({
  d, meta, isAllTime, colorForCategory, onNavCustomer, onNavRobot, onNavFaults, onDrill,
}) {
  const t = useTheme();
  const s = d.summary;
  const today = todayKey();
  const [openCat, setOpenCat] = useState(null);

  const dayRow = key => d.daily.find(x => x.date === key) || { total: 0, resolved: 0, pending: 0, inProgress: 0 };
  const todayRow = dayRow(today);
  const ydayRow = dayRow(addDays(today, -1));

  const mtdKey = today.slice(0, 7);
  const mtd = d.monthly.find(m => m.key === mtdKey);
  const avg = d.daily.length ? d.daily.reduce((a, x) => a + x.total, 0) / d.daily.length : 0;

  // ── What needs attention ────────────────────────────────────────────────
  const ageOf = r => Math.max(0, Math.round(
    (new Date(today + "T12:00:00") - new Date(dayKey(r.dt) + "T12:00:00")) / 86400000));
  const stale = d.unsolved.filter(r => ageOf(r) >= 7);
  const repeatRobots = d.robots.filter(r => r.total >= 8);
  const topFault = d.faults.signatures[0];

  const familyColor = id => {
    const i = FAMILY_ORDER.indexOf(id);
    return i >= 0 && i < t.series.length ? t.series[i] : t.seriesOther;
  };

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

  // Generic Error expands into the faults it actually contains.
  const catFaults = useMemo(() => {
    if (!openCat) return null;
    const rows = d.rows.filter(r => r.type === openCat);
    const sigs = d.faults.signatures
      .map(sig => ({ ...sig, own: sig.rows.filter(r => r.type === openCat).length }))
      .filter(sig => sig.own > 0)
      .sort((a, b) => b.own - a.own);
    return { rows, sigs };
  }, [openCat, d.rows, d.faults]);

  return (
    <div className="stack">

      {/* ── Needs attention, before any totals ── */}
      <div className="kpihead"><h3>Needs attention</h3><span>{rangeLabel}</span></div>
      <div className="grid grid--4">
        <Stat label="Unresolved" value={s.unresolved} accent={s.unresolved ? t.critical : t.good}
          alert={s.unresolved > 15} sub={`${s.pending} pending · ${s.inProgress} in progress`}
          onClick={() => onDrill({ title: "Unresolved tickets", sub: rangeLabel, rows: d.unsolved })} />
        <Stat label="Open 7+ days" value={stale.length} accent={stale.length ? t.critical : t.text3}
          alert={stale.length > 0}
          sub={stale.length ? `oldest ${Math.max(...stale.map(ageOf))} days` : "nothing ageing"}
          onClick={stale.length ? () => onDrill({
            title: "Open longer than 7 days", sub: `${stale.length} tickets`, rows: stale,
          }) : undefined} />
        <Stat label="Repeat-fault robots" value={repeatRobots.length} accent={t.series[1]}
          sub={repeatRobots[0] ? `worst: ${repeatRobots[0].id} · ${repeatRobots[0].total}` : "none"}
          onClick={repeatRobots[0] ? () => onNavRobot(repeatRobots[0].id) : undefined} />
        <Stat label="Leading fault" value={topFault ? topFault.count : 0} accent={t.series[2]}
          sub={topFault ? topFault.label : "—"} title={topFault?.label}
          onClick={topFault ? () => onDrill({
            title: topFault.label,
            sub: `${FAMILIES[topFault.family]} · ${topFault.robotCount} robots`,
            rows: topFault.rows.slice().reverse(),
          }) : undefined} />
      </div>

      {/* ── Volume ──────────────────────────────────────────────────────────
         Every number on this page used to be its own size: 25px in the row
         above, 23px here, 19px underneath, and the bottom two rows were bare
         divs rather than tiles. Three type scales and two card treatments for
         one page of figures. It is one tile and one scale now, with the second
         row a deliberate step down because it is cadence, not volume. */}
      <div className="kpihead"><h3>Volume</h3><span>{rangeLabel}</span></div>
      <div className="grid grid--4">
        {[
          ["Total", s.total.toLocaleString(), rangeLabel],
          ["Resolved", s.resolved.toLocaleString(), `${s.rate}% resolve rate`],
          ["Handled at L1", s.l1.toLocaleString(), `${pct(s.l1, s.total)}% self-served`],
          ["Escalated to L3", s.l3.toLocaleString(), `${pct(s.l3, s.total)}% escalated`],
        ].map(([label, value, sub]) => (
          <Stat key={label} label={label} value={value} sub={sub} accent={t.accent} />
        ))}
      </div>
      <div className="grid grid--4">
        <Stat small label={<>Today<span className="livedot" /></>}
          value={todayRow.total} sub={fmtDate(today)} accent={t.text3} />
        <Stat small label="Yesterday" value={ydayRow.total}
          sub={fmtDate(addDays(today, -1))} accent={t.text3} />
        <Stat small label="Month to date" value={mtd?.total ?? 0}
          sub={fmtMonth(mtdKey, true)} accent={t.text3} />
        <Stat small label="Daily average" value={avg.toFixed(1)}
          sub={`over ${d.daily.length} days`} accent={t.text3} />
      </div>

      {/* ── Trend + composition ── */}
      <div className="grid grid--wide grid--top">
        <Card title="Daily ticket volume" sub={rangeLabel}>
          <VolumeTrend data={d.daily} height={210} />
        </Card>
        <div className="stack">
          <Card title="Resolution status" sub={`${s.total.toLocaleString()} tickets in range`}>
            <SplitBar parts={resolutionParts} />
            <SplitLegend parts={resolutionParts} total={s.total} />
          </Card>
          <Card title="Ticket origin"
            sub={isAllTime ? "All tickets" : "Full period, not the selected range"}>
            <SplitBar parts={originParts} />
            <SplitLegend parts={originParts} total={originTotal} />
          </Card>
        </div>
      </div>

      {/* ── What actually breaks ── */}
      <div className="grid grid--wide grid--top">
        <Card title="What actually breaks"
          sub={`${d.faults.classified} tickets carry a machine fault · ${d.faults.signatures.length} distinct`}
          actions={<button className="btn btn--sm" onClick={onNavFaults}>All faults →</button>}>
          <div className="stack" style={{ gap: 2, marginTop: 4 }}>
            {d.faults.signatures.slice(0, 8).map(sig => (
              <RankRow key={sig.id} label={sig.label} color={familyColor(sig.family)}
                value={sig.count} max={d.faults.signatures[0].count}
                pct={pct(sig.count, d.faults.classified)} nameWidth={240}
                onClick={() => onDrill({
                  title: sig.label,
                  sub: `${FAMILIES[sig.family] || sig.family} · ${sig.robotCount} robots`,
                  rows: sig.rows.slice().reverse(),
                })} />
            ))}
          </div>
        </Card>

        <Card title="Fault families" sub="Where the failures concentrate">
          <SplitBar height={12} parts={d.faults.families.map(fam => ({
            name: fam.label, value: fam.count, color: familyColor(fam.id),
          }))} />
          <SplitLegend total={d.faults.classified} parts={d.faults.families.map(fam => ({
            name: fam.label, value: fam.count, color: familyColor(fam.id),
          }))} />
        </Card>
      </div>

      {/* ── Monthly + shifts ── */}
      <div className="grid grid--2 grid--top">
        <Card title="Resolution by month" sub="Each bar is the month's total, split by status">
          <ResolutionBars data={d.monthly} xKey="month" height={230} />
        </Card>
        <Card title="Load by shift" sub="Share of tickets opened during each shift">
          <div className="stack" style={{ gap: 11, marginTop: 6 }}>
            {d.shifts.map((sh, i) => (
              <div key={sh.label}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {sh.name}
                    <span style={{ color: "var(--text3)", fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{sh.time}</span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
                    {sh.tickets}
                    <span style={{ color: "var(--text3)", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{sh.pct}%</span>
                  </span>
                </div>
                <div className="meter" style={{ height: 7 }}>
                  <span className="meter__fill" style={{ width: `${sh.pct}%`, background: t.series[i % t.series.length] }} />
                </div>
              </div>
            ))}
            {!d.shifts.length && <div style={{ color: "var(--text3)", fontSize: 13 }}>No shift data in this range.</div>}
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div className="stat__label" style={{ marginBottom: 4 }}>L1 vs L3 per agent</div>
            <LevelSplitBars data={d.agents.slice(0, 6)} height={Math.max(140, d.agents.length * 32 + 44)} />
          </div>
        </Card>
      </div>

      {/* ── Categories, expandable where the label hides the detail ── */}
      <div className="grid grid--2 grid--top">
        <Card title="Issue categories"
          sub={`${d.categories.length} categories · select one to see its faults`}>
          <div className="stack" style={{ gap: 2, marginTop: 4 }}>
            {d.categories.map(c => {
              const isOpen = openCat === c.type;
              return (
                <div key={c.type}>
                  <RankRow label={c.type} color={colorForCategory(c.type)}
                    value={c.count} max={d.categories[0]?.count || 1} pct={c.pct} nameWidth={200}
                    onClick={() => setOpenCat(isOpen ? null : c.type)} />
                  {isOpen && catFaults && (
                    <div style={{ margin: "6px 0 10px 18px", paddingLeft: 14,
                                  borderLeft: "2px solid var(--border)" }}>
                      {catFaults.sigs.length ? (
                        <>
                          <div className="stat__label" style={{ marginBottom: 6 }}>
                            {catFaults.sigs.length} faults inside this category
                          </div>
                          <div className="stack" style={{ gap: 2 }}>
                            {catFaults.sigs.slice(0, 8).map(sig => (
                              <RankRow key={sig.id} label={sig.label} color={familyColor(sig.family)}
                                value={sig.own} max={catFaults.sigs[0].own} nameWidth={210}
                                onClick={() => onDrill({
                                  title: sig.label, sub: `${c.type} · ${sig.own} tickets`,
                                  rows: sig.rows.filter(r => r.type === c.type).reverse(),
                                })} />
                            ))}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: 12.5, color: "var(--text3)", padding: "4px 0" }}>
                          These tickets were raised by people, so there is no machine fault to break out.
                        </div>
                      )}
                      <button className="btn btn--sm btn--ghost" style={{ marginTop: 8, paddingLeft: 0 }}
                        onClick={() => onDrill({
                          title: c.type, sub: `${c.count} tickets`, rows: catFaults.rows.slice().reverse(),
                        })}>
                        Open all {c.count} tickets →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Top customers" sub="By ticket volume — select one for its full history" flush>
          <div className="tablewrap" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead>
                <tr><th>Customer</th><th className="num">Tickets</th><th className="num">Open</th><th className="num">Robots</th></tr>
              </thead>
              <tbody>
                {d.customers.slice(0, 10).map(c => (
                  <tr key={c.name} style={{ cursor: "pointer" }} onClick={() => onNavCustomer(c.name)}>
                    <td className="cell--strong cell--tight" style={{ maxWidth: 230 }} title={c.name}>{c.name}</td>
                    <td className="num">{c.total}</td>
                    <td className="num" style={{ color: c.open > 0 ? "var(--criticalText)" : "var(--text3)",
                                                 fontWeight: c.open > 0 ? 650 : 400 }}>{c.open || "—"}</td>
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
