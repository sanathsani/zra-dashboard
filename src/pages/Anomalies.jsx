import { useState, useEffect, useMemo } from "react";
import { Card, Stat, Empty, TicketTable } from "../components";
import { useTheme } from "../theme";

const READ_KEY = "zra_anomaly_read_ids";
const ICON = { robot: "◎", stale: "◷", spike: "◮" };
const LABEL = { robot: "Repeat fault pattern", stale: "Ageing tickets", spike: "Volume spike" };

function loadRead() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); }
  catch { return new Set(); }
}

export default function Anomalies({ d, colorForCategory, onOpenRobot }) {
  const t = useTheme();
  const all = d.anomalies;
  const [read, setRead] = useState(loadRead);
  const [showHistory, setShowHistory] = useState(false);
  const [selId, setSelId] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(READ_KEY, JSON.stringify([...read])); } catch { /* ignore */ }
  }, [read]);

  const active = useMemo(() => all.filter(a => !read.has(a.id)), [all, read]);
  const history = useMemo(() => all.filter(a => read.has(a.id)), [all, read]);

  // Keep a valid selection as the data or the read-set changes.
  useEffect(() => {
    if (!active.length) { setSelId(null); return; }
    if (!active.some(a => a.id === selId)) setSelId(active[0].id);
  }, [active, selId]);

  const selected = all.find(a => a.id === selId) || null;
  const markRead = id => setRead(p => new Set([...p, id]));
  const restore = id => setRead(p => { const n = new Set(p); n.delete(id); return n; });

  const critical = active.filter(a => a.level === "critical").length;

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label="Active alerts" value={active.length} accent={active.length ? t.critical : t.good}
          alert={critical > 0} sub={`${critical} critical`} />
        <Stat label="Repeat-fault robots" value={active.filter(a => a.type === "robot").length}
          accent={t.series[1]} small />
        <Stat label="Ageing tickets" value={active.filter(a => a.type === "stale").reduce((s, a) => s + a.count, 0)}
          accent={t.warning} small />
        <Stat label="Dismissed" value={history.length} accent={t.text3} small />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 14.5, fontWeight: 650, margin: 0 }}>Active anomalies</h3>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {active.length > 0 && (
            <button className="btn btn--sm" onClick={() => setRead(new Set(all.map(a => a.id)))}>
              Dismiss all
            </button>
          )}
          <button className="btn btn--sm" onClick={() => setShowHistory(h => !h)} aria-pressed={showHistory}>
            Dismissed ({history.length})
          </button>
        </div>
      </div>

      {!active.length && (
        <Empty icon="✓" title="No active anomalies"
          body="Nothing in the selected range crosses the alert thresholds." />
      )}

      {active.length > 0 && (
        <div className="anomalygrid">
          <div className="stack anomalylist" style={{ gap: 8 }}>
            {active.map(a => {
              const sel = a.id === selId;
              const c = a.level === "critical" ? t.critical : t.warning;
              return (
                <div key={a.id} className="card" onClick={() => setSelId(a.id)}
                  style={{ cursor: "pointer", borderColor: sel ? "var(--accent)" : undefined,
                           background: sel ? "var(--accentSoft)" : undefined }}>
                  <div style={{ display: "flex", gap: 11, padding: "12px 14px", alignItems: "flex-start",
                                borderLeft: `3px solid ${c}` }}>
                    <span aria-hidden="true" style={{ fontSize: 15, color: c, lineHeight: 1.3 }}>{ICON[a.type] || "!"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 650, letterSpacing: ".05em",
                                    textTransform: "uppercase",
                                    color: a.level === "critical" ? "var(--criticalText)" : "var(--warningText)" }}>
                        {LABEL[a.type] || a.type}
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3, overflow: "hidden",
                                    textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.title}>
                        {a.title}
                      </div>
                      {a.customer && (
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, overflow: "hidden",
                                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.customer}</div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                      <span style={{ fontSize: 17, fontWeight: 680, fontVariantNumeric: "tabular-nums" }}>{a.count}</span>
                      <button className="btn btn--ghost btn--sm" style={{ padding: "2px 6px", fontSize: 11.5 }}
                        onClick={e => { e.stopPropagation(); markRead(a.id); }}>dismiss</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="anomalydetail">
            <AnomalyDetail a={selected} d={d} colorForCategory={colorForCategory} onOpenRobot={onOpenRobot} />
          </div>
        </div>
      )}

      {showHistory && (
        <Card title="Dismissed" flush>
          {!history.length && <Empty icon="—" title="Nothing dismissed yet" />}
          {history.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
                                     borderBottom: "1px solid var(--border)" }}>
              <span aria-hidden="true" style={{ color: "var(--text3)" }}>{ICON[a.type] || "!"}</span>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>{a.title}</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{LABEL[a.type]}</span>
              <button className="btn btn--sm" style={{ marginLeft: "auto" }} onClick={() => restore(a.id)}>Restore</button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function AnomalyDetail({ a, d, colorForCategory, onOpenRobot }) {
  const t = useTheme();
  if (!a) {
    return (
      <Card>
        <Empty icon="◁" title="Select an anomaly" body="Its full ticket evidence appears here." />
      </Card>
    );
  }
  const rb = a.robot ? d.rmap[a.robot] : null;
  const rows = rb ? rb.rows.slice().sort((x, y) => (y.dt || "").localeCompare(x.dt || "")) : (a.rows || []);
  const c = a.level === "critical" ? t.critical : t.warning;

  return (
    <Card>
      <div style={{ borderLeft: `3px solid ${c}`, paddingLeft: 14, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className={`chip ${a.level === "critical" ? "chip--critical" : "chip--warning"}`}>
            {LABEL[a.type] || a.type}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 22, fontWeight: 680 }}>{a.count}</span>
        </div>
        <h3 style={{ fontSize: 16, fontWeight: 650, margin: "10px 0 6px" }}>{a.title}</h3>
        <p style={{ fontSize: 13.5, color: "var(--text2)", margin: 0, lineHeight: 1.6 }}>{a.desc}</p>
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          {a.robot && (
            <button className="btn btn--sm btn--primary" onClick={() => onOpenRobot(a.robot)}>
              Open robot {a.robot} →
            </button>
          )}
          {a.customer && <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{a.customer}</span>}
        </div>
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div className="stat__label" style={{ marginBottom: 8 }}>
          {rb ? `All ${rows.length} tickets for this robot` : `${rows.length} tickets involved`}
        </div>
        <TicketTable rows={rows} maxH={380} colorFor={colorForCategory}
          columns={["ticket", "date", "customer", "type", "issue", "status"]} />
      </div>
    </Card>
  );
}
