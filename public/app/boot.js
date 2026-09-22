/* =========================================================================
   boot — starts the embedded Client Review
   -------------------------------------------------------------------------
   This page is loaded in an iframe by src/pages/Review.jsx, so the dashboard
   keeps its sidebar, its topbar and its single date filter, and the review
   renders inside the content area with its own stylesheet fully isolated.

   The dashboard has already signed the visitor in; this reads the same session
   token and uses it to fetch the feed. The range and the theme arrive by
   postMessage whenever the dashboard's filter moves.
   ========================================================================= */

const SESSION_KEY = 'skild.session.v1';

function session() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return s && s.token && s.exp > Date.now() ? s : null;
  } catch { return null; }
}

const esc0 = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function screenBusy(msg) {
  document.body.innerHTML =
    `<div class="embed__msg"><div class="boot__bar"><i></i></div><p>${esc0(msg)}</p></div>`;
}

function screenError(msg) {
  document.body.innerHTML =
    `<div class="embed__msg"><p><b>The review could not load.</b></p><p>${esc0(msg)}</p>
     <button class="btn" id="again" type="button">Try again</button></div>`;
  document.getElementById('again').addEventListener('click', () => location.reload());
}

/* ── feed shape ───────────────────────────────────────────────────────── */

/* The sheet spells a few categories differently from the deck. */
const CAT_FIX = {
  'Battery and Charging': 'Battery & Charging',
  'Software or Firmware': 'Software / Firmware',
  'Fleet or Site Issues': 'Fleet / Site Issues',
  'Other': 'Others',
  'Test Tickets': 'Test',
};

/* Feed.gs speaks in objects; core.js reads a columnar table with interned
   strings, which is what keeps a 1,500-row filter instant. Translate once. */
function toFeed(d) {
  const customers = [], owners = [], cats = [], robots = [];
  const idx = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) return i; arr.push(v); return arr.length - 1; };
  const bare = s => String(s == null ? '' : s).replace(/^#/, '').trim();

  const src = d.rows || [];
  const hasResponse = src.some(r => r.response != null && r.response !== '');
  const hasRestore  = src.some(r => r.restoration != null && r.restoration !== '');

  const cols = ['id', 'created', 'solved', 'cust', 'owner', 'lvl', 'status', 'cat', 'auto', 'robot', 'subject'];
  if (hasResponse) cols.push('response');
  if (hasRestore)  cols.push('restore');

  const tickets = [];
  for (const r of src) {
    const st = r.status === 'solved' ? 0 : r.status === 'pending' ? 1 : 2;
    const cat = String(r.type || '').trim();
    const t = [
      bare(r.id),
      r.dt || '',
      r.solved || '',
      idx(customers, String(r.customer || 'Unknown').trim()),
      idx(owners, String(r.owner || 'Unassigned').trim()),
      String(r.level || '').trim().toUpperCase() === 'L3' ? 1 : 0,
      st,
      idx(cats, CAT_FIX[cat] || cat || 'Uncategorised'),
      r.autoAlert ? 1 : 0,
      r.robot_id ? idx(robots, String(r.robot_id)) : -1,
      String(r.issue || '').slice(0, 110),
    ];
    if (hasResponse) t.push(r.response == null ? '' : r.response);
    if (hasRestore)  t.push(r.restoration == null ? '' : r.restoration);
    tickets.push(t);
  }

  const sla = (d.sla || []).map(s => ({
    id: bare(s.id), created: s.dt || '', breach: s.breachType || '',
    requester: s.requester || '', site: s.customer || '', robot: s.robot_id || '',
    summary: s.issue || '', category: s.type || '', sub: s.sub || '',
    incident: s.incidentType || '', priority: s.priority || '', channel: s.channel || '',
    l1: s.owner || '', l3: s.l3owner || '',
    frTarget: s.responseTarget || '', frActual: s.responseActual || '', frSla: s.responseSla || '',
    resTarget: s.resolutionTarget || '', resActual: s.resolutionActual || '', resSla: s.resolutionSla || '',
    status: s.status || '', rca: s.rootCause || '',
  }));

  /* SLA clocks, one row per ticket: [id, 'M'|'B'|'', finished, 'M'|'B'|'',
     finished]. The SLA window filters on THESE dates. Zendesk's SLA reports
     ask when a target finished, not when the ticket was raised — a ticket
     raised on the 6th that breaches on the 8th belongs to the 8th. */
  const clocks = (d.clocks || []).map(c => ({
    id: bare(c[0]),
    fr: c[1] || '', frAt: c[2] || '',
    res: c[3] || '', resAt: c[4] || '',
    replyMin: c[5] == null ? null : Number(c[5]),
    waitMin:  c[6] == null ? null : Number(c[6]),
  }));

  const agents = (d.roster || []).map(a => ({
    name: a.name, status: a.active ? 'Active' : 'Inactive', role: a.role || 'Agent',
  }));

  const days = tickets.map(t => String(t[1]).slice(0, 10)).filter(Boolean).sort();

  return {
    meta: {
      generated: (d.meta && d.meta.generated) || new Date().toISOString(),
      source: 'Shift Data Tracking · live',
      dateFrom: (d.meta && d.meta.dateFrom) || days[0] || '',
      dateTo: (d.meta && d.meta.dateTo) || days[days.length - 1] || '',
    },
    dict: { customers, owners, cats, robots },
    cols, tickets, sla, clocks, agents,
  };
}

/* ── getting the feed ─────────────────────────────────────────────────── */

/* The dashboard around this iframe has already loaded the feed. Ask it for a
   copy instead of pulling the same payload through Apps Script a second time:
   that second fetch was half the waiting and half the timeouts. Returns null
   if this page was opened on its own, or if the dashboard cannot answer. */
function askDashboard(ms) {
  return new Promise(resolve => {
    if (parent === window) return resolve(null);
    let settled = false;
    const finish = v => {
      if (settled) return;
      settled = true;
      removeEventListener('message', onMsg);
      resolve(v);
    };
    function onMsg(e) {
      if (e.source !== parent || e.origin !== location.origin) return;
      if (!e.data || e.data.type !== 'skild:feed' || !e.data.data) return;
      finish(e.data);
    }
    addEventListener('message', onMsg);
    const ask = () => parent.postMessage({ type: 'skild:review', want: 'feed' }, location.origin);
    ask();
    // This frame can start before the dashboard has attached its listener, so
    // ask a few more times before falling back to a fetch of our own.
    const again = setInterval(() => (settled ? clearInterval(again) : ask()), 600);
    setTimeout(() => { clearInterval(again); finish(null); }, ms);
  });
}

/* The fallback path, for /review.html opened directly. Reads the body as text
   first: when the serverless function times out, Vercel answers with an HTML
   error page, and JSON.parse on that produced the "Unexpected token '<'"
   message that told nobody anything. */
async function fetchFeed(token) {
  const r = await fetch('/api/data', { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) return { signedOut: true };

  const text = await r.text();
  if (text.trim().charAt(0) === '<') {
    throw new Error('The ticket feed took too long to answer. It is usually ready a few seconds later.');
  }
  let body;
  try {
    body = JSON.parse(text.replace(/^\/\*[^*]*\*\/\s*/, ''));
  } catch {
    throw new Error('The ticket feed sent something that was not data (HTTP ' + r.status + ').');
  }
  if (!r.ok || !body || !body.data) {
    throw new Error((body && body.error) || ('The ticket feed answered HTTP ' + r.status + '.'));
  }
  return body;
}

/* ── start ────────────────────────────────────────────────────────────── */

const APP_FILES = ['core.js', 'charts.js', 'export.js', 'views.js'];

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

(async function start() {
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');

  const s = session();
  if (!s) {
    // The dashboard owns sign-in; tell it rather than showing a second gate.
    parent.postMessage({ type: 'skild:review', signedOut: true }, location.origin);
    return screenError('Your session has expired. The dashboard will ask you to sign in again.');
  }

  screenBusy('Loading the latest tickets\u2026');

  let data = null, range = null;
  const handed = await askDashboard(12000);
  if (handed) {
    data = handed.data;
    range = handed.range || null;
    if (handed.theme) document.documentElement.dataset.theme = handed.theme;
  } else {
    // Opened on its own, or the dashboard had nothing to give. Fetch it, and
    // try once more before giving up — a cold Apps Script cache is slow only
    // the first time.
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        const body = await fetchFeed(s.token);
        if (body.signedOut) {
          parent.postMessage({ type: 'skild:review', signedOut: true }, location.origin);
          return screenError('Your session has expired.');
        }
        data = body.data;
      } catch (err) {
        if (attempt) return screenError(err && err.message ? err.message : String(err));
        screenBusy('The feed is taking a moment \u2014 trying again\u2026');
        await new Promise(r => setTimeout(r, 2500));
      }
    }
  }

  window.__FEED = toFeed(data);
  window.__USER = s.user;
  if (!window.__FEED.tickets.length) {
    return screenError('The feed returned no ticket rows.');
  }

  // The range the dashboard is showing, so the first paint already matches it.
  // The dashboard's own answer wins: after a reload of this frame the URL still
  // carries the range it was first opened with, which is why the date filter
  // sometimes snapped back to an old window.
  window.__RANGE = range ||
    ((q.get('from') && q.get('to')) ? { from: q.get('from'), to: q.get('to') } : null);

  document.body.innerHTML = '<div id="app-root"></div>';
  try {
    for (const f of APP_FILES) await loadScript('/app/' + f);
  } catch (err) {
    screenError(err.message);
  }
})();
