/**
 * ════════════════════════════════════════════════════════════════════════════
 * SKILD AI — DASHBOARD FEED          file: Feed.gs              version 1.0.0
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The one web endpoint for the React dashboard. REPLACES ZRA_WebApp.gs —
 * delete that file in the same step, or the two doGet definitions collide and
 * Apps Script silently keeps whichever loaded last.
 *
 * WHAT CHANGED FROM ZRA_WebApp.gs
 *   • Authenticated. doGet without the right ?key= returns 401 and no data.
 *   • 13 columns, not 11 — First Response (L) and Restoration (M) now reach
 *     the dashboard.
 *   • Customer names normalised here instead of in the sheet, so 1,530 rows of
 *     real data are never rewritten. "Inventive LLC"/"inventive", "Global
 *     Abrasives"/"Dynabrade", "Stoops Indy"/"Truck Country" each collapse to
 *     one customer.
 *   • Agent names trimmed, so "Manikesh " and "Manikesh" are one person.
 *   • Dates emitted as local time, not mislabelled as UTC. The old feed wrote
 *     "…T18:35:38Z" for an IST timestamp, so every browser shifted it 5.5h and
 *     tickets near midnight landed on the wrong day. See feedStamp().
 *   • Serves the SLA rows and the Config roster, which the old feed did not.
 *   • getActiveAgents() is gone. It tested `data[i][1] === true` against a
 *     Config column that holds the text "Active", so it always returned null.
 *
 * REUSES, does not redefine: activeSS, ticketsSheet, COL, HEADER_ROWS,
 * LAST_COL, RCA_SHEET, RCA_HEADERS, RCA_COL, normKey (SkildConsole.gs) and
 * getConfigData (Code.gs).
 *
 * SETUP
 *   1. Project Settings → Script Properties → add FEED_KEY, a long random
 *      string. Generate one by running feedMakeKey() and copying the log.
 *   2. Deploy → New deployment → Web app → Execute as: Me →
 *      Who has access: Anyone. Copy the /exec URL.
 *   3. In Vercel, set env var FEED_KEY to the same string, and update
 *      api/data.js (see feedClientPatch() for the exact three lines).
 *   4. Run feedSelfTest() to see the payload the dashboard will receive.
 *
 * WHY "Anyone" is still safe: the token is checked before any data is read,
 * and it never reaches the browser — api/data.js runs server-side on Vercel
 * and appends it there. A stranger with the /exec URL gets 401.
 * ════════════════════════════════════════════════════════════════════════════
 */

var FEED_VERSION = '1.0.0';

/**
 * Every spelling of a customer that has appeared in column C, mapped to the
 * one name the dashboard shows. Matching ignores case, punctuation and a
 * trailing "inc"/"llc", so new variants of an existing customer usually fold
 * in without an edit here.
 */
var CUSTOMER_ALIASES = {
  'inventive':                  'Inventive LLC',
  'inventivellc':               'Inventive LLC',
  'globalabrasives':            'Global Abrasives, INC',
  'dynabrade':                  'Global Abrasives, INC',
  'stoopsindy':                 'Truck Country',
  'truckcountry':               'Truck Country',
  'dormanproducts':             'DORMAN PRODUCTS',
  'geappliances':               'GE APPLIANCES',
  'garmininternational':        'GARMIN INTERNATIONAL, INC.',
  'arrowelectronics':           'Arrow Electronics, Inc.',
  'vwrinternational':           'VWR International',
  'cevabosch':                  'Ceva Bosch',
  'gategourmet':                'Gate Gourmet',
  'g10':                        'G10 Inc.',
  'meyertool':                  'Meyer Tool, Inc.',
  'stuller':                    'Stuller, Inc',
  'appleinc':                   'Apple Inc',
  'honeywellaerospace':         'Honeywell Aerospace'
};

/**
 * Never shown as a customer anywhere — no table row, no matrix column, no pie
 * slice. Their tickets still count in every total, which is the rule already
 * locked in for "Other". Skild is our own organisation, not a customer.
 */
var HIDDEN_CUSTOMERS = { 'other': 1, 'others': 1, 'skild': 1, 'unknown': 1, '': 1 };

/** Shift windows, in minutes past midnight, script timezone. */
var SHIFTS = [
  { label: 'S1', name: 'Morning',   time: '7:30AM–3:30PM',  from: 450,  to: 930  },
  { label: 'S2', name: 'Afternoon', time: '3:30PM–12:00AM', from: 930,  to: 1440 },
  { label: 'S3', name: 'Night',     time: '12:00AM–7:30AM', from: 0,    to: 450  }
];

// ═══════════════════════════════════════════════════════════════════════════
// THE ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

function doGet(e) {
  var key = (e && e.parameter && e.parameter.key) || '';
  var want = PropertiesService.getScriptProperties().getProperty('FEED_KEY');

  if (!want) {
    return feedJson({ ok: false, error: 'FEED_KEY is not set on this script.' });
  }
  if (key !== want) {
    // Same message whether the key is missing or wrong — nothing to probe.
    return feedJson({ ok: false, code: 401, error: 'Unauthorized' });
  }

  try {
    return feedJson({ ok: true, role: 'internal', data: feedPayload() });
  } catch (err) {
    return feedJson({ ok: false, error: String((err && err.message) || err) });
  }
}

function feedJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALISATION — the reason the sheet never has to be rewritten
// ═══════════════════════════════════════════════════════════════════════════

/** "Inventive LLC", "inventive llc", "Inventive, LLC." -> one key. */
function feedKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(inc|llc|ltd|corp|co)$/, '');
}

/** The one name the dashboard shows, plus whether it may be shown at all. */
function feedCustomer(raw) {
  var name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  var key  = feedKey(name);
  var canonical = CUSTOMER_ALIASES[key] || name || 'Unknown';
  var hidden = !!HIDDEN_CUSTOMERS[String(canonical).toLowerCase().trim()];
  return { name: canonical, hidden: hidden };
}

/** Trailing spaces make a second agent out of one person. */
function feedAgent(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
}

/**
 * A local timestamp with NO trailing Z. A browser parses "2026-06-12T18:35:38"
 * as local time, which is what the sheet holds; the old feed's trailing Z made
 * every browser subtract its own offset and move late-evening tickets a day.
 */
function feedStamp(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}

function feedStatus(raw) {
  var s = String(raw == null ? '' : raw).toLowerCase().trim();
  if (s === 'closed') return 'solved';
  return s || 'unknown';
}

function feedShift(d) {
  var mins = d.getHours() * 60 + d.getMinutes();
  for (var i = 0; i < SHIFTS.length; i++) {
    if (mins >= SHIFTS[i].from && mins < SHIFTS[i].to) return SHIFTS[i].label;
  }
  return 'S3';
}

function feedRobotId(issue) {
  if (!issue) return null;
  var patterns = [
    /freight100[\s\-]*(\d{4})/i,
    /AMR[\s\-]+(\d{4})/i,
    /\b100\s*[\-\s]\s*(\d{4})\b/i,
    /\brobot\s+(\d{4})\b/i
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m = String(issue).match(patterns[p]);
    if (m) return m[1];
  }
  return null;
}

function feedNum(v) {
  if (v === '' || v == null) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// ═══════════════════════════════════════════════════════════════════════════
// READING THE SHEET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One row per ticket, in the shape src/data.js documents, plus solved,
 * response and restoration. Rows with no date, or with neither an owner nor a
 * status, are dropped — that is how the two placeholder rows the extension
 * once left behind stay out of the counts.
 */
function feedRows() {
  var sheet = ticketsSheet(activeSS());
  var n = sheet.getLastRow() - HEADER_ROWS;
  if (n < 1) return [];

  var grid = sheet.getRange(HEADER_ROWS + 1, 1, n, LAST_COL).getValues();
  var out = [];

  for (var i = 0; i < grid.length; i++) {
    var r = grid[i];
    var id = normKey(r[COL.TICKET - 1]);
    if (!id) continue;

    var created = r[COL.CREATED - 1];
    if (!(created instanceof Date)) created = new Date(created);
    if (isNaN(created.getTime())) continue;

    var owner  = feedAgent(r[COL.OWNER - 1]);
    var status = feedStatus(r[COL.STATUS - 1]);
    if (!owner && status === 'unknown') continue;        // placeholder row

    var solved = r[COL.SOLVED - 1];
    if (solved && !(solved instanceof Date)) solved = new Date(solved);
    if (solved && isNaN(solved.getTime())) solved = null;

    var issue = String(r[COL.SUMMARY - 1] || '').trim();
    var cust  = feedCustomer(r[COL.CUSTOMER - 1]);

    out.push({
      id:             '#' + id,
      dt:             feedStamp(created),
      customer:       cust.name,
      customerHidden: cust.hidden,
      owner:          owner || 'Unknown',
      escalated:      String(r[COL.ESCALATED - 1] || '').trim() || null,
      level:          String(r[COL.LEVEL - 1] || '').trim() || null,
      solved:         feedStamp(solved),
      status:         status,
      type:           String(r[COL.TYPE - 1] || '').trim() || 'Unknown',
      issue:          issue.substring(0, 300),
      remarks:        String(r[COL.REMARKS - 1] || '').trim().substring(0, 500),
      response:       feedNum(r[COL.RESPONSE - 1]),
      restoration:    feedNum(r[COL.RESTORATION - 1]),
      robot_id:       feedRobotId(issue),
      shift:          feedShift(created),
      autoAlert:      /^\s*automatic alert/i.test(issue)
    });
  }
  return out;
}

/** The breached tickets, straight off "SLA Breach - RCA". */
function feedSla() {
  var sh = activeSS().getSheetByName(RCA_SHEET);
  if (!sh) return [];
  var n = sh.getLastRow() - HEADER_ROWS;
  if (n < 1) return [];

  var grid = sh.getRange(HEADER_ROWS + 1, 1, n, RCA_HEADERS.length).getValues();
  return grid.filter(function (r) { return normKey(r[0]); }).map(function (r) {
    var created = r[1] instanceof Date ? r[1] : new Date(r[1]);
    return {
      id:              '#' + normKey(r[0]),
      dt:              feedStamp(isNaN(created.getTime()) ? null : created),
      breachType:      String(r[2] || ''),
      requester:       String(r[3] || ''),
      customer:        feedCustomer(r[4]).name,
      robot_id:        String(r[5] || '') || null,
      issue:           String(r[6] || '').substring(0, 300),
      type:            String(r[7] || ''),
      sub:             String(r[8] || ''),
      incidentType:    String(r[9] || ''),
      priority:        String(r[10] || ''),
      channel:         String(r[11] || ''),
      owner:           feedAgent(r[12]),
      l3owner:         String(r[13] || ''),
      responseTarget:  String(r[14] || ''),
      responseActual:  String(r[15] || ''),
      responseSla:     String(r[16] || ''),
      resolutionTarget: String(r[17] || ''),
      resolutionActual: String(r[18] || ''),
      resolutionSla:   String(r[19] || ''),
      status:          String(r[20] || ''),
      rootCause:       String(r[21] || '')
    };
  });
}

/** Who is on the rota now, so the UI can show active agents only. */
function feedRoster() {
  try {
    var cfg = getConfigData();                       // from Code.gs
    var out = [];
    (cfg.active || []).forEach(function (n) {
      out.push({ name: feedAgent(n), role: cfg.roleOf[n.toLowerCase()] || 'Agent', active: true });
    });
    if (cfg.supervisor) {
      out.push({ name: feedAgent(cfg.supervisor), role: 'Supervisor', active: true });
    }
    (cfg.inactive || []).forEach(function (n) {
      out.push({ name: feedAgent(n), role: cfg.roleOf[n.toLowerCase()] || 'Agent', active: false });
    });
    return out;
  } catch (err) {
    return [];                                        // Config missing: not fatal
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PAYLOAD
// ═══════════════════════════════════════════════════════════════════════════

function feedPayload() {
  var rows = feedRows();

  var catMap = {}, agentMap = {}, custMap = {}, robotMap = {}, daily = {};
  var shiftMap = {};
  SHIFTS.forEach(function (s) { shiftMap[s.label] = { tickets: 0, resolved: 0 }; });

  var unsolved = [];
  var resolved = 0, pending = 0, inProgress = 0, l1 = 0, l3 = 0, autoAlert = 0;
  var responseCount = 0, restorationCount = 0;
  var minDt = null, maxDt = null;

  rows.forEach(function (r) {
    var dt = new Date(r.dt);
    if (!minDt || dt < minDt) minDt = dt;
    if (!maxDt || dt > maxDt) maxDt = dt;

    if      (r.status === 'solved')      resolved++;
    else if (r.status === 'pending')   { pending++;    unsolved.push(r); }
    else                               { inProgress++; unsolved.push(r); }

    if (r.level === 'L1') l1++; else if (r.level === 'L3') l3++;
    if (r.autoAlert) autoAlert++;
    if (r.response    != null) responseCount++;
    if (r.restoration != null) restorationCount++;

    var cat = r.type || 'Unknown';
    if (!catMap[cat]) catMap[cat] = { count: 0, resolved: 0, pending: 0, inProgress: 0 };
    catMap[cat].count++;
    if      (r.status === 'solved')  catMap[cat].resolved++;
    else if (r.status === 'pending') catMap[cat].pending++;
    else                             catMap[cat].inProgress++;

    var ag = r.owner || 'Unknown';
    if (!agentMap[ag]) agentMap[ag] = { total: 0, l1: 0, l3: 0, resolved: 0, pending: 0 };
    agentMap[ag].total++;
    if (r.level === 'L3') agentMap[ag].l3++; else agentMap[ag].l1++;
    if      (r.status === 'solved')  agentMap[ag].resolved++;
    else if (r.status === 'pending') agentMap[ag].pending++;

    var cu = r.customer;
    if (!custMap[cu]) custMap[cu] = {
      total: 0, l1: 0, l3: 0, resolved: 0, pending: 0, inProgress: 0,
      hidden: r.customerHidden, types: {}, robots: {}
    };
    custMap[cu].total++;
    if (r.level === 'L3') custMap[cu].l3++; else custMap[cu].l1++;
    if      (r.status === 'solved')  custMap[cu].resolved++;
    else if (r.status === 'pending') custMap[cu].pending++;
    else                             custMap[cu].inProgress++;
    custMap[cu].types[cat] = (custMap[cu].types[cat] || 0) + 1;
    if (r.robot_id) custMap[cu].robots[r.robot_id] = (custMap[cu].robots[r.robot_id] || 0) + 1;

    if (r.robot_id) {
      if (!robotMap[r.robot_id]) {
        robotMap[r.robot_id] = { id: r.robot_id, customer: cu, total: 0, types: {}, resolved: 0 };
      }
      robotMap[r.robot_id].total++;
      robotMap[r.robot_id].types[cat] = (robotMap[r.robot_id].types[cat] || 0) + 1;
      if (r.status === 'solved') robotMap[r.robot_id].resolved++;
    }

    shiftMap[r.shift].tickets++;
    if (r.status === 'solved') shiftMap[r.shift].resolved++;

    var day = r.dt.substring(0, 10);
    if (!daily[day]) daily[day] = { total: 0, resolved: 0, pending: 0, inProgress: 0 };
    daily[day].total++;
    if      (r.status === 'solved')  daily[day].resolved++;
    else if (r.status === 'pending') daily[day].pending++;
    else                             daily[day].inProgress++;
  });

  var robots = Object.keys(robotMap).map(function (k) { return robotMap[k]; })
                     .sort(function (a, b) { return b.total - a.total; });

  var anomalies = robots.filter(function (rb) { return rb.total >= 8; }).map(function (rb) {
    var top = Object.keys(rb.types).sort(function (a, b) { return rb.types[b] - rb.types[a]; })[0];
    return {
      robot_id: rb.id, customer: rb.customer, total: rb.total,
      top_type: top || null, top_count: top ? rb.types[top] : 0,
      level: rb.total >= 20 ? 'critical' : 'warning'
    };
  });

  return {
    meta: {
      generated:        new Date().toISOString(),
      feedVersion:      FEED_VERSION,
      role:             'internal',
      total:            rows.length,
      resolved:         resolved,
      pending:          pending,
      inProgress:       inProgress,
      l1:               l1,
      l3:               l3,
      autoAlert:        autoAlert,
      customerTicket:   rows.length - autoAlert,
      // Denominators for the two bracket cards. First Response covers only the
      // tickets that got a public agent reply; Restoration only solved ones.
      responseCount:    responseCount,
      restorationCount: restorationCount,
      dateFrom:         minDt ? feedStamp(minDt).substring(0, 10) : null,
      dateTo:           maxDt ? feedStamp(maxDt).substring(0, 10) : null
    },
    categories: Object.keys(catMap).map(function (k) {
      var o = catMap[k]; o.type = k; return o;
    }).sort(function (a, b) { return b.count - a.count; }),

    agents: Object.keys(agentMap).map(function (k) {
      var o = agentMap[k]; o.name = k; return o;
    }).sort(function (a, b) { return b.total - a.total; }),

    customers: Object.keys(custMap).map(function (k) {
      var o = custMap[k];
      o.name = k;
      o.robotCount = Object.keys(o.robots).length;
      return o;
    }).sort(function (a, b) { return b.total - a.total; }),

    shifts: SHIFTS.map(function (s) {
      return { label: s.label, name: s.name, time: s.time,
               tickets: shiftMap[s.label].tickets, resolved: shiftMap[s.label].resolved };
    }),

    daily:     daily,
    robots:    robots,
    anomalies: anomalies,
    unsolved:  unsolved,
    sla:       feedSla(),
    roster:    feedRoster(),
    rows:      rows
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP HELPERS — run these from the editor, they write nothing to the sheet
// ═══════════════════════════════════════════════════════════════════════════

/** Generates a key and stores it. Run once, then copy the log into Vercel. */
function feedMakeKey() {
  var bytes = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('FEED_KEY', bytes);
  Logger.log('FEED_KEY set on this script. Copy this into Vercel as FEED_KEY:\n\n' + bytes);
}

/** Prints the payload's headline numbers without deploying anything. */
function feedSelfTest() {
  var t = new Date().getTime();
  var d = feedPayload();
  var shown = d.customers.filter(function (c) { return !c.hidden; });
  var hidden = d.customers.filter(function (c) { return c.hidden; });

  Logger.log([
    'Skild AI feed ' + FEED_VERSION + '   built in ' + ((new Date().getTime() - t) / 1000) + 's',
    '  tickets            : ' + d.meta.total,
    '  solved / pending / in progress : ' +
      d.meta.resolved + ' / ' + d.meta.pending + ' / ' + d.meta.inProgress,
    '  L1 / L3            : ' + d.meta.l1 + ' / ' + d.meta.l3,
    '  auto-alert / customer : ' + d.meta.autoAlert + ' / ' + d.meta.customerTicket,
    '  has First Response : ' + d.meta.responseCount,
    '  has Restoration    : ' + d.meta.restorationCount,
    '  date range         : ' + d.meta.dateFrom + '  ..  ' + d.meta.dateTo,
    '  SLA breach rows    : ' + d.sla.length,
    '  roster             : ' + d.roster.map(function (p) {
                                  return p.name + (p.active ? '' : ' (inactive)'); }).join(', '),
    '',
    '  customers shown (' + shown.length + '):',
    '    ' + shown.map(function (c) { return c.name + ' ' + c.total; }).join('   |   '),
    '  hidden from display, still in totals (' + hidden.length + '):',
    '    ' + hidden.map(function (c) { return c.name + ' ' + c.total; }).join('   |   '),
    '',
    '  FEED_KEY           : ' +
      (PropertiesService.getScriptProperties().getProperty('FEED_KEY') ? 'set' : 'MISSING — run feedMakeKey()')
  ].join('\n'));
}

/** The exact api/data.js to paste, with this deployment's key already in it. */
function feedClientPatch() {
  var key = PropertiesService.getScriptProperties().getProperty('FEED_KEY') || '<run feedMakeKey() first>';
  Logger.log([
    'In Vercel → Settings → Environment Variables, add:',
    '    FEED_KEY = ' + key,
    '',
    'Then api/data.js becomes:',
    '',
    'export default async function handler(req, res) {',
    '  const APPS_URL = "<your new /exec URL>";',
    '  const KEY = process.env.FEED_KEY;',
    '  try {',
    '    const response = await fetch(`${APPS_URL}?key=${encodeURIComponent(KEY)}`, { redirect: "follow" });',
    '    const text = await response.text();',
    '    const data = JSON.parse(text.replace(/^\\/\\*[^*]*\\*\\/\\s*/, ""));',
    '    if (!data.ok) return res.status(data.code || 500).json({ error: data.error });',
    '    res.setHeader("Access-Control-Allow-Origin", "*");',
    '    res.setHeader("Cache-Control", "no-store, max-age=0");',
    '    res.status(200).json(data);',
    '  } catch (err) {',
    '    res.status(500).json({ error: err.message });',
    '  }',
    '}'
  ].join('\n'));
}
