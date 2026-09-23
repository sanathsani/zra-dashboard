/* =========================================================================
   views — shell, sign-in, Overview, Client Review, presentation mode
   ========================================================================= */
const S = { view: 'overview', range: (typeof window !== 'undefined' && window.__RANGE) || null, user: null, sideOpen: false, menu: null,
  show: { cats: false, custTable: false } };
const $ = s => document.querySelector(s);
const q = (root, s) => root.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const NOTES_KEY = 'skild.review.notes.v1';
function loadNotes() { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch { return {}; } }
function saveNotes(n) { try { localStorage.setItem(NOTES_KEY, JSON.stringify(n)); } catch {} }
let NOTES = loadNotes();
const noteKey = id => `${id}`;

let D = null;   // current derivation
let P = null;   // the period immediately before it, same length

function prevPeriod(from, to) {
  const len = daysBetween(from, to) + 1;
  const pTo = addDays(from, -1), pFrom = addDays(pTo, -(len - 1));
  if (pTo < bounds.from) return null;
  return { from: pFrom < bounds.from ? bounds.from : pFrom, to: pTo, whole: pFrom >= bounds.from };
}
/* Shown only when the previous window is whole — a clipped one would compare
   30 days against 9 and read as a collapse. */
function delta(cur, prev, mode) {
  if (!P || !P.whole || !prev) return '';
  const d = cur - prev, p = (d / prev) * 100;
  if (Math.abs(p) < 0.5) return `<span style="color:var(--ink3)">level with the previous period</span>`;
  const up = d > 0;
  const good = mode === 'rate' ? up : mode === 'lower' ? !up : null;
  const col = good === null ? 'var(--ink3)' : good ? 'var(--good-ink)' : 'var(--crit-ink)';
  const unit = mode === 'rate' ? `${Math.abs(d).toFixed(1)} pts` : `${Math.abs(Math.round(p))}%`;
  return `<span style="color:${col};font-weight:650">${up ? '▲' : '▼'} ${unit}</span>
    <span style="color:var(--ink3)">vs previous ${P.days} days</span>`;
}
/* ── sign in ─────────────────────────────────────────────────────────── */
/* ── small builders ──────────────────────────────────────────────────── */
function kpi(label, value, note, mod = 'kpi--plain', small) {
  return `<div class="kpi ${mod} ${small ? 'kpi--sm' : ''}">
    <span class="kpi__label">${label}</span>
    <div class="kpi__value">${value}</div>
    ${note ? `<div class="kpi__note">${note}</div>` : ''}</div>`;
}
/* Explore-style metric box: label, number, nothing else. */
function mbox(label, value, foot) {
  return `<div class="mbox">
    <span class="mbox__label">${label}</span>
    <div class="mbox__value">${value}</div>
    ${foot ? `<div class="mbox__foot">${foot}</div>` : ''}</div>`;
}

/* customers × issue categories, the matrix from the tracker sheet */
function crossTab() {
  /* columns alphabetical, like the tracker sheet */
  const cats = D.cats.slice().sort((a, b) => a.name.localeCompare(b.name));
  /* Every ticket. Some of them have no customer and never will: a voicemail
     from a number nobody recognises, a PagerDuty test, an internal case. The
     sheet files those under "Other", which is a fine note to yourself and a
     poor thing to put in front of a client — and leaving them out entirely
     made the grand total 48 short of the period, which is worse than either.
     They are counted, in one row, under a name that says what they are.
     The customer tables and charts still leave them out. */
  const named = D.customers.filter(c => c.total > 0 && !c.hidden);
  const loose = D.customers.filter(c => c.total > 0 && c.hidden);
  const rows = named.slice();
  if (loose.length) {
    const cats = {};
    let total = 0;
    loose.forEach(c => {
      total += c.total;
      Object.keys(c.cats).forEach(k => { cats[k] = (cats[k] || 0) + c.cats[k]; });
    });
    rows.push({ id: 'loose', name: 'No account recorded', total, cats });
  }
  const colTotal = cats.map(cat => rows.reduce((a, c) => a + (c.cats[cat.id] || 0), 0));
  const grand = colTotal.reduce((a, b) => a + b, 0);
  /* one hue, light → dark with magnitude — the cell colour IS the reading */
  let hi = 0;
  rows.forEach(c => cats.forEach(cat => { hi = Math.max(hi, c.cats[cat.id] || 0); }));
  const heat = x => {
    if (!x) return 'h0';
    const r = x / (hi || 1);
    return r <= .04 ? 'h1' : r <= .12 ? 'h2' : r <= .30 ? 'h3' : r <= .60 ? 'h4' : 'h5';
  };
  return `<div class="xtabwrap" style="max-height:540px;overflow-y:auto">
    <table class="xtab">
      <thead><tr>
        <th class="xtab__num">#</th><th class="xtab__lead">Customers</th>
        ${cats.map(c => `<th class="xtab__rot"><span>${esc(c.name)}</span></th>`).join('')}
        <th class="xtab__tot">Total</th></tr></thead>
      <tbody>${rows.map((c, i) => `<tr>
        <td class="xidx">${i + 1}</td><td class="xname">${esc(c.name)}</td>
        ${cats.map(cat => { const x = c.cats[cat.id] || 0;
          return `<td class="${heat(x)}">${x}</td>`; }).join('')}
        <td class="xrowtot">${num(c.total)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td class="xname">Grand total</td>
        ${colTotal.map(v => `<td>${v}</td>`).join('')}
        <td class="xrowtot">${num(grand)}</td></tr></tfoot>
    </table></div>
    <div class="heatkey"><span>Fewer</span>
      <i style="background:var(--ord1)"></i><i style="background:var(--ord2)"></i>
      <i style="background:var(--ord3)"></i><i style="background:var(--ord4)"></i>
      <i style="background:var(--ord5)"></i><span>More tickets</span></div>`;
}

function card(title, sub, body, cls = '') {
  return `<section class="card ${cls}">
    ${title ? `<div class="card__head"><div class="card__title">${title}</div>
      ${sub ? `<div class="card__sub">${sub}</div>` : ''}</div>` : ''}
    <div class="card__body">${body}</div></section>`;
}
const cols = (min, gap = 16) =>
  `display:grid;grid-template-columns:repeat(auto-fit,minmax(${min}px,1fr));gap:${gap}px`;

function statusRows(solved, progress, pending) {
  const t = solved + progress + pending;
  const row = (label, v, c) => `
    <div style="display:grid;grid-template-columns:84px 1fr auto 46px;gap:10px;align-items:center;margin-bottom:9px">
      <span style="font-size:12.5px;color:var(--ink2)">${label}</span>
      <span class="meter"><i style="width:${t ? (v / t) * 100 : 0}%;background:${c}"></i></span>
      <b style="font-size:12.5px;font-variant-numeric:tabular-nums">${num(v)}</b>
      <span style="font-size:11.5px;color:var(--ink3);text-align:right;font-variant-numeric:tabular-nums">${pct1(v, t)}%</span>
    </div>`;
  return row('Solved', solved, 'var(--good)') +
         row('In progress', progress, 'var(--s1)') +
         row('Pending', pending, 'var(--warn)');
}

/* ── shell ───────────────────────────────────────────────────────────── */
const NAV = [
  { group: 'Operations', items: [{ id: 'overview', label: 'Overview', icon: '▤' }] },
  { group: 'Reporting',  items: [{ id: 'review',   label: 'Client Review', icon: '◰' }] },
];
const TITLES = { overview: 'Overview', review: 'Client Review' };

/* Everything the views draw lives inside this one element. The body itself is
   left alone, because the chart tooltip, the toast and the anchor a deck
   generator appends while saving a file all hang off it and must survive a
   re-render. */
/* Embed mode: the review is rendered inside the dashboard, in an iframe, so it
   brings no sidebar and no date picker of its own — the dashboard's own filter
   drives it over postMessage. Everything else is the same code. */
const EMBED = new URLSearchParams(location.search).has('embed');

function appRoot() {
  let r = document.getElementById('app-root');
  if (!r) { r = document.createElement('div'); r.id = 'app-root'; document.body.appendChild(r); }
  return r;
}

function shell() {
  const badges = { open: D.summary.open };
  if (EMBED) {
    appRoot().innerHTML = `
    <div class="embed">
      <div class="embedbar">
        <button class="btn btn--sm" id="present" title="Full-screen presentation">\u26F6 Present</button>
        <div class="menu" id="expmenu"><button class="btn btn--icon btn--sm" id="expbtn" title="Download deck">\u21E9</button>
        ${S.menu === 'exp' ? `<div class="menu__pop" id="exppop">
          <button class="menu__opt" data-ex="pptx">Download PowerPoint</button>
          <button class="menu__opt" data-ex="pdf">Download PDF</button>
        </div>` : ''}</div>
      </div>
      <main class="content content--embed" id="content"></main>
    </div>`;
    wireShell();
    return;
  }

  const initials = (S.user?.name || 'U').split(' ').map(w => w[0]).slice(0, 2).join('');
  const isReview = S.view === 'review';
  appRoot().innerHTML = `
  <div class="app">
    <nav class="sidebar ${S.sideOpen ? 'sidebar--open' : ''}" aria-label="Sections">
      <div class="sidebar__brand">
        <span class="sidebar__mark">SA</span>
        <span><span style="display:block;font-size:13px;font-weight:680">Skild AI</span>
        <span style="display:block;font-size:11px;color:var(--ink3)">Customer Excellence Center</span></span>
      </div>
      <div class="sidebar__nav">
        ${NAV.map(g => `<div><div class="sidebar__group">${g.group}</div>${g.items.map(i => {
          const n = badges[i.badge] || 0;
          return `<button class="navitem ${S.view === i.id ? 'navitem--active' : ''}" data-view="${i.id}"
>
            <span class="navitem__icon">${i.icon}</span><span>${i.label}</span>
            ${n ? `<span class="navitem__badge ${i.alert ? 'navitem__badge--alert' : ''}">${n}</span>` : ''}
            </button>`;
        }).join('')}</div>`).join('')}
      </div>
      <div class="sidebar__foot">
        <div class="sidebar__user">
          <span class="avatar">${esc(initials)}</span>
          <span style="min-width:0"><span style="display:block;font-size:12px;color:var(--ink2);font-weight:640">${esc(S.user?.name || '')}</span>
          <span style="display:block;font-size:11px">${esc(S.user?.role || '')}</span></span>
          <button class="btn btn--icon" id="signout" title="Sign out" style="margin-left:auto;padding:4px 7px">⏻</button>
        </div>
        ${freshness()}
      </div>
    </nav>
    ${S.sideOpen ? '<button class="scrim" id="scrim"></button>' : ''}
    <div class="main">
      <header class="topbar">
        <button class="btn btn--icon menubtn" id="menu">☰</button>
        <div style="min-width:0">
          <h1 class="topbar__title">${TITLES[S.view] || ''}</h1>
          <div class="topbar__sub">${fmtDate(D.from)} – ${fmtDate(D.to)} · ${num(D.total)} tickets</div>
        </div>
        <div class="topbar__spacer"></div>
        ${isReview ? `<button class="btn btn--sm" id="present" title="Full-screen presentation">⛶ Present</button>
          <div class="menu" id="expmenu"><button class="btn btn--icon btn--sm" id="expbtn" title="Download deck">⇩</button>
          ${S.menu === 'exp' ? `<div class="menu__pop" id="exppop">
            <button class="menu__opt" data-ex="pptx">Download PowerPoint</button>
            <button class="menu__opt" data-ex="pdf">Download PDF</button>
          </div>` : ''}</div>` : ''}
        <div class="menu" id="dr">
          <button class="btn btn--sm" id="drbtn">▦ ${rangeLabel()} ▾</button>
          ${S.menu === 'dr' ? drMenu() : ''}
        </div>
        <button class="btn btn--icon btn--sm" id="theme" title="Theme">${document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'}</button>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`;
  wireShell();
}

function wireShell() {


  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    S.view = b.dataset.view; S.sideOpen = false; S.menu = null; render();
  }));
  $('#menu')?.addEventListener('click', () => { S.sideOpen = !S.sideOpen; render(); });
  $('#scrim')?.addEventListener('click', () => { S.sideOpen = false; render(); });
  $('#theme')?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('skild.theme', dark ? 'light' : 'dark'); } catch {}
    render();
  });
  $('#signout')?.addEventListener('click', () => {
    SkildAuth.signOut();
  });
  $('#drbtn')?.addEventListener('click', e => { e.stopPropagation(); S.menu = S.menu === 'dr' ? null : 'dr'; render(); });
  $('#expbtn')?.addEventListener('click', e => {
    e.stopPropagation();
    if (EXPORTING) return toast('A download is already building — one moment.');
    S.menu = S.menu === 'exp' ? null : 'exp'; render();
  });
  $('#present')?.addEventListener('click', () => startPresent());
  if (S.menu === 'dr') wireRange();
  if (S.menu === 'exp') {
    $('#exppop').addEventListener('click', e => e.stopPropagation());
    document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => {
      if (EXPORTING) return;
      const kind = b.dataset.ex;
      EXPORTING = true; S.menu = null; render();
      exportDeck(kind).finally(() => { EXPORTING = false; });
    }));
    document.addEventListener('click', () => { if (S.menu === 'exp') { S.menu = null; render(); } }, { once: true });
  }
}

function rangeLabel() {
  const p = presets().find(p => p.from === D.from && p.to === D.to);
  return p ? p.label : `${fmtDateShort(D.from)} – ${fmtDateShort(D.to)}`;
}
function drMenu() {
  return `<div class="menu__pop" id="drpop" style="min-width:322px">
    ${presets().map(p => `<button class="menu__opt" data-from="${p.from}" data-to="${p.to}">${p.label}
      ${p.note ? `<i>${p.note}</i>` : ''}
      ${p.from === D.from && p.to === D.to ? '<b>✓</b>' : ''}</button>`).join('')}
    <div class="dr__custom">
      <label>From</label><input type="date" id="cfrom" value="${D.from}" min="${bounds.from}" max="${bounds.to}">
      <label>To</label><input type="date" id="cto" value="${D.to}" min="${bounds.from}" max="${bounds.to}">
      <button class="btn btn--primary" id="capply" style="width:100%;justify-content:center">Apply range</button>
    </div></div>`;
}
function wireRange() {
  document.querySelectorAll('[data-from]').forEach(b => b.addEventListener('click', () => {
    S.range = { from: b.dataset.from, to: b.dataset.to }; S.menu = null; render();
  }));
  $('#capply').addEventListener('click', () => {
    const f = $('#cfrom').value, t = $('#cto').value;
    if (f && t && f <= t) { S.range = { from: f, to: t }; S.menu = null; render(); }
  });
  $('#drpop').addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => { if (S.menu === 'dr') { S.menu = null; render(); } }, { once: true });
}

let toastT;
function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483000;background:var(--ink);color:var(--card);font-size:12.5px;padding:10px 15px;border-radius:10px;box-shadow:var(--shadow-lg);max-width:min(520px,90vw);text-align:center;transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.opacity = '0'; }, 3600);
}

/* ── Overview ────────────────────────────────────────────────────────── */
function viewOverview() {
  const s = D.summary;
  const peakDay = D.daily.reduce((a, b) => (b.total > (a ? a.total : -1) ? b : a), null);

  $('#content').innerHTML = `
  <div style="${cols(210)};margin-bottom:16px">
    ${kpi('Tickets', num(s.total), delta(s.total, P && P.d.summary.total) || `${fmtDate(D.from)} – ${fmtDate(D.to)}`, 'kpi--blue')}
    ${kpi('Resolved', num(s.solved), `${pct1(s.solved, s.total)}% resolution rate`, 'kpi--good')}
    ${kpi('Open', num(s.open), `${s.pending} pending · ${s.progress} in progress`, s.open ? 'kpi--warn' : 'kpi--plain')}
    ${kpi('Escalated to L3', num(s.l3), `${pct1(s.l3, s.total)}% of tickets`, 'kpi--orange')}
  </div>

  <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);margin-bottom:16px">
    ${card('Daily ticket volume',
      `${D.daily.length} days${peakDay ? ` · peak ${peakDay.total} on ${fmtDate(peakDay.date)}` : ''}`,
      '<div class="chart chart--fill" id="c-daily"></div>')}
    <div style="display:grid;gap:16px;align-content:start">
      ${card('Resolution status', `${num(s.total)} tickets in range`, statusRows(s.solved, s.progress, s.pending))}
      ${card('Ticket origin', 'Where the ticket came from', `
        <div class="split" style="margin-bottom:13px">
          <i style="background:var(--s3);width:${pct(s.auto, s.total)}%"></i>
          <i style="background:var(--s1);width:${pct(s.cust, s.total)}%"></i></div>
        <div class="kv"><span class="kv__k"><i class="swatch" style="background:var(--s3)"></i>Automated alerts</span>
          <span class="kv__v">${num(s.auto)}</span><span class="kv__pct">${pct1(s.auto, s.total)}%</span></div>
        <div class="kv"><span class="kv__k"><i class="swatch" style="background:var(--s1)"></i>Customer tickets</span>
          <span class="kv__v">${num(s.cust)}</span><span class="kv__pct">${pct1(s.cust, s.total)}%</span></div>`)}
    </div>
  </div>

  <div style="margin-bottom:16px">
    ${card('Hourly load distribution',
      'When tickets arrive across the day · IST, with the PST reference used in the client review',
      '<div class="chart" id="c-hours"></div>' + hourNarrative())}
  </div>

  <div style="${cols(330)};margin-bottom:16px">
    ${card('Load by shift', 'Share of tickets opened in each shift window', shiftBlock())}
    ${card('L1 vs L3 per agent', `${D.owners.length} agent${D.owners.length === 1 ? '' : 's'} handled tickets in this range`,
      '<div id="c-agents"></div>')}
  </div>

  <div style="${cols(330)};margin-bottom:16px">
    ${card('Volume by month', 'Each column is the month total, split by status',
      '<div class="chart chart--fill" id="c-months"></div>' +
      `<div class="legend"><span><i class="swatch" style="background:var(--s1)"></i>Solved</span>
       <span><i class="swatch" style="background:var(--mark)"></i>In progress</span>
       <span><i class="swatch" style="background:var(--warn)"></i>Pending</span></div>`)}
    ${card('Issue categories', `${D.cats.length} categories · top 8 shown`, '<div id="c-cats"></div>')}
  </div>

  <div style="${cols(330)}">
    ${card('Top customers', 'By ticket volume in this range', `<div class="tblwrap">
      <table class="tbl"><thead><tr><th>Customer</th><th class="num">Tickets</th><th class="num">Open</th><th class="num">Robots</th></tr></thead>
      <tbody>${D.customersShown.slice(0, 8).map(c => `<tr><td>${esc(c.name)}</td>
        <td class="num">${num(c.total)}</td>
        <td class="num" style="${c.open ? 'color:var(--crit-ink);font-weight:650' : 'color:var(--ink3)'}">${c.open}</td>
        <td class="num" style="color:var(--ink3)">${c.robotCount}</td></tr>`).join('')}</tbody></table></div>`)}
    ${card('Repeat-offender robots', 'Robots with the most tickets in this range', `<div class="tblwrap">
      <table class="tbl"><thead><tr><th>Robot</th><th>Customer</th><th class="num">Tickets</th></tr></thead>
      <tbody>${D.robotsShown.slice(0, 8).map(r => `<tr><td style="font-variant-numeric:tabular-nums">${esc(r.name)}</td>
        <td style="color:var(--ink3)">${esc(r.cust)}</td><td class="num">${num(r.total)}</td></tr>`).join('')}</tbody></table></div>`)}
  </div>`;

  const fit = (h, min) => Math.max(min, Math.round(h.getBoundingClientRect().height) - 4);
  const daily = $('#c-daily'), months = $('#c-months');
  chartArea(daily, D.daily, { height: fit(daily, 240) });
  chartHours($('#c-hours'), D.byHour, D.peak);
  chartAgents($('#c-agents'), D.owners);
  chartMonths(months, D.monthly, { height: fit(months, 200) });
  revealOverview();
  chartBars($('#c-cats'), D.cats.slice(0, 8).map(c => ({
    label: c.name, value: c.total, sub: `${pct1(c.total, D.total)}%`,
    tip: `<div>${esc(c.name)}</div><b>${c.total}</b> tickets · ${pct1(c.total, D.total)}%<div style="opacity:.75">${c.l1Solved + c.l3Solved} solved · ${c.l1Open + c.l3Open} open</div>`,
  })), { labelWidth: '172px' });
}

function revealOverview() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $('#content').querySelectorAll('.card, .kpi').forEach((n, i) => {
    n.classList.add('reveal');
    n.style.animationDelay = Math.min(i, 8) * 30 + 'ms';
    n.classList.add('reveal--in');
  });
}

function hourNarrative() {
  if (!D.peak) return '';
  const p = D.peak;
  return `<div class="bandnote"><b>Peak window</b> —
    ${String(p.start).padStart(2, '0')}:00 to ${String(p.end).padStart(2, '0')}:00 IST
    (${istToPst(p.start)} – ${istToPst(p.end)} PST) carries <b>${num(p.tickets)}</b> of ${num(D.total)}
    tickets — ${pct1(p.tickets, D.total)}% of the range in ${p.len} of 24 hours.</div>`;
}
function shiftBlock() {
  const busiest = D.shifts.slice().sort((a, b) => b.tickets - a.tickets)[0];
  return D.shifts.map(s => `
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:6px">
        <b style="font-size:12.5px">${s.name}</b>
        <span style="font-size:11.5px;color:var(--ink3)">${s.time} IST</span>
        <span style="margin-left:auto;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums">${num(s.tickets)}</span>
        <span style="font-size:11.5px;color:var(--ink3);font-variant-numeric:tabular-nums;width:46px;text-align:right">${pct1(s.tickets, D.total)}%</span>
      </div>
      <div class="meter"><i style="width:${s.share}%;background:var(--s1)"></i></div>
      <div style="font-size:11px;color:var(--ink3);margin-top:5px">${num(s.solved)} resolved · ${pct1(s.solved, s.tickets)}%</div>
    </div>`).join('') + (busiest && D.total
      ? `<div class="bandnote" style="margin-top:2px"><b>${busiest.name}</b> carries the day —
         ${pct1(busiest.tickets, D.total)}% of arrivals in ${busiest.time} IST.</div>` : '');
}

/* ── Client Review — sections shared by the page and by Present ──────── */
function reviewSections() {
  const s = D.summary, sla = D.sla;
  const period = `${fmtDate(D.from)} – ${fmtDate(D.to)}`;
  const resL1 = sla.resL1Cust + sla.resL1Auto, resL3 = sla.resL3Cust + sla.resL3Auto;
  const out = [];

  /* 01 — the Zendesk Explore metric panel, box for box */
  out.push({
    id: 's1', title: 'Current metrics', sub: period, tag: `${num(s.total)} tickets`,
    ph: 'Anything you want to say about the period — wins, misses, staffing, context the numbers do not carry.',
    html: `
      <div class="mgrid" style="margin-bottom:13px">
        ${mbox('Created tickets', num(s.total))}
        ${mbox('Solved tickets', num(s.solved), pct2(s.solved, s.total) + '% of created')}
        ${mbox('Solved Tickets - L1', num(s.l1Solved), pct2(s.l1Solved, s.total) + '% of created')}
        ${mbox('Solved Tickets - L3', num(s.l3Solved), pct2(s.l3Solved, s.total) + '% of created')}
      </div>
      <div class="mgrid">
        ${mbox('Unsolved tickets', num(s.open), 'open at period end')}
        ${mbox('Unsolved Tickets - L1', num(s.l1Open), `${s.l1Pending} pending · ${s.l1Progress} in progress`)}
        ${mbox('Unsolved Tickets - L3', num(s.l3Open), `${s.l3Pending} pending · ${s.l3Progress} in progress`)}
        ${mbox('Resolution rate', pct1(s.solved, s.total) + '%', 'solved ÷ created')}
      </div>`,
  });

  /* 02 — the three by-status panels, exactly as Explore shows them */
  out.push({
    id: 's2', title: 'Tickets by status', sub: 'All tickets, L1 and L3 counted separately', tag: period,
    ph: 'What the status split says about where work is sitting.',
    html: `<div style="${cols(250)}">
      ${card('All Tickets by status', `${num(s.total)} tickets`, statusRows(s.solved, s.progress, s.pending))}
      ${card('L1 Tickets by status', `${num(s.l1)} tickets`, statusRows(s.l1Solved, s.l1Progress, s.l1Pending))}
      ${card('L3 Tickets by status', `${num(s.l3)} tickets`, statusRows(s.l3Solved, s.l3Progress, s.l3Pending))}
    </div>
    <p class="sub" style="margin-top:24px">Where the ticket came from</p>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(310px,.8fr);align-items:center">
      <div class="mgrid" style="grid-template-columns:repeat(2,minmax(158px,1fr))">
        ${mbox('Customer tickets', num(s.cust), pct2(s.cust, s.total) + '% of all tickets')}
        ${mbox('Auto-generated tickets', num(s.auto), pct2(s.auto, s.total) + '% of all tickets')}
        ${mbox('Pending Customer tickets', num(s.custOpen), 'still open')}
        ${mbox('Pending Auto-generated tickets', num(s.autoOpen), 'still open')}
      </div>
      <div class="chart js-origin"></div>
    </div>`,
    mount(root) {
      chartDonut(q(root, '.js-origin'), [
        { label: 'Auto-generated', value: D.summary.auto, color: 'var(--s3)' },
        { label: 'Customer', value: D.summary.cust, color: 'var(--s1)' },
      ], { centreLabel: 'Tickets' });
    },
  });

  out.push({
    id: 's9', title: 'First response and resolution time distribution',
    /* The tag counts what the charts count: tickets raised AND solved inside
       the window, which is Explore's set. s.solved is every solved ticket
       raised in the window, and those two part company as soon as one of them
       is solved after the period closes. */
    sub: 'Time brackets · Zendesk clocks',
    tag: `${num(D.brackets.hasResponse ? D.brackets.responseTotal : s.solved)} solved in period`,
    ph: 'Speed story: how fast the team is replying and closing, and any outliers worth naming.',
    html: `<div style="${cols(340)}">
      ${card('First Response Time by Time Bracket', "Agent's first reply · solved tickets",
        '<div class="js-fr"></div>')}
      ${card('Target Restoration Time by Time Bracket',
        D.brackets.restoreFromZendesk ? 'Requester wait clock · solved tickets' : 'Created to solved',
        '<div class="js-restore"></div>')}
    </div>`,
    mount(root) {
      chartBracket(q(root, '.js-fr'), D.brackets.response, 'var(--s3)',
        { empty: 'No first-response data in the sheet yet.' });
      chartBracket(q(root, '.js-restore'), D.brackets.restore, 'var(--res-bar)');
    },
  });

  out.push({
    id: 's3', title: 'Ticket issue category summary', sub: `${D.cats.length} categories`, tag: period,
    ph: 'Which categories moved, and why.',
    html: `<div class="tblwrap"><table class="tbl">
      <thead><tr><th class="idx">#</th><th>Issue category</th><th class="num">No. of tickets</th>
        <th class="num">% of total</th>
        ${S.show.cats ? `<th class="num">L1 resolved</th><th class="num">L3 resolved</th>
          <th class="num">Pending on L1</th><th class="num">Pending on L3</th>
          <th class="num">Customer tickets</th><th class="num">Auto alert tickets</th>` : ''}</tr></thead>
      <tbody>${D.cats.map((c, i) => `<tr><td class="idx">${i + 1}</td><td class="lead">${esc(c.name)}</td>
        <td class="num" style="font-size:15.5px;font-weight:700">${num(c.total)}</td>
        <td class="num num--soft">${pct2(c.total, D.total)}%</td>
        ${S.show.cats ? `<td class="num">${c.l1Solved}</td><td class="num">${c.l3Solved}</td>
          <td class="num" style="${c.l1Open ? 'color:var(--warn-ink)' : ''}">${c.l1Open}</td>
          <td class="num" style="${c.l3Open ? 'color:var(--crit-ink)' : ''}">${c.l3Open}</td>
          <td class="num num--soft">${c.cust}</td><td class="num num--soft">${c.auto}</td>` : ''}
        </tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td>Total</td><td class="num" style="font-size:15.5px">${num(D.total)}</td>
        <td class="num">100.00%</td>
        ${S.show.cats ? `<td class="num">${num(D.cats.reduce((a, c) => a + c.l1Solved, 0))}</td>
          <td class="num">${num(D.cats.reduce((a, c) => a + c.l3Solved, 0))}</td>
          <td class="num">${num(D.cats.reduce((a, c) => a + c.l1Open, 0))}</td>
          <td class="num">${num(D.cats.reduce((a, c) => a + c.l3Open, 0))}</td>
          <td class="num">${num(s.cust)}</td><td class="num">${num(s.auto)}</td>` : ''}</tr></tfoot></table></div>
      <div class="moretog"><button class="btn btn--sm" data-toggle="cats">
        ${S.show.cats ? '− Hide the L1 / L3 breakdown' : '+ Show the L1 / L3 breakdown'}</button>
        <span>${S.show.cats ? 'Showing every column.' : 'Resolved, pending and origin columns are hidden.'}</span></div>`,
  });

  out.push({
    id: 's4', title: 'Customers by issue category', sub: 'Every account against every category',
    tag: `${D.customersShown.filter(c => c.total > 0).length} accounts · ${D.cats.length} categories`,
    ph: 'The accounts whose pattern is worth naming, and what is being done about them.',
    html: crossTab(),
  });

  out.push({
    id: 's5', title: 'Tickets by customer', sub: 'Top 10 accounts by volume', tag: period,
    ph: 'Account-level colour: who is driving volume, which sites need attention.',
    html: `<div class="js-cust"></div>
      ${S.show.custTable ? `<div class="tblwrap" style="margin-top:20px"><table class="tbl">
        <thead><tr><th>Customer</th><th class="num">Tickets</th><th class="num">Share</th>
          <th class="num">Solved</th><th class="num">Open</th><th class="num">Escalated</th><th class="num">Robots</th></tr></thead>
        <tbody>${D.customersShown.slice(0, 10).map(c => `<tr><td class="lead">${esc(c.name)}</td>
          <td class="num">${num(c.total)}</td><td class="num num--soft">${pct2(c.total, D.total)}%</td>
          <td class="num">${num(c.solved)}</td>
          <td class="num" style="${c.open ? 'color:var(--crit-ink)' : ''}">${c.open}</td>
          <td class="num num--soft">${c.l3}</td>
          <td class="num num--soft">${c.robotCount}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="moretog"><button class="btn btn--sm" data-toggle="custTable">
        ${S.show.custTable ? '− Hide the account table' : '+ Show the account table'}</button>
        <span>${S.show.custTable ? 'Solved, open, escalated and robot counts.' : 'Chart only.'}</span></div>`,
    mount(root) {
      chartBars(q(root, '.js-cust'), D.customersShown.slice(0, 10).map(c => ({
        label: c.name, value: c.total, sub: `${pct1(c.total, D.total)}%`,
        tip: `<div>${esc(c.name)}</div><b>${c.total}</b> tickets · ${c.open} open · ${c.robotCount} robots`,
      })), { labelWidth: '215px', gap: '9px' });
    },
  });

  out.push({
    id: 's6', title: 'Shift-wise load', sub: 'Ticket arrival by shift window · IST', tag: `${num(D.total)} tickets`,
    ph: 'Staffing commentary — whether coverage matches where the volume actually lands.',
    html: `<div class="tblwrap"><table class="tbl">
        <thead><tr><th>#</th><th>Shift name</th><th class="num">Ticket count</th>
          <th class="num">Percentage</th><th class="num">Resolved</th><th class="num">Resolution rate</th></tr></thead>
        <tbody>${D.shifts.map((x, i) => `<tr><td style="color:var(--ink3)">${i + 1}</td>
          <td><b>${x.name}</b> <span style="color:var(--ink3)">(${x.time})</span></td>
          <td class="num">${num(x.tickets)}</td><td class="num">${pct2(x.tickets, D.total)}%</td>
          <td class="num">${num(x.solved)}</td><td class="num">${pct1(x.solved, x.tickets)}%</td></tr>`).join('')}</tbody>
        <tfoot><tr><td></td><td>Total</td><td class="num">${num(D.total)}</td>
          <td class="num">100.00%</td><td class="num">${num(s.solved)}</td>
          <td class="num">${pct1(s.solved, D.total)}%</td></tr></tfoot></table></div>`,
  });

  out.push({
    id: 's7', title: 'Hourly ticket volume analysis', sub: 'Arrival hour · IST', tag: `${num(D.total)} tickets`,
    ph: 'Peak-window read for the client: what it means for coverage and for the PST-side handover.',
    html: `<div class="chart js-hours"></div>${hourNarrative()}`,
    mount(root) { chartHours(q(root, '.js-hours'), D.byHour, D.peak, { height: 300 }); },
  });

  if (s.open) out.push({
    id: 's8', title: 'Unresolved tickets aging distribution', sub: `Age measured at ${fmtDate(D.ageAt)}`,
    tag: `${num(s.open)} open`,
    ph: 'Why the oldest tickets are still open and what is being done about them.',
    html: `<div style="${cols(250)}">
      ${card('Overall tickets aging distribution', `${num(s.open)} tickets`, '<div class="js-age-all"></div>')}
      ${card('L1 tickets aging distribution', `${num(s.l1Open)} tickets`, '<div class="js-age-l1"></div>')}
      ${card('L3 Engineering Queue Aging', `${num(s.l3Open)} tickets`, '<div class="js-age-l3"></div>')}
    </div>`,
    mount(root) {
      const mk = (sel, key, empty) => chartBars(q(root, sel), D.age.filter(a => a[key] > 0)
        .map((a, i) => ({ label: a.label, value: a[key], color: ORD[Math.min(i, ORD.length - 1)] })),
        { labelWidth: '86px', gap: '9px', empty });
      mk('.js-age-all', 'all', 'Nothing open.');
      mk('.js-age-l1', 'l1', 'Nothing open at L1.');
      mk('.js-age-l3', 'l3', 'Nothing open at L3.');
    },
  });

  /* 10 — the Explore SLA panel, box for box */
  out.push({
    id: 's10', title: 'SLA compliance', sub: period,
    tag: `${num(sla.frClocks)} response · ${num(sla.resClocks)} resolution clocks finished`,
    ph: 'The SLA read in your words — targets in force, and anything the raw compliance number does not explain.',
    html: `
      <div class="mgrid" style="margin-bottom:16px">
        ${mbox('First Response SLA Compliance %', pct1(sla.frClocks - sla.fr, sla.frClocks) + '%')}
        ${mbox('First Response SLA breached tickets', num(sla.fr))}
        ${mbox('Resolution SLA Compliance %', pct1(sla.resClocks - sla.res, sla.resClocks) + '%')}
        ${mbox('Resolution SLA breached tickets - L1', num(resL1))}
        ${mbox('Resolution SLA breached tickets - L3', num(resL3))}
      </div>
      <div class="mgrid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin-bottom:12px">
        ${mbox('1st Response SLA breached - Customer Tickets', num(sla.frCust))}
        ${mbox('L1 Customer tickets - Resolution SLA breached', num(sla.resL1Cust))}
        ${mbox('L3 Customer tickets - Resolution SLA breached', num(sla.resL3Cust))}
      </div>
      <div class="mgrid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
        ${mbox('1st Response SLA breached - Auto-generated tickets', num(sla.frAuto))}
        ${mbox('L1 Auto-generated tickets - Resolution SLA breached', num(sla.resL1Auto))}
        ${mbox('L3 Auto-generated tickets - Resolution SLA breached', num(sla.resL3Auto))}
      </div>`,
  });


  return out;
}

/* Commentary is written, not typed into a box: headings, bold, bullets and
   numbers, three sizes and three faces. It is kept as HTML in this browser,
   the same place the plain text used to live. */
const NOTE_TOOLS = `
  <button type="button" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
  <button type="button" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
  <button type="button" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
  <span class="note__sep"></span>
  <button type="button" data-cmd="insertUnorderedList" title="Bullet list">&#8226;</button>
  <button type="button" data-cmd="insertOrderedList" title="Numbered list">1.</button>
  <span class="note__sep"></span>
  <select data-cmd="formatBlock" title="Style">
    <option value="">Style</option><option value="p">Body</option>
    <option value="h3">Heading</option><option value="h4">Subheading</option>
  </select>
  <select data-cmd="fontSize" title="Size">
    <option value="">Size</option><option value="2">Small</option>
    <option value="3">Normal</option><option value="5">Large</option>
  </select>
  <select data-cmd="fontName" title="Font">
    <option value="">Font</option><option value="inherit">Default</option>
    <option value="Georgia, 'Times New Roman', serif">Serif</option>
    <option value="ui-monospace, Menlo, Consolas, monospace">Mono</option>
  </select>
  <span class="note__sep"></span>
  <button type="button" data-cmd="removeFormat" title="Clear formatting">&#10005;</button>`;

/* Whatever is stored gets rendered, so nothing executable goes back in. */
function cleanNote(html) {
  return String(html == null ? '' : html)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'>]*/gi, '');
}

/* Notes written before this were plain text; keep their line breaks. */
function noteMarkup(v) {
  const t = String(v == null ? '' : v);
  return /<[a-z][\s\S]*>/i.test(t) ? cleanNote(t) : esc(t).replace(/\n/g, '<br>');
}

/* The deck and the PDF want words, not tags. */
function noteText(v) {
  const t = String(v == null ? '' : v);
  if (!/<[a-z][\s\S]*>/i.test(t)) return t.trim();
  const d = document.createElement('div');
  d.innerHTML = cleanNote(t);
  d.querySelectorAll('li').forEach(li => li.insertAdjacentText('afterbegin', '• '));
  d.querySelectorAll('li, p, div, h3, h4, br, tr').forEach(el => el.insertAdjacentText('beforeend', '\n'));
  return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

function noteHTML(id, ph) {
  return `<div class="note" data-note="${id}">
    <div class="note__head">✎ Commentary — yours to write</div>
    <div class="note__bar">${NOTE_TOOLS}</div>
    <div class="note__body" contenteditable="true" data-ph="${esc(ph)}">${noteMarkup(NOTES[noteKey(id)])}</div></div>`;
}

function wireNotes(scope) {
  scope.querySelectorAll('.note[data-note]').forEach(box => {
    const body = box.querySelector('.note__body[contenteditable]');
    if (!body) return;

    const save = () => {
      NOTES[noteKey(box.dataset.note)] = cleanNote(body.innerHTML).trim();
      saveNotes(NOTES);
    };
    /* A toolbar click moves focus, and the browser drops the selection with
       it, so remember where the caret was and put it back before acting. */
    let mark = null;
    const remember = () => {
      const sel = getSelection();
      if (sel && sel.rangeCount && body.contains(sel.anchorNode)) mark = sel.getRangeAt(0).cloneRange();
    };
    ['keyup', 'mouseup', 'input', 'blur'].forEach(ev => body.addEventListener(ev, remember));
    body.addEventListener('input', save);
    body.addEventListener('blur', save);
    body.addEventListener('paste', e => {
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, t);
    });

    const run = (cmd, value) => {
      body.focus();
      if (mark) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(mark); }
      document.execCommand(cmd, false, value);
      remember();
      save();
    };
    box.querySelectorAll('.note__bar [data-cmd]').forEach(ctl => {
      if (ctl.tagName === 'SELECT') {
        ctl.addEventListener('change', () => {
          if (ctl.value) run(ctl.dataset.cmd, ctl.dataset.cmd === 'formatBlock' ? '<' + ctl.value + '>' : ctl.value);
          ctl.selectedIndex = 0;
        });
      } else {
        ctl.addEventListener('mousedown', e => e.preventDefault());   // keep the selection
        ctl.addEventListener('click', () => run(ctl.dataset.cmd, null));
      }
    });
  });
}
function secHTML(sec, i, withNote) {
  return `<section class="sec" data-sec="${sec.id}">
    <div class="sec__head">
      <span class="sec__no">${String(i + 1).padStart(2, '0')}</span>
      <div><div class="sec__title">${sec.title}</div>${sec.sub ? `<div class="sec__sub">${sec.sub}</div>` : ''}</div>
      ${sec.tag ? `<span class="sec__tag">${sec.tag}</span>` : ''}
    </div>
    <div class="sec__body">${sec.html}${withNote ? noteHTML(sec.id, sec.ph) : noteStatic(sec.id)}</div>
  </section>`;
}
function noteStatic(id) {
  const v = noteMarkup(NOTES[noteKey(id)]).trim();
  return v ? `<div class="note"><div class="note__body">${v}</div></div>` : '';
}

/* "Live" used to be the browser's own clock, which says nothing: if the
   sync had not run for six hours the sidebar still read Live and the current
   time. This is the age of the DATA — when Apps Script last built the feed —
   and it goes amber once that is more than an hour old, because the sync runs
   every fifteen minutes and an hour means something is wrong. */
function freshness() {
  const made = FEED.meta && FEED.meta.generated ? new Date(FEED.meta.generated) : null;
  if (!made || isNaN(made.getTime())) {
    return `<div style="display:flex;align-items:center;gap:7px"><span class="livedot"></span>
      <span>Live</span></div>`;
  }
  const mins = Math.max(0, Math.round((Date.now() - made.getTime()) / 60000));
  const stale = mins > 60;
  const when = made.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ago = mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago'
            : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' d ago';
  return `<div style="display:flex;align-items:center;gap:7px"
       title="The sheet was last synced at ${esc(when)}">
      <span class="livedot"${stale ? ' style="background:var(--warn)"' : ''}></span>
      <span${stale ? ' style="color:var(--warn)"' : ''}>Synced ${esc(when)} · ${esc(ago)}</span></div>`;
}

function viewReview() {
  const secs = reviewSections();
  $('#content').innerHTML = `<div class="review">
    <div class="rhead">
      <div><h2>Skild-Fetch &lt;&gt; Awign · Call Support Operations Review</h2>
        <p>${fmtDate(D.from)} – ${fmtDate(D.to)} · ${num(D.total)} tickets</p></div>
    </div>
    ${secs.map((sec, i) => secHTML(sec, i, true)).join('')}
  </div>`;
  secs.forEach(sec => {
    if (sec.mount) sec.mount(document.querySelector(`[data-sec="${sec.id}"] .sec__body`));
  });
  wireNotes($('#content'));
  wireToggles($('#content'));
  revealOn($('#content'));
}

function wireToggles(scope) {
  scope.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    S.show[k] = !S.show[k];
    const y = scrollY;
    if (PRESENT) { const s = PRESENT.box.scrollTop; endPresent(); startPresent(); PRESENT.box.scrollTop = s; }
    else { render(); scrollTo(0, y); }
  }));
}

/* sections settle in as they come into view — M3 emphasised decelerate */
let REVEAL_IO = null;
function revealOn(scope) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (REVEAL_IO) REVEAL_IO.disconnect();
  REVEAL_IO = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('reveal--in');
      REVEAL_IO.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: .04 });
  scope.querySelectorAll('.sec, .rhead').forEach((n, i) => {
    n.classList.add('reveal');
    n.style.animationDelay = Math.min(i, 3) * 40 + 'ms';
    REVEAL_IO.observe(n);
  });
}

/* ── presentation mode — one continuous full-screen document ─────────── */
/* A deck build appends a hidden <a> to the body and removes it when the file
   is saved. Re-rendering in between destroys that anchor and the generator
   throws, so every path that rewrites the body waits for the export. */
let EXPORTING = false;

let PRESENT = null;
function startPresent() {
  const secs = reviewSections();
  const box = document.createElement('div');
  box.className = 'present';
  box.innerHTML = `<button class="btn present__exit" id="pexit">✕ Exit</button>
    <div class="present__inner">
      <div class="pcover">
        <h1>Skild-Fetch &lt;&gt; Awign</h1>
        <p class="pcover__period">${fmtDate(D.from)} – ${fmtDate(D.to)}</p>
        <p class="pcover__line">Call Support Operations — Performance Review</p>
        <div class="pcover__org">Awign Enterprises</div>
      </div>
      ${secs.map((sec, i) => secHTML(sec, i, false)).join('')}
      <div class="present__end">AWIGN ENTERPRISES · END OF REVIEW</div>
    </div>`;
  document.body.appendChild(box);
  PRESENT = { box, secs };
  secs.forEach(sec => {
    if (sec.mount) sec.mount(box.querySelector(`[data-sec="${sec.id}"] .sec__body`));
  });
  wireToggles(box);
  const fs = box.requestFullscreen || box.webkitRequestFullscreen;
  if (fs) { try { const r = fs.call(box); if (r && r.catch) r.catch(() => {}); } catch {} }
  box.querySelector('#pexit').addEventListener('click', endPresent);
  document.addEventListener('keydown', presentKeys);
}
function endPresent() {
  if (!PRESENT) return;
  document.removeEventListener('keydown', presentKeys);
  PRESENT.box.remove(); PRESENT = null;
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch {} }
}
function presentKeys(e) {
  if (PRESENT && e.key === 'Escape') endPresent();
}

/* ── render ──────────────────────────────────────────────────────────── */
function render() {
  const r = S.range || { from: bounds.from, to: bounds.to };
  D = derive(r.from, r.to);
  const pv = prevPeriod(r.from, r.to);
  P = pv ? { from: pv.from, to: pv.to, whole: pv.whole, d: derive(pv.from, pv.to), days: daysBetween(r.from, r.to) + 1 } : null;
  shell();
  if (EMBED || S.view === 'review') viewReview(); else viewOverview();
}
function boot() { render(); }

let rT;
addEventListener('resize', () => {
  clearTimeout(rT);
  rT = setTimeout(() => { if (!PRESENT && !EXPORTING && S.user) render(); }, 180);
});

/* The dashboard around us owns the date filter and the theme. */
if (EMBED) {
  addEventListener('message', e => {
    if (e.source !== parent || !e.data || e.data.type !== 'skild:review') return;
    const { from, to, theme } = e.data;
    if (theme) document.documentElement.dataset.theme = theme;
    if (from && to) S.range = { from, to };
    if (!PRESENT && !EXPORTING) render();
  });
}

/* embed.js has already fetched the feed. */
S.user = window.__USER || { name: '', role: '' };
boot();
