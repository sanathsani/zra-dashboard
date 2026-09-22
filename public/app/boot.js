/* =========================================================================
   boot — authentication gate, live feed, then the app
   -------------------------------------------------------------------------
   Nothing else loads until both of these are true:
     1. the visitor signed in, and Vercel handed back a signed session token;
     2. /api/data answered with the ticket feed for that token.

   The password is never checked in the browser and the Apps Script key never
   reaches it. api/auth.js verifies the password server-side against the Users
   tab of Shift Data Tracking; api/data.js refuses to proxy the feed without
   the token it issued.
   ========================================================================= */

const SESSION_KEY = 'skild.session.v1';

const AUTH = {
  get() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return s && s.token && s.exp > Date.now() ? s : null;
    } catch { return null; }
  },
  set(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} },
  clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} },
};

window.SkildAuth = {
  signOut() { AUTH.clear(); location.reload(); },
};

/* ── screens ──────────────────────────────────────────────────────────── */

const esc0 = s => String(s == null ? '' : s)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function screenBusy(msg) {
  document.body.innerHTML = `
  <div class="gate">
    <div class="gate__card" style="text-align:center">
      <div class="gate__mark">SA</div>
      <h1>Skild AI</h1>
      <p>${esc0(msg)}</p>
      <div class="boot__bar"><i></i></div>
    </div>
  </div>`;
}

function screenError(title, detail, retry) {
  document.body.innerHTML = `
  <div class="gate">
    <div class="gate__card">
      <div class="gate__mark">SA</div>
      <h1>Skild AI</h1>
      <div class="gate__err">${esc0(title)}</div>
      <p style="text-align:left">${esc0(detail)}</p>
      <button class="btn btn--primary" id="again" type="button"
        style="width:100%;justify-content:center;margin-top:10px">Try again</button>
    </div>
  </div>`;
  document.getElementById('again').addEventListener('click', retry);
}

function screenGate(msg, keep) {
  document.body.innerHTML = `
  <div class="gate">
    <form class="gate__card" id="signin" autocomplete="off">
      <div class="gate__mark">SA</div>
      <h1>Skild AI</h1>
      <p>Customer Excellence Center · support operations</p>
      ${msg ? `<div class="gate__err" style="text-align:left;line-height:1.6">${esc0(msg)}</div>` : ''}
      <div class="field"><label for="em">Work email</label>
        <input id="em" type="email" autocomplete="username" placeholder="you@awign.com"
               value="${esc0((keep && keep.email) || '')}"></div>
      <div class="field"><label for="pw">Password</label>
        <input id="pw" type="password" autocomplete="current-password" placeholder="••••••••"></div>
      <button class="btn btn--primary" id="go" type="button"
        style="width:100%;justify-content:center;margin-top:8px">Sign in</button>
      <div class="gate__foot">
        Accounts live on the <b>Users</b> tab of the Shift Data Tracking sheet.
        Your password is checked on the server — it is never compared in this page,
        and the ticket feed stays closed until it passes.
      </div>
    </form>
  </div>`;

  const go = document.getElementById('go');
  const submit = async () => {
    const em = (document.getElementById('em').value || '').trim().toLowerCase();
    const pw = (document.getElementById('pw').value || '').trim();
    if (!em || !pw) return screenGate('Enter both your email and your password.', { email: em });
    go.disabled = true;
    go.textContent = 'Checking…';
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, password: pw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.token) return screenGate(j.error || 'That email and password did not match.', { email: em });
      AUTH.set(j);
      start();
    } catch (err) {
      screenGate('Could not reach the sign-in service: ' + (err && err.message ? err.message : String(err)), { email: em });
    }
  };

  go.addEventListener('click', submit);
  document.getElementById('signin').addEventListener('submit', e => { e.preventDefault(); submit(); });
  ['em', 'pw'].forEach(id => document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
  }));
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
    cols, tickets, sla, agents,
  };
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

let STARTED = false;

async function start() {
  const session = AUTH.get();
  if (!session) return screenGate();

  screenBusy('Loading the latest tickets…');
  let payload;
  try {
    const r = await fetch('/api/data', { headers: { Authorization: 'Bearer ' + session.token } });
    if (r.status === 401) { AUTH.clear(); return screenGate('Your session expired. Sign in again.'); }
    payload = await r.json();
    if (!r.ok || !payload || !payload.data) {
      return screenError('The ticket feed did not answer.',
        (payload && payload.error) || ('HTTP ' + r.status) +
        ' — the Apps Script web app is probably serving an older deployment, or FEED_KEY does not match. ' +
        'Nothing is lost; the sheet and the sync are untouched.', start);
    }
  } catch (err) {
    return screenError('Could not reach the ticket feed.',
      (err && err.message ? err.message : String(err)) + ' — check your connection and try again.', start);
  }

  window.__FEED = toFeed(payload.data);
  window.__USER = session.user;

  if (!window.__FEED.tickets.length) {
    return screenError('The feed came back empty.',
      'The sheet returned no ticket rows. Check that "All tickets Info" has data below the header rows.', start);
  }

  if (STARTED) return location.reload();
  STARTED = true;

  // Clear the loading screen and give views.js the container it renders into.
  // It appends to the body rather than replacing it, so this has to go first.
  document.body.innerHTML = '<div id="app-root"></div>';

  try {
    for (const f of APP_FILES) await loadScript('/app/' + f);
  } catch (err) {
    screenError('The dashboard could not finish loading.', err.message, () => location.reload());
  }
}

try { document.documentElement.dataset.theme = localStorage.getItem('skild.theme') || 'light'; } catch {}
start();
