import { useState, useMemo, useRef, useEffect } from "react";
import { Card, Stat, RankRow, Empty, Tag, StatusDot, LevelBadge } from "../components";
import { useTheme } from "../theme";
import { fmtDate, todayKey, dayKey, pct } from "../data";

const NOTES_KEY = "zra_unsolved_notes";
const MAX_WORDS = 5;

function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || "{}"); } catch { return {}; }
}

/** Days a ticket has been open, from its own date — never a fixed cutoff. */
function ageDays(dt) {
  const a = new Date(dayKey(dt) + "T12:00:00");
  const b = new Date(todayKey() + "T12:00:00");
  return Math.max(0, Math.round((b - a) / 86400000));
}

export default function Unsolved({ d, colorForCategory, onNavCustomer }) {
  const t = useTheme();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState(loadNotes);
  const [editing, setEditing] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* ignore */ }
  }, [notes]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const uns = d.unsolved;
  const counts = {
    all: uns.length,
    pending: uns.filter(r => r.status === "pending").length,
    "in progress": uns.filter(r => r.status === "in progress").length,
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return uns
      .filter(r => filter === "all" || r.status === filter)
      .filter(r => !needle || [r.id, r.customer, r.issue, r.owner, r.type]
        .some(v => (v || "").toLowerCase().includes(needle)))
      .map(r => ({ ...r, age: ageDays(r.dt) }))
      .sort((a, b) => b.age - a.age);
  }, [uns, filter, q]);

  const byCat = useMemo(() => {
    const m = new Map();
    uns.forEach(r => m.set(r.type, (m.get(r.type) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [uns]);

  const byCust = useMemo(() => {
    const m = new Map();
    uns.forEach(r => m.set(r.customer, (m.get(r.customer) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [uns]);

  const oldest = rows[0];
  const stale = uns.filter(r => ageDays(r.dt) >= 7).length;

  const setNote = (id, val) => {
    const words = val.trim().split(/\s+/).filter(Boolean);
    setNotes(p => ({ ...p, [id]: words.length <= MAX_WORDS ? val : words.slice(0, MAX_WORDS).join(" ") }));
  };

  if (!uns.length) {
    return <Empty icon="✓" title="Nothing unresolved in this range"
      body="Every ticket in the selected period has been solved or closed." />;
  }

  return (
    <div className="stack">
      <div className="grid grid--4">
        <Stat label="Total unresolved" value={uns.length} accent={t.critical} alert={uns.length > 15} />
        <Stat label="Pending" value={counts.pending} accent={t.warning} />
        <Stat label="In progress" value={counts["in progress"]} accent={t.series[0]} />
        <Stat label="Open 7+ days" value={stale} accent={stale ? t.critical : t.text3}
          sub={oldest ? `oldest ${oldest.age} days` : undefined} alert={stale > 0} />
      </div>

      <div className="grid grid--2">
        <Card title="Unresolved by category">
          <div className="stack" style={{ gap: 2, marginTop: 4 }}>
            {byCat.map(([type, count]) => (
              <RankRow key={type} label={type} color={colorForCategory(type)} value={count}
                max={byCat[0][1]} pct={pct(count, uns.length)} nameWidth={200} />
            ))}
          </div>
        </Card>
        <Card title="Unresolved by customer" sub="Select a customer for their full history">
          <div className="stack" style={{ gap: 2, marginTop: 4 }}>
            {byCust.map(([cust, count]) => (
              <RankRow key={cust} label={cust} color={t.series[0]} value={count}
                max={byCust[0][1]} nameWidth={210} dot={false}
                onClick={() => onNavCustomer(cust)} />
            ))}
          </div>
        </Card>
      </div>

      <Card title={`Open tickets (${rows.length})`} sub="Oldest first — notes are saved in this browser only" flush
        actions={
          <input className="input" style={{ width: 210 }} value={q} placeholder="Search tickets…"
            onChange={e => setQ(e.target.value)} aria-label="Search unresolved tickets" />
        }>
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {[["all", "All"], ["pending", "Pending"], ["in progress", "In progress"]].map(([k, l]) => (
            <button key={k} className={`btn btn--sm ${filter === k ? "btn--primary" : ""}`}
              onClick={() => setFilter(k)} aria-pressed={filter === k}>
              {l} <span style={{ opacity: .75 }}>{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="tablewrap" style={{ maxHeight: 520 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Ticket</th><th>Opened</th><th>Customer</th>
                <th>Owner</th><th>Category</th><th>Issue</th><th>Status</th><th>Lvl</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><span className="mono" style={{ color: "var(--accentText)" }}>{r.id}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {fmtDate(r.dt)}
                    <span style={{
                      marginLeft: 8, fontVariantNumeric: "tabular-nums",
                      color: r.age >= 14 ? "var(--criticalText)" : r.age >= 7 ? "var(--warningText)" : "var(--text3)",
                      fontWeight: r.age >= 7 ? 650 : 400,
                    }}>{r.age}d</span>
                  </td>
                  <td className="cell--clip" style={{ maxWidth: 160, cursor: "pointer" }}
                    title={r.customer} onClick={() => onNavCustomer(r.customer)}>{r.customer}</td>
                  <td className="cell--strong">{r.owner || "—"}</td>
                  <td><Tag type={r.type} color={colorForCategory(r.type)} /></td>
                  <td className="cell--clip cell--strong" style={{ maxWidth: 260 }} title={r.issue}>{r.issue}</td>
                  <td><StatusDot status={r.status} /></td>
                  <td><LevelBadge level={r.level} /></td>
                  <td style={{ minWidth: 150 }}>
                    {editing === r.id ? (
                      <input ref={inputRef} className="input" style={{ width: "100%", padding: "5px 9px" }}
                        value={notes[r.id] || ""} placeholder={`≤ ${MAX_WORDS} words`}
                        onChange={e => setNote(r.id, e.target.value)}
                        onBlur={() => setEditing(null)}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") setEditing(null); }} />
                    ) : (
                      <button className="btn btn--ghost btn--sm"
                        style={{ width: "100%", justifyContent: "flex-start", padding: "5px 9px",
                                 color: notes[r.id] ? "var(--text)" : "var(--text3)",
                                 fontStyle: notes[r.id] ? "normal" : "italic" }}
                        onClick={() => setEditing(r.id)}>
                        {notes[r.id] || "Add note…"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
