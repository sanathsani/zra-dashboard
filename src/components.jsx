// ============================================================================
// components.jsx — shared UI primitives. All styling comes from styles.css
// via tokens, so every piece works in light and dark without a second design.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { useTheme } from "./theme";
import { fmtDate, fmtDateShort, presetRanges } from "./data";

/* ─── Card ────────────────────────────────────────────────────────────── */
export function Card({ title, sub, actions, children, flush, divided = true, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className={`card__head ${divided ? "card__head--divided" : ""}`}>
          <div style={{ minWidth: 0 }}>
            {title && <h3 className="card__title">{title}</h3>}
            {sub && <div className="card__sub">{sub}</div>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className={`card__body ${flush ? "card__body--flush" : ""}`}>{children}</div>
    </section>
  );
}

/* ─── Stat tile ───────────────────────────────────────────────────────── */
/** The right form when the story is one number — not a one-bar chart. */
export function Stat({ label, value, sub, accent, alert, small, onClick, title }) {
  const t = useTheme();
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={`stat ${small ? "stat--sm" : ""}`}
      onClick={onClick} type={onClick ? "button" : undefined} title={title}
    >
      <span className="stat__rail" style={{ background: accent || t.accent }} />
      <span className="stat__label">
        {label}
        {alert && <span className="chip chip--critical" style={{ padding: "0 6px", fontSize: 11 }}>!</span>}
      </span>
      <span className="stat__value">{value}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </Tag>
  );
}

/* ─── Metric tile ──────────────────────────────────────────────────────
   The same tile the Client Review uses, so a number means the same thing
   and looks the same wherever it is read. Label, figure, one line under it. */
export function Metric({ label, value, sub, alert, onClick, title }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className="metric" onClick={onClick} type={onClick ? "button" : undefined} title={title}>
      <span className="metric__label">
        {label}
        {alert && <span className="chip chip--critical" style={{ padding: "0 6px", fontSize: 11, marginLeft: 6 }}>!</span>}
      </span>
      <div className="metric__value">{value}</div>
      {sub && <div className="metric__foot">{sub}</div>}
    </Tag>
  );
}

/* ─── Meter row (ranked list) ─────────────────────────────────────────── */
export function RankRow({ label, color, value, max, pct, nameWidth = 190, onClick, dot = true }) {
  const t = useTheme();
  return (
    <div
      className="rankrow"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined, borderRadius: 6 }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <span className="rankrow__name" style={{ width: `min(${nameWidth}px, max(46%, 150px))`, flexShrink: 0 }}>
        {dot && <span className="rankrow__dot" style={{ background: color || t.accent }} />}
        <span className="rankrow__label" title={label}>{label}</span>
      </span>
      <span className="meter" style={{ height: 7 }}>
        <span className="meter__fill"
          style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: color || t.accent }} />
      </span>
      <span className="rankrow__val" style={{ width: 42 }}>{value}</span>
      {pct != null && <span className="rankrow__pct">{pct}%</span>}
    </div>
  );
}

/* ─── Category tag ────────────────────────────────────────────────────── */
/** Neutral chip + a colored dot for identity — never 15 competing hues. */
export function Tag({ type, color }) {
  if (!type) return <span style={{ color: "var(--text3)" }}>—</span>;
  return (
    <span className="chip" title={type}>
      <span className="chip__dot" style={{ background: color || "var(--text3)" }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{type}</span>
    </span>
  );
}

export function RobotId({ id }) {
  if (!id) return <span style={{ color: "var(--text3)" }}>—</span>;
  return <span className="rid">{id}</span>;
}

/* ─── Status ──────────────────────────────────────────────────────────── */
/** Status always ships as dot + label, so color never carries meaning alone. */
export function StatusDot({ status }) {
  const t = useTheme();
  const key = (status || "").toLowerCase();
  const map = {
    solved: [t.chartOk, "Solved"], closed: [t.chartOk, "Closed"],
    pending: [t.chartWait, "Pending"], "in progress": [t.chartProg, "In progress"],
  };
  const [c, label] = map[key] || [t.text3, status || "—"];
  const textColor = key === "pending" ? "var(--warningText)"
    : key === "solved" || key === "closed" ? "var(--goodText)" : "var(--text2)";
  return (
    <span className="statusdot" style={{ color: textColor }}>
      <span className="statusdot__dot" style={{ background: c }} />{label}
    </span>
  );
}

export function LevelBadge({ level }) {
  const isL3 = level === "L3";
  return (
    <span style={{
      fontSize: 12, fontWeight: 650, fontVariantNumeric: "tabular-nums",
      color: isL3 ? "var(--warningText)" : "var(--text3)",
    }}>{level || "—"}</span>
  );
}

export function Empty({ icon = "○", title, body }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <div className="empty__title">{title}</div>
      {body && <div className="empty__body">{body}</div>}
    </div>
  );
}

/* ─── Ticket table ────────────────────────────────────────────────────── */
/** The table view — every value on screen is readable without a tooltip. */
export function TicketTable({ rows, maxH = 420, colorFor, columns, onSelect }) {
  const cols = columns || ["ticket", "date", "customer", "owner", "type", "issue", "status", "level"];
  const onRow = onSelect;
  const head = {
    ticket: "Ticket", date: "Date", customer: "Customer", owner: "Owner",
    type: "Category", issue: "Issue", status: "Status", level: "Lvl", robot: "Robot", shift: "Shift",
  };
  if (!rows?.length) return <Empty icon="—" title="No tickets in this range" />;
  return (
    <div className="tablewrap" style={{ maxHeight: maxH }}>
      <table className="table">
        <thead><tr>{cols.map(c => <th key={c}>{head[c]}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id + "-" + i} onClick={onRow ? () => onRow(r) : undefined}
              style={onRow ? { cursor: "pointer" } : undefined}>
              {cols.map(c => {
                switch (c) {
                  case "ticket": return <td key={c}><span className="mono" style={{ color: "var(--accentText)" }}>{r.id}</span></td>;
                  case "date": return <td key={c} style={{ whiteSpace: "nowrap" }}>{fmtDate(r.dt)}</td>;
                  case "customer": return <td key={c} className="cell--tight" title={r.customer}>{r.customer}</td>;
                  case "owner": return <td key={c} className="cell--strong" style={{ whiteSpace: "nowrap" }}>{r.owner || "—"}</td>;
                  case "type": return <td key={c}><Tag type={r.type} color={colorFor?.(r.type)} /></td>;
                  case "issue": return <td key={c} className="cell--wrap cell--strong" title={r.issue}><span>{r.issue}</span></td>;
                  case "status": return <td key={c}><StatusDot status={r.status} /></td>;
                  case "level": return <td key={c}><LevelBadge level={r.level} /></td>;
                  case "robot": return <td key={c}><RobotId id={r.robot_id} /></td>;
                  case "shift": return <td key={c}>{r.shift || "—"}</td>;
                  default: return <td key={c} />;
                }
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Drill-in drawer ─────────────────────────────────────────────────── */
/** Any number on the dashboard can open the tickets it was counted from. */
export function TicketDrawer({ open, title, sub, rows, colorFor, columns, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onEsc); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <button className="scrim scrim--drawer" onClick={onClose} aria-label="Close" />
      <aside className="drawer fadein" role="dialog" aria-label={title}>
        <header className="drawer__head">
          <div style={{ minWidth: 0 }}>
            <h2 className="drawer__title">{title}</h2>
            {sub && <div className="drawer__sub">{sub}</div>}
          </div>
          <button className="btn btn--icon" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer__body">
          {children}
          {rows && (
            <TicketTable rows={rows} maxH={null} colorFor={colorFor}
              columns={columns || ["ticket", "date", "customer", "owner", "issue", "status"]} />
          )}
        </div>
      </aside>
    </>
  );
}

/* ─── Date range control ──────────────────────────────────────────────── */
/** One filter row above everything it scopes — never a filter per chart. */
export function DateRange({ from, to, bounds, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from, to });
  const ref = useRef(null);
  const presets = presetRanges(bounds);

  useEffect(() => { setDraft({ from, to }); }, [from, to]);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const matches = presets.filter(p => p.from === from && p.to === to);
  const active = matches.find(p => p.id === "all") || matches[0];
  const label = active ? active.label : `${fmtDateShort(from)} – ${fmtDate(to)}`;

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true">
        <span aria-hidden="true">▦</span>{label}<span aria-hidden="true" style={{ opacity: .6 }}>▾</span>
      </button>
      {open && (
        <div className="pop fadein" role="dialog" aria-label="Date range">
          <div className="pop__head">Range</div>
          {presets.map(p => (
            <button key={p.id} className="pop__row"
              onClick={() => { onChange(p.from, p.to); setOpen(false); }}>
              <span className="pop__check">{p.from === from && p.to === to ? "✓" : ""}</span>
              <span style={{ flex: 1 }}>{p.label}</span>
              <span style={{ color: "var(--text3)", fontSize: 12 }}>{fmtDateShort(p.from)}</span>
            </button>
          ))}
          <div className="pop__foot">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 8 }}>
              Custom
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="date" className="input" style={{ flex: 1, minWidth: 0 }}
                min={bounds.from} max={bounds.to} value={draft.from}
                onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} aria-label="From date" />
              <span style={{ color: "var(--text3)", fontSize: 12 }}>to</span>
              <input type="date" className="input" style={{ flex: 1, minWidth: 0 }}
                min={bounds.from} max={bounds.to} value={draft.to}
                onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} aria-label="To date" />
            </div>
            <button className="btn btn--primary" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
              onClick={() => {
                if (draft.from && draft.to && draft.from <= draft.to) { onChange(draft.from, draft.to); setOpen(false); }
              }}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Theme toggle ────────────────────────────────────────────────────── */
export function ThemeToggle() {
  const t = useTheme();
  const dark = t.mode === "dark";
  return (
    <button className="btn btn--icon" onClick={t.toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}>
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{dark ? "☀" : "☾"}</span>
    </button>
  );
}

/* ─── Page header with back navigation ────────────────────────────────── */
export function PageHead({ onBack, title, sub, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {onBack && <button className="btn btn--sm" onClick={onBack}>← Back</button>}
      <div style={{ minWidth: 0 }}>
        <h2 style={{ fontSize: 17, fontWeight: 650, margin: 0, letterSpacing: "-.01em" }}>{title}</h2>
        {sub && <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 2 }}>{sub}</div>}
      </div>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}
