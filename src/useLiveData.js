// ============================================================
// useLiveData.js — LOCAL DEV VERSION
// Two differences from production:
//   1. No credentials/auth (Apps Script deployed as "Anyone")
//   2. Fetch mode handles CORS via no-cors fallback
//
// When ready for Vercel: swap back to production version
// ============================================================

import { useState, useEffect, useMemo } from "react";

// LOCAL: use the "Anyone" deployment URL (no auth required)
// PRODUCTION: switch to "Anyone with Google account" URL
const WEB_APP_URL = "/api/data";

export function useLiveData() {
  const [state, setState] = useState({
    loading: true,
    error:   null,
    data:    null,
    role:    null,
    ts:      null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        // Apps Script with "Anyone" access + no credentials = works from localhost
        const res = await fetch(WEB_APP_URL, {
          method:   "GET",
          redirect: "follow",
          // No credentials: "include" here — that's for auth'd deploys on Vercel
        });

        if (!res.ok) throw new Error("HTTP " + res.status);

        const text = await res.text();

        // Apps Script sometimes wraps in /*O_o*/ prefix — strip it
        const clean = text.replace(/^\/\*[^*]*\*\/\s*/, '');
        const json  = JSON.parse(clean);

        if (json.error) throw new Error(json.error);
        if (cancelled) return;

        setState({
          loading: false,
          error:   null,
          data:    json.data,
          role:    json.role || "internal",
          ts:      json.data?.meta?.generated || null,
        });

      } catch (err) {
        if (cancelled) return;
        setState(s => ({ ...s, loading: false, error: err.message }));
      }
    }

    fetchData();
    const timer = setInterval(fetchData, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return state;
}

// ── All adapters below are identical to production version ────

export function adaptSummary(data) {
  if (!data) return null;
  return data.meta;
}

export function adaptMonthly(data) {
  if (!data?.daily) return [];
  const months = {};
  Object.entries(data.daily).forEach(([dateStr, d]) => {
    const mo = new Date(dateStr + "T12:00:00")
      .toLocaleString("en-US", { month: "long" });
    if (!months[mo]) months[mo] = {
      month: mo, total: 0, resolved: 0, pending: 0, inProgress: 0
    };
    months[mo].total      += d.total;
    months[mo].resolved   += d.resolved;
    months[mo].pending    += d.pending;
    months[mo].inProgress += d.inProgress;
  });
  return Object.values(months).map(m => ({
    ...m,
    rate: m.total > 0 ? +((m.resolved / m.total) * 100).toFixed(1) : 0,
  }));
}

export function adaptDaily(data) {
  if (!data?.daily) return [];
  return Object.entries(data.daily)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateStr, d]) => {
      const dt    = new Date(dateStr + "T12:00:00");
      const label = dt.toLocaleString("en-US", { month:"short", day:"numeric" });
      return { label, v: d.total, ...d };
    });
}

export function adaptShifts(data) {
  if (!data) return [];
  const total = data.meta?.total || 1;
  return (data.shifts || []).map(s => ({
    ...s,
    pct: +((s.tickets / total) * 100).toFixed(1),
  }));
}

export function adaptAgents(data) {
  if (!data?.agents) return [];
  const monthly = {};
  (data.rows || []).forEach(r => {
    const agent = r.owner; if (!agent) return;
    const mo = new Date(r.dt).toLocaleString("en-US", { month:"short" }).toLowerCase();
    if (!monthly[agent]) monthly[agent] = {};
    monthly[agent][mo] = (monthly[agent][mo] || 0) + 1;
  });
  return data.agents.map(a => ({
    ...a,
    ...(monthly[a.name] || {}),
    color: null,
  }));
}

export function adaptCats(data) {
  return data?.categories || [];
}

export function adaptFleet(data) {
  if (!data) return null;

  const cmap = {};
  (data.customers || []).forEach(c => {
    cmap[c.name] = {
      name: c.name, tot: c.total,
      l1: c.l1 || 0, l3: c.l3 || 0,
      solv: c.resolved, pend: c.pending, opn: c.inProgress,
      types: c.types || {}, robotCount: c.robotCount || 0,
      robots: Object.keys(c.robots || {}), tix: [],
    };
  });

  const rmap = {};
  (data.robots || []).forEach(rb => {
    rmap[rb.id] = {
      id: rb.id, cust: rb.customer, tot: rb.total,
      types: rb.types || {}, resolved: rb.resolved, tix: [],
    };
  });

  (data.rows || []).forEach(r => {
    const tuple = [
      r.id, r.dt ? r.dt.substring(0,10) : null,
      r.customer, r.owner, r.level, r.status,
      r.type, r.robot_id, r.issue,
    ];
    if (cmap[r.customer]) cmap[r.customer].tix.push(tuple);
    if (r.robot_id && rmap[r.robot_id]) rmap[r.robot_id].tix.push(tuple);
  });

  const unsolved = (data.unsolved || []).map(r => [
    r.id, r.dt ? r.dt.substring(0,10) : null,
    r.customer, r.owner, r.level, r.status,
    r.type, r.robot_id, r.issue,
  ]);

  const anomalies = (data.anomalies || []).map(a => ({
    id:    "robot-" + a.robot_id,
    type:  "robot",
    lvl:   a.level,
    title: a.robot_id + " — " + a.total + " tickets",
    desc:  "Top issue: " + a.top_type + " (x" + a.top_count + "). Systemic fault pattern.",
    count: a.total,
    cust:  a.customer,
    robot: a.robot_id,
  }));

  return {
    tot:      data.meta?.total || 0,
    unsolved,
    custArr:  Object.values(cmap).sort((a,b) => b.tot - a.tot),
    robArr:   Object.values(rmap).sort((a,b) => b.tot - a.tot),
    cmap, rmap, anomalies,
  };
}
