// ============================================================================
// data.js — the single source of truth for the dashboard.
//
// Everything the UI renders is derived from the live `rows` array returned by
// the Apps Script feed, filtered by the active date range. Nothing is hardcoded
// and nothing is a stored snapshot, so one date filter scopes every page
// consistently.
//
// Row shape from the feed:
//   { id, dt (ISO), customer, owner, escalated, level, status, type,
//     issue, robot_id, shift }
// ============================================================================

import { useState, useEffect } from "react";

const WEB_APP_URL = "/api/data";
const REFRESH_MS = 5 * 60 * 1000;

// ─── Fetch ──────────────────────────────────────────────────────────────────
export function useLiveData() {
  const [state, setState] = useState({
    loading: true, error: null, data: null, role: null, ts: null, refreshing: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchData(isRefresh) {
      if (isRefresh) setState(s => ({ ...s, refreshing: true }));
      try {
        const res = await fetch(WEB_APP_URL, { method: "GET", redirect: "follow" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        // Apps Script sometimes prefixes the payload with a /*O_o*/ comment.
        const json = JSON.parse(text.replace(/^\/\*[^*]*\*\/\s*/, ""));
        if (json.error) throw new Error(json.error);
        if (cancelled) return;
        setState({
          loading: false, refreshing: false, error: null,
          data: json.data, role: json.role || "internal",
          ts: json.data?.meta?.generated || null,
        });
      } catch (err) {
        if (cancelled) return;
        // On a failed refresh keep the data already on screen rather than
        // blanking the dashboard.
        setState(s => ({
          ...s, loading: false, refreshing: false,
          error: s.data ? null : err.message,
          staleError: s.data ? err.message : null,
        }));
      }
    }

    fetchData(false);
    const timer = setInterval(() => fetchData(true), REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return state;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
export const RESOLVED_STATUSES = new Set(["solved", "closed"]);
const isResolved = r => RESOLVED_STATUSES.has((r.status || "").toLowerCase());
const isPending  = r => (r.status || "").toLowerCase() === "pending";

export const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const MONTHS_LONG = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];

export const dayKey = iso => (iso || "").slice(0, 10);
export const monthKey = iso => (iso || "").slice(0, 7);           // "2026-09"
export const todayKey = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

/** "22 Jun 2026" */
export function fmtDate(iso) {
  const p = dayKey(iso).split("-");
  if (p.length < 3) return iso || "";
  return `${parseInt(p[2], 10)} ${MONTHS_SHORT[parseInt(p[1], 10) - 1]} ${p[0]}`;
}
/** "22 Jun" */
export function fmtDateShort(iso) {
  const p = dayKey(iso).split("-");
  if (p.length < 3) return iso || "";
  return `${parseInt(p[2], 10)} ${MONTHS_SHORT[parseInt(p[1], 10) - 1]}`;
}
/** "September 2026" from a "2026-09" key */
export function fmtMonth(key, long = false) {
  const [y, m] = (key || "").split("-");
  const names = long ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[parseInt(m, 10) - 1] || ""} ${y || ""}`.trim();
}
export function addDays(key, n) {
  const d = new Date(key + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}
export const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(1) : 0);

// ─── Date bounds of the whole dataset ───────────────────────────────────────
export function dataBounds(data) {
  const from = data?.meta?.dateFrom || dayKey(data?.rows?.[0]?.dt) || todayKey();
  const to = data?.meta?.dateTo || todayKey();
  return { from, to };
}

/** Preset ranges, all computed from the data's own bounds and today. */
export function presetRanges(bounds) {
  const today = todayKey();
  const end = today > bounds.to ? today : bounds.to;
  const clamp = f => (f < bounds.from ? bounds.from : f);
  return [
    { id: "7d",   label: "Last 7 days",   from: clamp(addDays(end, -6)),  to: end },
    { id: "30d",  label: "Last 30 days",  from: clamp(addDays(end, -29)), to: end },
    { id: "90d",  label: "Last 90 days",  from: clamp(addDays(end, -89)), to: end },
    { id: "mtd",  label: "Month to date", from: clamp(end.slice(0, 8) + "01"), to: end },
    { id: "all",  label: "All time",      from: bounds.from, to: end },
  ];
}

// ─── The one derivation everything reads ────────────────────────────────────
/**
 * Derive every metric the dashboard shows from the live rows in [from, to].
 * `stableOrder` (agents & categories ranked over the FULL dataset) keeps color
 * assignment tied to the entity rather than its rank in the current slice.
 */
export function derive(data, from, to, stableOrder) {
  const rows = (data?.rows || []).filter(r => {
    const d = dayKey(r.dt);
    return d >= from && d <= to;
  });

  const total = rows.length;
  let resolved = 0, pending = 0, inProgress = 0, l1 = 0, l3 = 0;
  const byDay = new Map(), byMonth = new Map(), byShift = new Map();
  const byAgent = new Map(), byType = new Map();
  const byCustomer = new Map(), byRobot = new Map();

  const bump = (map, key, seed) => {
    if (!map.has(key)) map.set(key, seed());
    return map.get(key);
  };
  const daySeed = () => ({ total: 0, resolved: 0, pending: 0, inProgress: 0 });

  for (const r of rows) {
    const res = isResolved(r), pen = isPending(r);
    if (res) resolved++; else if (pen) pending++; else inProgress++;
    if ((r.level || "") === "L1") l1++; else l3++;

    const dk = dayKey(r.dt), mk = monthKey(r.dt);
    for (const [map, key] of [[byDay, dk], [byMonth, mk]]) {
      const b = bump(map, key, daySeed);
      b.total++; if (res) b.resolved++; else if (pen) b.pending++; else b.inProgress++;
    }

    if (r.shift) {
      const s = bump(byShift, r.shift, () => ({ label: r.shift, tickets: 0, resolved: 0 }));
      s.tickets++; if (res) s.resolved++;
    }

    if (r.owner) {
      const a = bump(byAgent, r.owner, () => ({
        name: r.owner, total: 0, l1: 0, l3: 0, resolved: 0, pending: 0,
        inProgress: 0, months: {}, types: {},
      }));
      a.total++;
      if ((r.level || "") === "L1") a.l1++; else a.l3++;
      if (res) a.resolved++; else if (pen) a.pending++; else a.inProgress++;
      a.months[mk] = (a.months[mk] || 0) + 1;
      if (r.type) a.types[r.type] = (a.types[r.type] || 0) + 1;
    }

    if (r.type) {
      const c = bump(byType, r.type, () => ({
        type: r.type, count: 0, resolved: 0, pending: 0, inProgress: 0,
      }));
      c.count++; if (res) c.resolved++; else if (pen) c.pending++; else c.inProgress++;
    }

    if (r.customer) {
      const c = bump(byCustomer, r.customer, () => ({
        name: r.customer, total: 0, l1: 0, l3: 0, resolved: 0, pending: 0,
        inProgress: 0, types: {}, robots: new Set(), rows: [],
      }));
      c.total++;
      if ((r.level || "") === "L1") c.l1++; else c.l3++;
      if (res) c.resolved++; else if (pen) c.pending++; else c.inProgress++;
      if (r.type) c.types[r.type] = (c.types[r.type] || 0) + 1;
      if (r.robot_id) c.robots.add(String(r.robot_id));
      c.rows.push(r);
    }

    if (r.robot_id) {
      const id = String(r.robot_id);
      const rb = bump(byRobot, id, () => ({
        id, customer: r.customer, total: 0, resolved: 0, types: {}, rows: [],
      }));
      rb.total++; if (res) rb.resolved++;
      if (r.type) rb.types[r.type] = (rb.types[r.type] || 0) + 1;
      rb.rows.push(r);
    }
  }

  // ── daily series, gap-filled so the trend line has no phantom jumps ──
  const daily = [];
  if (total > 0) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const v = byDay.get(d) || daySeed();
      daily.push({ date: d, label: fmtDateShort(d), ...v });
    }
  }

  // ── monthly, chronological ──
  const monthly = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({
      key, month: fmtMonth(key), monthLong: fmtMonth(key, true),
      ...v, rate: pct(v.resolved, v.total),
    }));

  // ── shifts, named from the feed's own shift metadata ──
  const shiftMeta = {};
  (data?.shifts || []).forEach(s => { shiftMeta[s.label] = s; });
  const shifts = [...byShift.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(s => ({
      ...s,
      name: shiftMeta[s.label]?.name || s.label,
      time: shiftMeta[s.label]?.time || "",
      pct: pct(s.tickets, total),
      rate: pct(s.resolved, s.tickets),
    }));

  const agents = [...byAgent.values()].sort((a, b) => b.total - a.total)
    .map(a => ({ ...a, rate: pct(a.resolved, a.total) }));

  const categories = [...byType.values()].sort((a, b) => b.count - a.count)
    .map(c => ({ ...c, pct: pct(c.count, total) }));

  const customers = [...byCustomer.values()]
    .map(c => ({ ...c, robots: [...c.robots], robotCount: c.robots.size,
                 open: c.pending + c.inProgress }))
    .sort((a, b) => b.total - a.total);

  const robots = [...byRobot.values()].sort((a, b) => b.total - a.total);

  const cmap = Object.fromEntries(customers.map(c => [c.name, c]));
  const rmap = Object.fromEntries(robots.map(r => [r.id, r]));

  const unsolved = rows.filter(r => !isResolved(r))
    .sort((a, b) => (a.dt || "").localeCompare(b.dt || ""));

  const summary = {
    total, resolved, pending, inProgress,
    unresolved: pending + inProgress,
    l1, l3,
    l1Unresolved: rows.filter(r => !isResolved(r) && r.level === "L1").length,
    l3Unresolved: rows.filter(r => !isResolved(r) && r.level !== "L1").length,
    rate: pct(resolved, total),
    from, to,
  };

  return {
    rows, summary, daily, monthly, shifts, agents, categories,
    customers, robots, cmap, rmap, unsolved,
    anomalies: buildAnomalies({ rows, robots, daily, unsolved }),
    stableOrder,
  };
}

// ─── Stable ordering over the full dataset (drives color assignment) ────────
export function buildStableOrder(data) {
  const rows = data?.rows || [];
  const tally = (key) => {
    const m = new Map();
    rows.forEach(r => { const v = r[key]; if (v) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0]);
  };
  return { agents: tally("owner"), categories: tally("type") };
}

// ─── Anomaly engine (all thresholds relative to the selected window) ────────
const STALE_DAYS = 7;
const ROBOT_WARN = 8;
const ROBOT_CRITICAL = 15;
const SPIKE_MULTIPLE = 2.2;
const SPIKE_FLOOR = 15;

function buildAnomalies({ rows, robots, daily, unsolved }) {
  const out = [];

  for (const rb of robots) {
    if (rb.total < ROBOT_WARN) continue;
    const top = Object.entries(rb.types).sort((a, b) => b[1] - a[1])[0];
    out.push({
      id: `robot-${rb.id}`, type: "robot",
      level: rb.total >= ROBOT_CRITICAL ? "critical" : "warning",
      title: `Robot ${rb.id} — ${rb.total} tickets`,
      desc: top
        ? `Repeat fault pattern. Leading issue: ${top[0]} (${top[1]} of ${rb.total}).`
        : "Repeat fault pattern across this robot's tickets.",
      count: rb.total, customer: rb.customer, robot: rb.id,
    });
  }

  const cutoff = addDays(todayKey(), -STALE_DAYS);
  const stale = unsolved.filter(r => dayKey(r.dt) < cutoff);
  if (stale.length) {
    out.push({
      id: "stale-tickets", type: "stale", level: "critical",
      title: `${stale.length} tickets open longer than ${STALE_DAYS} days`,
      desc: `Unresolved since before ${fmtDate(cutoff)}. These are the oldest items still on the board.`,
      count: stale.length, rows: stale,
    });
  }

  const W = 7;
  for (let i = W; i < daily.length; i++) {
    const avg = daily.slice(i - W, i).reduce((s, d) => s + d.total, 0) / W;
    const v = daily[i].total;
    if (avg > 0 && v > avg * SPIKE_MULTIPLE && v >= SPIKE_FLOOR) {
      out.push({
        id: `spike-${daily[i].date}`, type: "spike", level: "warning",
        title: `Volume spike on ${fmtDate(daily[i].date)}`,
        desc: `${v} tickets against a trailing 7-day average of ${Math.round(avg)}.`,
        count: v, date: daily[i].date,
        rows: rows.filter(r => dayKey(r.dt) === daily[i].date),
      });
    }
  }

  const rank = { critical: 0, warning: 1 };
  return out.sort((a, b) => (rank[a.level] - rank[b.level]) || (b.count - a.count));
}
