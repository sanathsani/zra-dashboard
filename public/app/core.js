/* =========================================================================
   core — one derivation, every view reads it
   ========================================================================= */
/* Supplied by boot.js, which will not load this file until the feed is in. */
const FEED = window.__FEED;
const DICT = FEED.dict;
const C = FEED.cols.reduce((a, k, i) => (a[k] = i, a), {});

const ST = { SOLVED: 0, PENDING: 1, PROGRESS: 2 };
const ST_NAME = ['Solved', 'Pending', 'In progress'];

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const dayKey = s => (s || '').slice(0, 10);
const monKey = s => (s || '').slice(0, 7);
const hourOf = s => +(s || '').slice(11, 13);
const num = n => (n == null ? '—' : n.toLocaleString('en-US'));
const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);
const pct1 = (n, d) => (d > 0 ? (Math.round((n / d) * 1000) / 10).toFixed(1) : '0.0');
const pct2 = (n, d) => (d > 0 ? (Math.round((n / d) * 10000) / 100).toFixed(2) : '0.00');

function fmtDate(iso) {
  const p = dayKey(iso).split('-');
  return p.length < 3 ? iso || '' : `${+p[2]} ${MON[+p[1] - 1]} ${p[0]}`;
}
function fmtDateShort(iso) {
  const p = dayKey(iso).split('-');
  return p.length < 3 ? iso || '' : `${+p[2]} ${MON[+p[1] - 1]}`;
}
function fmtMonth(k, long) {
  const [y, m] = (k || '').split('-');
  return `${(long ? MON_LONG : MON)[+m - 1] || ''} ${y || ''}`.trim();
}
function addDays(k, n) {
  const d = new Date(k + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 36e5;

/* Shift windows — a clean partition by the hour a ticket arrives (IST). */
const SHIFTS = [
  { id: 1, name: 'Shift 1', time: '07:00 – 15:00', from: 7,  to: 15 },
  { id: 2, name: 'Shift 2', time: '15:00 – 23:00', from: 15, to: 23 },
  { id: 3, name: 'Shift 3', time: '23:00 – 07:00', from: 23, to: 7  },
];
const shiftOf = h => (h >= 7 && h < 15 ? 0 : h >= 15 && h < 23 ? 1 : 2);

/* IST → PST reference used in the client deck (IST − 13:30). */
function istToPst(h) {
  let t = h * 60 - 810;
  while (t < 0) t += 1440;
  const hh = Math.floor(t / 60) % 24, mm = t % 60;
  const ap = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

const bounds = {
  from: FEED.meta.dateFrom,
  to: FEED.meta.dateTo,
};

function presets() {
  const end = bounds.to;
  const clamp = f => (f < bounds.from ? bounds.from : f);
  return [
    { id: '7d',  label: 'Last 7 days',   from: clamp(addDays(end, -6)),  to: end },
    { id: '14d', label: 'Last 14 days',  from: clamp(addDays(end, -13)), to: end },
    { id: '30d', label: 'Last 30 days',  from: clamp(addDays(end, -29)), to: end },
    { id: 'mtd', label: 'Month to date', from: clamp(end.slice(0, 8) + '01'), to: end },
    { id: 'aug', label: 'August 2026',   from: '2026-08-01', to: '2026-08-31' },
    { id: 'all', label: 'All time',      from: bounds.from,  to: end },
  ];
}

/* Stable order over the WHOLE dataset, so a filter never repaints survivors. */
const STABLE = (() => {
  const tally = i => {
    const m = new Map();
    FEED.tickets.forEach(t => { const v = t[i]; if (v >= 0) m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  };
  return { owners: tally(C.owner), cats: tally(C.cat), customers: tally(C.cust) };
})();

/* Requester-wait minutes by ticket. Explore's restoration brackets read this
   clock, not created → solved: it stops while a ticket is Pending, so it is
   the shorter of the two and lands tickets a bucket lower. */
const WAIT_BY_ID = (FEED.clocks || []).reduce(
  (a, c) => (c.waitMin != null ? ((a[c.id] = c.waitMin), a) : a), {});

/* SLA breach rows keyed by ticket id — the sheet holds breaches only.
   Which metric breached inside a given window comes from FEED.clocks, in
   derive(); the sheet's own breach label covers the ticket's whole life. */
const SLA_BY_ID = FEED.sla.reduce((a, r) => (a[r.id] = r, a), {});

/* Names that must never appear in a customer list on screen or in a deck —
   a bucket label invites questions it cannot answer. The tickets still count
   in every total; only the row is withheld. */
const HIDDEN_CUSTOMERS = new Set(['other', 'others', 'unknown', 'n/a', 'na', '-', '', 'skild']);
const isHiddenCustomer = name => HIDDEN_CUSTOMERS.has(String(name || '').trim().toLowerCase());

/* Explore's ageing brackets, which stop at > 5 days. Only the wording is
   touched here, so the two bracket charts beside it read the same way. */
const AGE_BUCKETS = [
  { label: '<1 day',   lo: 0, hi: 1 },
  { label: '1-3 days', lo: 1, hi: 3 },
  { label: '3-5 days', lo: 3, hi: 5 },
  { label: '>5 days',  lo: 5, hi: 1e9 },
];
/* Explore's own bracket edges and Explore's own wording, in hours. These had
   drifted: restoration was cut at 3-5 days and > 5 days where Explore cuts at
   3-7 and > 7, and first reply carried 1-3 days and > 3 days where Explore
   stops at > 24 hrs. Same tickets, different shelves, so the two screens
   disagreed on shape while agreeing on totals. */
const RES_BUCKETS = [
  { label: '0-1 hrs',  lo: 0,   hi: 1 },
  { label: '1-24 hrs', lo: 1,   hi: 24 },
  { label: '1-3 days', lo: 24,  hi: 72 },
  { label: '3-7 days', lo: 72,  hi: 168 },
  { label: '>7 days',  lo: 168, hi: 1e9 },
];
const FR_BUCKETS = [
  { label: '0-1 hrs',  lo: 0,  hi: 1 },
  { label: '1-8 hrs',  lo: 1,  hi: 8 },
  { label: '8-24 hrs', lo: 8,  hi: 24 },
  { label: '>24 hrs',  lo: 24, hi: 1e9 },
];
/* The feed carries these two only once the tracker sheet has the columns. */
const HAS_RESPONSE = FEED.cols.indexOf('response') >= 0;
const HAS_RESTORE  = FEED.cols.indexOf('restore')  >= 0;

function derive(from, to) {
  const rows = FEED.tickets.filter(t => {
    const d = dayKey(t[C.created]);
    return d >= from && d <= to;
  });

  const total = rows.length;
  let solved = 0, pending = 0, progress = 0, l1 = 0, l3 = 0, auto = 0;
  let l1Solved = 0, l3Solved = 0, l1Open = 0, l3Open = 0, autoOpen = 0, custOpen = 0;
  let l1Pending = 0, l1Progress = 0, l3Pending = 0, l3Progress = 0;

  const byDay = new Map(), byMonth = new Map(), byHour = Array.from({ length: 24 }, () => 0);
  const byShift = [0, 0, 0], shiftSolved = [0, 0, 0];
  const byOwner = new Map(), byCat = new Map(), byCust = new Map(), byRobot = new Map();
  const ageCount = AGE_BUCKETS.map(() => ({ all: 0, l1: 0, l3: 0 }));
  const resCount = RES_BUCKETS.map(() => 0);
  const frCount = FR_BUCKETS.map(() => 0);
  let frNone = 0, frKnown = 0;
  /* Aging is measured TODAY, because that is what Zendesk does: its date
     filter picks WHICH tickets are in the report, but the age of a ticket
     still open is always counted up to the current date. Measuring at the
     period end put the same 14 tickets two buckets lower than the Zendesk
     screen — 1–3 days here against 3–5 days there, two days after the
     period closed. `ageAt` is reported so the card can say which day. */
  /* And to the MINUTE, not to the day. Whole calendar days call a ticket
     raised at 23:00 on the 18th and one raised at 00:01 on the 18th equally
     old, so two tickets barely four and a half days old sat in "> 5 days"
     here while Zendesk, which counts the hours, had them in "3 - 5 days". */
  const ageNow = new Date();
  const ageAt = ageNow.toLocaleDateString('en-CA');

  for (const t of rows) {
    const st = t[C.status], isL3 = t[C.lvl] === 1, open = st !== ST.SOLVED;
    if (st === ST.SOLVED) solved++; else if (st === ST.PENDING) pending++; else progress++;
    if (isL3) l3++; else l1++;
    if (t[C.auto]) auto++;
    if (!open) { isL3 ? l3Solved++ : l1Solved++; }
    else {
      isL3 ? l3Open++ : l1Open++;
      if (st === ST.PENDING) { isL3 ? l3Pending++ : l1Pending++; }
      else { isL3 ? l3Progress++ : l1Progress++; }
      t[C.auto] ? autoOpen++ : custOpen++;
      const age = (ageNow - new Date(t[C.created])) / 864e5;
      const bi = AGE_BUCKETS.findIndex(b => age >= b.lo && age < b.hi);
      if (bi >= 0) { ageCount[bi].all++; isL3 ? ageCount[bi].l3++ : ageCount[bi].l1++; }
    }
    /* Restoration: the requester-wait clock, which is what Explore's
       "Tickets by requester wait time brackets" counts. It pauses while a
       ticket is Pending, so it runs shorter than column M (created → solved
       on the calendar) — that difference put eight tickets in 1 - 24 hrs here
       against three in Explore. Column M is still the sheet's own number.
       Solved tickets only, which is Explore's metric: Solved tickets. */
    if (!open) {
      let h = null;
      const wait = WAIT_BY_ID[t[C.id]];
      if (wait != null) h = wait / 60;
      else if (HAS_RESTORE && t[C.restore] !== '' && t[C.restore] != null) h = Number(t[C.restore]) / 60;
      else if (t[C.solved]) h = hoursBetween(t[C.created], t[C.solved]);
      if (h != null && h >= 0) {
        const bi = RES_BUCKETS.findIndex(b => h >= b.lo && h < b.hi);
        if (bi >= 0) resCount[bi]++;
      }
    }
    /* First response, on SOLVED tickets only. Explore's chart counts solved
       tickets: it read 30 replied and 246 without where this read 40 and 249,
       and the difference was exactly the fourteen still open. Blank means
       nobody ever replied. */
    if (HAS_RESPONSE && !open) {
      const v = t[C.response];
      if (v === '' || v == null) frNone++;
      else {
        const h = Number(v) / 60;
        const bi = FR_BUCKETS.findIndex(b => h >= b.lo && h < b.hi);
        if (bi >= 0) { frCount[bi]++; frKnown++; }
      }
    }

    const dk = dayKey(t[C.created]), mk = monKey(t[C.created]);
    const day = byDay.get(dk) || { total: 0, solved: 0, open: 0 };
    day.total++; open ? day.open++ : day.solved++; byDay.set(dk, day);
    const mo = byMonth.get(mk) || { total: 0, solved: 0, pending: 0, progress: 0 };
    mo.total++; st === ST.SOLVED ? mo.solved++ : st === ST.PENDING ? mo.pending++ : mo.progress++;
    byMonth.set(mk, mo);

    const h = hourOf(t[C.created]);
    byHour[h]++;
    const si = shiftOf(h);
    byShift[si]++; if (!open) shiftSolved[si]++;

    const o = byOwner.get(t[C.owner]) || { id: t[C.owner], total: 0, l1: 0, l3: 0, solved: 0, open: 0, cats: {} };
    o.total++; isL3 ? o.l3++ : o.l1++; open ? o.open++ : o.solved++;
    o.cats[t[C.cat]] = (o.cats[t[C.cat]] || 0) + 1;
    byOwner.set(t[C.owner], o);

    const c = byCat.get(t[C.cat]) || { id: t[C.cat], total: 0, l1Solved: 0, l3Solved: 0, l1Open: 0, l3Open: 0, cust: 0, auto: 0, custOpen: 0, autoOpen: 0 };
    c.total++;
    if (!open) { isL3 ? c.l3Solved++ : c.l1Solved++; } else { isL3 ? c.l3Open++ : c.l1Open++; }
    t[C.auto] ? c.auto++ : c.cust++;
    if (open) { t[C.auto] ? c.autoOpen++ : c.custOpen++; }
    byCat.set(t[C.cat], c);

    const cu = byCust.get(t[C.cust]) || { id: t[C.cust], total: 0, solved: 0, open: 0, l3: 0, robots: new Set(), cats: {} };
    cu.total++; open ? cu.open++ : cu.solved++; if (isL3) cu.l3++;
    if (t[C.robot] >= 0) cu.robots.add(t[C.robot]);
    cu.cats[t[C.cat]] = (cu.cats[t[C.cat]] || 0) + 1;
    byCust.set(t[C.cust], cu);

    if (t[C.robot] >= 0) {
      const rb = byRobot.get(t[C.robot]) || { id: t[C.robot], cust: t[C.cust], total: 0, open: 0 };
      rb.total++; if (open) rb.open++;
      byRobot.set(t[C.robot], rb);
    }
  }

  /* daily series, gap-filled */
  const daily = [];
  if (total) for (let d = from; d <= to; d = addDays(d, 1)) {
    const v = byDay.get(d) || { total: 0, solved: 0, open: 0 };
    daily.push({ date: d, label: fmtDateShort(d), ...v });
  }

  const monthly = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ key: k, label: fmtMonth(k), ...v }));

  /* Agents: ONLY those with tickets in this window. Roster flags come from Config. */
  const roster = FEED.agents.reduce((a, r) => (a[r.name] = r, a), {});
  const owners = STABLE.owners
    .filter(id => byOwner.has(id))
    .map(id => {
      const o = byOwner.get(id), name = DICT.owners[id];
      return { ...o, name, rate: pct(o.solved, o.total),
        status: roster[name]?.status || '—', role: roster[name]?.role || 'Agent' };
    })
    .sort((a, b) => b.total - a.total);
  const dormant = FEED.agents.filter(a => !owners.some(o => o.name === a.name)).map(a => a.name);

  const cats = STABLE.cats.filter(id => byCat.has(id)).map(id => {
    const c = byCat.get(id);
    return { ...c, name: DICT.cats[id], share: pct(c.total, total) };
  }).sort((a, b) => b.total - a.total);

  const customers = [...byCust.values()].map(c => ({
    ...c, name: DICT.customers[c.id], robotCount: c.robots.size, share: pct(c.total, total),
    hidden: isHiddenCustomer(DICT.customers[c.id]),
  })).sort((a, b) => b.total - a.total);
  /* what any list, chart or slide is allowed to show */
  const customersShown = customers.filter(c => !c.hidden);

  const robots = [...byRobot.values()].map(r => ({ ...r, name: DICT.robots[r.id], cust: DICT.customers[r.cust] }))
    .sort((a, b) => b.total - a.total);
  const robotsShown = robots.filter(r => !isHiddenCustomer(r.cust));

  const shifts = SHIFTS.map((s, i) => ({
    ...s, tickets: byShift[i], solved: shiftSolved[i],
    share: pct(byShift[i], total), rate: pct(shiftSolved[i], byShift[i]),
  }));

  /* Peak window = the SHORTEST run of consecutive hours carrying >= 40% of the
     period's tickets. A plain "above average" rule breaks on a one-hour dip;
     this answers the question the client actually asks — when does the day
     concentrate. Ties go to the busiest window. */
  let peak = null;
  if (total) {
    const target = total * 0.4;
    for (let len = 1; len <= 24 && !peak; len++) {
      let best = null;
      for (let s = 0; s < 24; s++) {
        let sum = 0;
        for (let i = 0; i < len; i++) sum += byHour[(s + i) % 24];
        if (sum >= target && (!best || sum > best.tickets)) best = { start: s, len, tickets: sum };
      }
      if (best) peak = { ...best, end: (best.start + best.len) % 24 };
    }
    if (!peak) {
      const mx = Math.max(...byHour), s = byHour.indexOf(mx);
      peak = { start: s, len: 1, end: (s + 1) % 24, tickets: mx };
    }
  }

  /* ── SLA, counted the way Zendesk counts it ──────────────────────────────
     Zendesk's SLA reports do not ask when a ticket was RAISED. They ask when
     its SLA clock FINISHED, and file the target under that date. #1287 came
     in on 6 Sep and breached on 8 Sep: Explore shows it in 7–20 Sep, and
     filtering on the created date hid it here.

     So the window is applied to the clocks, and the rates divide by the
     clocks that finished inside it — Zendesk's own denominator — not by the
     tickets raised inside it. The level and auto-alert flags are read from
     the WHOLE ticket table, because a ticket that breaches inside the window
     was often raised outside it.

     Only finished clocks reach the feed (Explore: "SLA metric status =
     Completed"), so a ticket sitting past its target is not yet a breach on
     either screen. */
  const lvlById = {}, autoById = {}, catById = {};
  FEED.tickets.forEach(t => {
    lvlById[t[C.id]] = t[C.lvl]; autoById[t[C.id]] = t[C.auto];
    catById[t[C.id]] = DICT.cats[t[C.cat]];
  });

  const inWindow = s => { const d = dayKey(s); return !!d && d >= from && d <= to; };
  const frClocks = [], resClocks = [], frBreached = new Set(), resBreached = new Set();
  for (const c of (FEED.clocks || [])) {
    if (c.fr && inWindow(c.frAt))   { frClocks.push(c);  if (c.fr  === 'B') frBreached.add(c.id); }
    if (c.res && inWindow(c.resAt)) { resClocks.push(c); if (c.res === 'B') resBreached.add(c.id); }
  }

  const breaches = FEED.sla
    .filter(r => frBreached.has(r.id) || resBreached.has(r.id))
    .map(r => ({
      ...r, lvl: lvlById[r.id] === 1 ? 'L3' : 'L1', auto: !!autoById[r.id],
      cat: r.category || catById[r.id] || '—',
      /* What it breached IN THIS WINDOW. The sheet's own label covers the
         ticket's whole life, so a July response breach would otherwise be
         read back into a September review. */
      breach: frBreached.has(r.id) && resBreached.has(r.id) ? 'Response & Resolution SLA'
            : frBreached.has(r.id) ? 'First Response SLA' : 'Resolution SLA',
    }));
  const fr = breaches.filter(b => frBreached.has(b.id));
  const res = breaches.filter(b => resBreached.has(b.id));
  const byRca = new Map();
  breaches.forEach(b => {
    const k = b.cat || 'Unclassified';
    byRca.set(k, (byRca.get(k) || 0) + 1);
  });
  const sla = {
    total,
    frClocks: frClocks.length, resClocks: resClocks.length,
    fr: fr.length, res: res.length,
    both: breaches.filter(b => frBreached.has(b.id) && resBreached.has(b.id)).length,
    frRate: 100 - pct(fr.length, frClocks.length),
    resRate: 100 - pct(res.length, resClocks.length),
    frCust: fr.filter(b => !b.auto).length, frAuto: fr.filter(b => b.auto).length,
    resL1Cust: res.filter(b => b.lvl === 'L1' && !b.auto).length,
    resL3Cust: res.filter(b => b.lvl === 'L3' && !b.auto).length,
    resL1Auto: res.filter(b => b.lvl === 'L1' && b.auto).length,
    resL3Auto: res.filter(b => b.lvl === 'L3' && b.auto).length,
    rows: breaches.sort((a, b) => (a.created || '').localeCompare(b.created || '')),
    byRca: [...byRca.entries()].map(([k, v]) => ({ name: k, count: v })).sort((a, b) => b.count - a.count),
  };

  const unsolved = rows.filter(t => t[C.status] !== ST.SOLVED)
    .sort((a, b) => (a[C.created] || '').localeCompare(b[C.created] || ''));

  return {
    from, to, rows, total,
    summary: {
      total, solved, pending, progress, open: pending + progress,
      l1, l3, l1Solved, l3Solved, l1Open, l3Open,
      l1Pending, l1Progress, l3Pending, l3Progress,
      auto, cust: total - auto, autoOpen, custOpen,
      rate: pct(solved, total), l1Share: pct(l1, total), l3Share: pct(l3, total),
    },
    daily, monthly, byHour, peak, shifts,
    owners, dormant, cats, customers, customersShown, robots, robotsShown,
    ageAt: ageAt,
    age: AGE_BUCKETS.map((b, i) => ({ ...b, ...ageCount[i] })),
    resTime: RES_BUCKETS.map((b, i) => ({ ...b, count: resCount[i] })),
    brackets: {
      hasResponse: HAS_RESPONSE,
      restoreFromZendesk: HAS_RESTORE,
      response: HAS_RESPONSE
        ? [{ label: 'No replies', count: frNone }]
            .concat(FR_BUCKETS.map((b, i) => ({ label: b.label, count: frCount[i] })))
        : [],
      responseTotal: frNone + frKnown,
      restore: RES_BUCKETS.map((b, i) => ({ label: b.label, count: resCount[i] })),
    },
    sla, unsolved,
  };
}

