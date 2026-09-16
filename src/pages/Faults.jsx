import { useState, useMemo } from "react";
import { Card, Stat, RankRow, Empty, TicketTable, RobotId } from "../components";
import { SplitBar, SplitLegend } from "../charts";
import { useTheme } from "../theme";
import { FAMILIES } from "../faults";
import { fmtDate, fmtDateShort } from "../data";

const FAMILY_ORDER = ["navigation", "docking", "payload", "motor", "battery", "sensor", "other"];

export default function Faults({ d, onOpenRobot, onDrill }) {
  const t = useTheme();
  const f = d.faults;
  const [family, setFamily] = useState("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState(null);

  const familyColor = id => {
    const i = FAMILY_ORDER.indexOf(id);
    return i >= 0 && i < t.series.length ? t.series[i] : t.seriesOther;
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return f.signatures
      .filter(s => family === "all" || s.family === family)
      .filter(s => !needle || s.label.toLowerCase().includes(needle) || s.message.toLowerCase().includes(needle));
  }, [f.signatures, family, q]);

  const selected = f.signatures.find(s => s.id === selId) || null;

  const topRobots = useMemo(() => {
    const m = new Map();
    f.signatures.forEach(s => s.rows.forEach(r => {
      if (!r.robot_id) return;
      const id = String(r.robot_id);
      if (!m.has(id)) m.set(id, { id, customer: r.customer, count: 0, sigs: new Map() });
      const e = m.get(id); e.count++;
      e.sigs.set(s.label, (e.sigs.get(s.label) || 0) + 1);
    }));
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 8)
      .map(r => ({ ...r, top: [...r.sigs.entries()].sort((a, b) => b[1] - a[1])[0] }));
  }, [f.signatures]);


  if (!f.signatures.length) {
    return <Empty icon="—" title="No machine faults in this range"
      body="Fault detail is read from automated alert tickets; none fell in the selected dates." />;
  }

  const unresolvedFaults = f.signatures.reduce((s, x) => s + x.unresolved, 0);

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label="Tickets with a fault" value={f.classified.toLocaleString()} accent={t.series[0]}
          sub={`${f.coverage}% of ${f.total.toLocaleString()} in range`} />
        <Stat label="Distinct faults" value={f.signatures.length} accent={t.series[2]}
          sub={`across ${f.families.length} families`} />
        <Stat label="Leading fault" value={f.signatures[0].count} accent={t.series[1]}
          sub={f.signatures[0].label} title={f.signatures[0].label} />
        <Stat label="Still unresolved" value={unresolvedFaults}
          accent={unresolvedFaults ? t.critical : t.text3} alert={unresolvedFaults > 10} />
      </div>

      <Card title="Fault families"
        sub="What the “Generic Error” bucket actually contains">
        <SplitBar parts={f.families.map(fam => ({
          name: fam.label, value: fam.count, color: familyColor(fam.id),
        }))} height={14} />
        <SplitLegend total={f.classified} parts={f.families.map(fam => ({
          name: fam.label, value: fam.count, color: familyColor(fam.id),
        }))} />
      </Card>

      <div className="grid grid--wide grid--top">
        <Card title={`Fault signatures (${list.length})`}
          sub="Select one to see every robot and ticket behind it" flush
          actions={
            <input className="input" style={{ width: 200 }} value={q} placeholder="Search faults…"
              onChange={e => setQ(e.target.value)} aria-label="Search fault signatures" />
          }>
          <div style={{ display: "flex", gap: 6, padding: "10px 14px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            <button className={`btn btn--sm ${family === "all" ? "btn--primary" : ""}`}
              onClick={() => setFamily("all")}>All <span style={{ opacity: .75 }}>{f.signatures.length}</span></button>
            {f.families.map(fam => (
              <button key={fam.id} className={`btn btn--sm ${family === fam.id ? "btn--primary" : ""}`}
                onClick={() => setFamily(fam.id)}>
                <span className="chip__dot" style={{ background: familyColor(fam.id) }} />
                {fam.label} <span style={{ opacity: .75 }}>{fam.count}</span>
              </button>
            ))}
          </div>

          <div className="tablewrap" style={{ maxHeight: 560 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>№</th><th>Fault</th><th>Family</th>
                  <th className="num">Tickets</th><th className="num">Robots</th>
                  <th className="num">Open</th><th className="num">Last</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s, i) => (
                  <tr key={s.id} className={selId === s.id ? "is-open" : ""}
                    style={{ cursor: "pointer" }} onClick={() => setSelId(s.id)}>
                    <td style={{ color: "var(--text3)", fontVariantNumeric: "tabular-nums" }}>
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="cell--strong" style={{ minWidth: 190 }}>{s.label}</td>
                    <td>
                      <span className="chip">
                        <span className="chip__dot" style={{ background: familyColor(s.family) }} />
                        {FAMILIES[s.family] || s.family}
                      </span>
                    </td>
                    <td className="num cell--strong">{s.count}</td>
                    <td className="num">{s.robotCount || "—"}</td>
                    <td className="num" style={{ color: s.unresolved ? "var(--criticalText)" : "var(--text3)",
                                                 fontWeight: s.unresolved ? 650 : 400 }}>
                      {s.unresolved || "—"}
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap", color: "var(--text3)" }}>{fmtDateShort(s.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack">
          <Card title="Worst-affected robots" sub="By fault count in this range" flush>
            <div className="tablewrap" style={{ maxHeight: 300 }}>
              <table className="table">
                <thead><tr><th>Robot</th><th>Leading fault</th><th className="num">Faults</th></tr></thead>
                <tbody>
                  {topRobots.map(r => (
                    <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onOpenRobot(r.id)}>
                      <td><RobotId id={r.id} /></td>
                      <td className="cell--tight" title={r.top?.[0]}>{r.top?.[0] || "—"}</td>
                      <td className="num cell--strong">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {selected && <SignatureDetail s={selected} color={familyColor(selected.family)}
            onOpenRobot={onOpenRobot} />}
        </div>
      </div>

      {selected && (
        <Card title={`${selected.label} — ${selected.count} tickets`}
          sub={`${selected.robotCount} robots · ${selected.customerCount} customers`} flush
          actions={<button className="btn btn--sm" onClick={() => setSelId(null)}>Clear</button>}>
          <TicketTable rows={selected.rows.slice().reverse()} maxH={420}
            columns={["ticket", "date", "customer", "owner", "robot", "issue", "status"]}
            onSelect={r => onDrill({
              title: `Ticket ${r.id}`, sub: `${r.customer} · ${fmtDate(r.dt)}`, rows: [r],
            })} />
        </Card>
      )}
    </div>
  );
}

function SignatureDetail({ s, color, onOpenRobot }) {
  const robots = useMemo(() => {
    const m = new Map();
    s.rows.forEach(r => {
      if (!r.robot_id) return;
      const id = String(r.robot_id);
      m.set(id, (m.get(id) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [s]);

  return (
    <Card title="Selected fault" sub={`${FAMILIES[s.family] || s.family}`}>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 4 }}>{s.label}</div>
      <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 8, lineHeight: 1.55,
                    background: "var(--surfaceSunken)", padding: "9px 11px", borderRadius: 8,
                    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', wordBreak: "break-word" }}>
        {s.message.length > 210 ? s.message.slice(0, 210) + "…" : s.message}
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
        <div><div className="stat__label">First seen</div>
          <div style={{ fontSize: 13, marginTop: 3 }}>{fmtDate(s.firstSeen)}</div></div>
        <div><div className="stat__label">Last seen</div>
          <div style={{ fontSize: 13, marginTop: 3 }}>{fmtDate(s.lastSeen)}</div></div>
        <div><div className="stat__label">Unresolved</div>
          <div style={{ fontSize: 13, marginTop: 3, color: s.unresolved ? "var(--criticalText)" : "var(--text2)" }}>
            {s.unresolved || "none"}
          </div></div>
      </div>

      {robots.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <div className="stat__label" style={{ marginBottom: 8 }}>Robots hitting this fault</div>
          <div className="stack" style={{ gap: 2 }}>
            {robots.slice(0, 7).map(([id, n]) => (
              <RankRow key={id} label={`Robot ${id}`} color={color} value={n} max={robots[0][1]}
                nameWidth={120} dot={false} onClick={() => onOpenRobot(id)} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
