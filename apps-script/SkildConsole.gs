/**
 * ════════════════════════════════════════════════════════════════════════════
 * SKILD AI — CEC CONSOLE          file: SkildConsole.gs        version 21.3.0
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Lives inside "Shift Data Tracking". Pulls Zendesk into "All tickets Info"
 * and rebuilds "SLA Breach - RCA".
 *
 * WHAT 21.3.0 ADDS — "SLA Clocks", so the dashboard can count SLA the way
 * Zendesk counts it.
 *   Zendesk's SLA reports do not ask when a ticket was RAISED. They ask when
 *   its SLA clock FINISHED. #1287 was raised on 6 Sep and breached on 8 Sep:
 *   Explore counts it in 7-20 Sep, the dashboard filtered on the created date
 *   and showed nothing. Same data, different question.
 *
 *   So syncSla() now also writes a hidden tab, "SLA Clocks": one row per
 *   ticket holding, for each metric, whether the clock was Met or Breached
 *   and the minute it finished — the breach event's own timestamp, which is
 *   the "SLA update - Timestamp" column in an Explore drill-in. Feed.gs sends
 *   it on, and the dashboard counts both the breaches AND the denominator
 *   from it, so the compliance % matches too (Zendesk divides by the clocks
 *   that finished in the window, not by the tickets raised in it).
 *
 *   Only COMPLETED clocks are written, which is Explore's "SLA metric status
 *   = Completed". A ticket still running past its target is not yet a breach
 *   on either screen.
 *
 *   slaCheckWindow() prints the five Explore tiles for a date range so the
 *   two screens can be compared without deploying anything. Edit the two
 *   dates in SLA_CHECK_RANGE and press Run.
 *
 * WHAT 21.2.0 FIXED
 *   zdSlaEvents ended the event stream as soon as a page held fewer than 100
 *   events. Zendesk pages that export by TIME, not by count, so a quiet
 *   stretch returns a short page in the MIDDLE of the stream and everything
 *   after it was never read. That is why "SLA Breach - RCA" stopped at #1287
 *   on 6 September while the ticket log ran on to 22 September. The stream now
 *   ends only where Zendesk says it ends, and the run logs how many pages it
 *   read and the timestamp of the newest event, so a short read is visible at
 *   a glance. slaEventProbe() walks the same export page by page if it ever
 *   looks wrong again.
 *
 *   zdGet retries a reply that arrives cut off mid-JSON instead of throwing
 *   "Unterminated string in JSON", and the ticket export asks for 500 per page
 *   rather than 1000, so there is less to lose on a broken transfer.
 *
 * THE TWO COLUMNS, DEFINED ONCE
 *   L  First Response (min)  = Zendesk reply_time_in_minutes, BUSINESS minutes.
 *        Time from creation to the first PUBLIC agent reply. Blank when no
 *        agent ever replied publicly. Independent of ticket status — a first
 *        response is finished the moment it happens.
 *   M  Restoration (min)     = Zendesk full_resolution_time_in_minutes,
 *        CALENDAR minutes. Straight created -> solved, pending time included.
 *        BLANK while the ticket is unsolved — ticket aging covers those.
 *        Equals (column G - column B), so any row can be checked by hand.
 *
 *   Not used for column M: requester_wait_time. That one pauses during Pending
 *   and keeps running on an unsolved ticket, which is why 21.0.0 put numbers
 *   against tickets nobody had solved. It is still read, but only to decide
 *   the Resolution SLA verdict on "SLA Breach - RCA", where the SLA policy
 *   itself is measured against it.
 *
 *   assertWritable() refuses to touch a tab that still holds a live
 *   IMPORTRANGE, instead of wiping the formula and taking the rollups with it.
 *
 * DELIBERATELY NOT IN THIS FILE
 *   doGet / doPost and the ZRA-extension backend (createOrUpdate, checkAccess,
 *   getTicket, findSimilar). Apps Script allows ONE doGet per project and
 *   Feed.gs owns it.
 *
 * RUN ORDER, FIRST TIME
 *   1. Script Properties: ZD_SUBDOMAIN, ZD_EMAIL, ZD_TOKEN
 *   2. previewTickets()   — writes nothing, read the Execution log
 *   3. syncTickets()      — backs the tab up once, then writes
 *   4. syncSla()
 *   5. skInstallTriggers()
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── CONFIG ──────────────────────────────────────────────────────────────────
var SKILD_VERSION = '21.3.0';
var TICKETS_SHEET = 'All tickets Info';
var RCA_SHEET     = 'SLA Breach - RCA';
var CLOCK_SHEET   = 'SLA Clocks';        // written by syncSla, hidden, read by the feed

/** The range slaCheckWindow() reports on. Edit these two dates, then Run. */
var SLA_CHECK_RANGE = ['2026-09-07', '2026-09-20'];

/** Blank when the script is bound to the sheet; else set a SHEET_ID property. */
var SHEET_ID = '';

var TZ       = 'Asia/Kolkata';
var DATE_FMT = 'dd-MMM-yyyy HH:mm:ss';
var NUM_FMT  = 'dd-mmm-yyyy hh:mm:ss';

var COL = {
  TICKET: 1, CREATED: 2, CUSTOMER: 3, OWNER: 4, ESCALATED: 5,
  LEVEL: 6, SOLVED: 7, STATUS: 8, TYPE: 9, SUMMARY: 10, REMARKS: 11,
  RESPONSE: 12, RESTORATION: 13
};
var LAST_COL    = 13;
var HEADER_ROWS = 2;

/** Written into row 1 only if the cell is empty, so your styling survives. */
var NEW_HEADERS = { 12: 'First Response (min)', 13: 'Restoration (min)' };

/** Columns holding numbers, so they skip the dropdown-matching path. */
var NUMERIC_FIELDS = { reply: true, resolution: true };

/** Zendesk closes a solved ticket after a few days; the sheet calls both solved. */
var FOLD_CLOSED_INTO_SOLVED = true;

/** Refuses to run rather than delete more than this many rows in one go. */
var MAX_DELETES_PER_RUN = 50;

/** Organizations that are not the customer — the alert system, and Skild itself. */
var NOT_A_CUSTOMER = /fetch alert|^skild/i;

/** Agent names as the sheet writes them; anything else becomes the first word. */
var AGENT_ALIASES = {
  'Sardar Sreekanth': 'Sreekanth',
  'Sanath Reddy R':   'Sanath',
  'Sahil Ranjan':     'Sahil'
};

/** Zendesk's status labels mapped to the words the sheet's rollups expect. */
var LABEL_MAP = {
  'new': 'in progress', 'open': 'in progress', 'in progress': 'in progress',
  'pending': 'pending', 'on-hold': 'pending', 'on hold': 'pending',
  'solved': 'solved', 'closed': 'closed'
};
var STATUS_MAP = {
  'new': 'in progress', 'open': 'in progress', 'hold': 'pending',
  'pending': 'pending', 'solved': 'solved', 'closed': 'closed'
};

/** Ticket fields found by name, so no ids need configuring by hand. */
var FIELD_NAMES = {
  escalated: /send\s*to\s*escalation/i,
  category:  /^issue category$/i,        // "Battery and Charging::Low Battery"
  robot:     /robot\s*\/?\s*site|^robot$/i,
  l3owner:   /l3\s*assignee/i
};

var TYPE_UNSPECIFIC = /^(other|others|miscellaneous|uncategorized|none)$/i;
var VALUE_ALIASES   = { 'test tickets': 'Test', 'other': 'Others', 'others': 'Other' };
var PRIORITY_MAP    = { urgent: 'P1', high: 'P2', normal: 'P3', low: 'P4' };

// ═══════════════════════════════════════════════════════════════════════════
// SPREADSHEET ACCESS
// ═══════════════════════════════════════════════════════════════════════════

function activeSS() {
  var id = SHEET_ID || PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet — add a SHEET_ID script property.');
  return ss;
}

function ticketsSheet(ss) {
  var sh = ss.getSheetByName(TICKETS_SHEET);
  if (!sh) throw new Error('Sheet "' + TICKETS_SHEET + '" not found');
  return sh;
}

/**
 * A script cannot write into a range a spilling IMPORTRANGE occupies —
 * setValues() kills the A1 formula and every COUNTIFS downstream of it dies
 * with it. So look before writing, and say exactly how to fix it.
 */
function assertWritable(sheet) {
  var rows = Math.min(3, sheet.getMaxRows());
  var f = sheet.getRange(1, 1, rows, Math.min(LAST_COL, sheet.getMaxColumns())).getFormulas();
  for (var r = 0; r < f.length; r++) {
    for (var c = 0; c < f[r].length; c++) {
      if (/IMPORTRANGE|ARRAYFORMULA/i.test(f[r][c] || '')) {
        throw new Error(
          'REFUSING TO WRITE — "' + sheet.getName() + '" still holds a live ' +
          'IMPORTRANGE/ARRAYFORMULA at ' +
          sheet.getRange(r + 1, c + 1).getA1Notation() + '.\n' +
          'Freeze it first: select A1:Z<last row>, Ctrl+C, then Ctrl+Shift+V ' +
          '(Paste special > Values only). Then run this again.'
        );
      }
    }
  }
}

/** Adds the two new column headings without disturbing the existing ones. */
function ensureHeaders(sheet) {
  if (sheet.getMaxColumns() < LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), LAST_COL - sheet.getMaxColumns());
  }
  Object.keys(NEW_HEADERS).forEach(function (c) {
    var cell = sheet.getRange(1, Number(c));
    if (!String(cell.getValue()).trim()) {
      cell.setValue(NEW_HEADERS[c]).setFontWeight('bold').setWrap(true);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TICKET LOG, BROUGHT IN LINE WITH ZENDESK
// ═══════════════════════════════════════════════════════════════════════════

/** The columns the sync corrects. Customer is filled only when blank. */
var OWNED = [
  ['created',   COL.CREATED,     'Created'],
  ['customer',  COL.CUSTOMER,    'Customer'],
  ['owner',     COL.OWNER,       'L1 owner'],
  ['escalated', COL.ESCALATED,   'Escalated'],
  ['level',     COL.LEVEL,       'L1 / L3'],
  ['solved',    COL.SOLVED,      'Solved'],
  ['status',    COL.STATUS,      'Status'],
  ['type',      COL.TYPE,        'Issue Type'],
  ['subject',   COL.SUMMARY,     'Issue Summary'],
  ['reply',       COL.RESPONSE,    'First Response (min)'],
  ['resolution',  COL.RESTORATION, 'Restoration (min)']
];
var FILL_ONLY_IF_BLANK = { customer: true };

/** Writes nothing — logs everything syncTickets would do. */
function previewTickets() { ticketSync(false); }

/** Adds missing tickets, removes duplicates, corrects the rest. */
function syncTickets() { ticketSync(true); }

function ticketSync(apply) {
  var zd = zdTickets();                        // network first, outside the lock

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = activeSS(), sheet = ticketsSheet(ss);
    assertWritable(sheet);
    if (apply) ensureHeaders(sheet);

    var n = Math.max(0, sheet.getLastRow() - HEADER_ROWS);
    var grid = n ? sheet.getRange(HEADER_ROWS + 1, 1, n, LAST_COL).getValues() : [];

    // 1. index the rows, so duplicates are visible
    var index = {};
    for (var i = 0; i < grid.length; i++) {
      var k = normKey(grid[i][COL.TICKET - 1]);
      if (!k) continue;
      (index[k] = index[k] || []).push(i);
    }

    // 2. duplicates: keep the row carrying the most human writing, merge the rest
    var dupes = [], dropRows = [];
    Object.keys(index).forEach(function (k) {
      var hits = index[k];
      if (hits.length < 2) return;
      hits.sort(function (a, b) { return (humanScore(grid[b]) - humanScore(grid[a])) || (a - b); });
      var keep = hits[0], drop = hits.slice(1);
      drop.forEach(function (d) {
        [COL.SUMMARY, COL.REMARKS].forEach(function (col) {
          var kept = String(grid[keep][col - 1] || '').trim();
          var lost = String(grid[d][col - 1] || '').trim();
          if (!kept && lost) grid[keep][col - 1] = grid[d][col - 1];
          else if (lost && kept.indexOf(lost) === -1 && col === COL.REMARKS) {
            grid[keep][col - 1] = kept + ' | ' + lost;
          }
        });
        dropRows.push(d);
      });
      dupes.push('#' + k + ' (' + hits.length + ' rows)');
      index[k] = [keep];
    });

    // 3. corrections
    var siteCustomer = learnCustomers(grid, zd);
    var allowed = columnRules(sheet, n);          // the sheet's own dropdown lists
    var changed = {}, samples = {}, orphans = [], skipped = {}, touched = 0;
    Object.keys(index).forEach(function (k) {
      var r = index[k][0], z = zd.byId[k];
      if (!z) { orphans.push(String(grid[r][COL.TICKET - 1]).trim()); return; }
      var want = wanted(z, siteCustomer);

      OWNED.forEach(function (spec) {
        var field = spec[0], col = spec[1], label = spec[2];
        var now = want[field], was = grid[r][col - 1];

        if (field === 'solved' && !now) {            // reopened: clear a stale date
          if (z.resolved || was === '' || was == null) return;
          grid[r][col - 1] = ''; note(changed, samples, label, k, was, ''); touched++;
          return;
        }
        // Unsolved, or solved then reopened: the restoration cell must go back
        // to blank, otherwise a stale duration outlives the solve that made it.
        if (field === 'resolution' && (now === '' || now == null)) {
          if (was === '' || was == null) return;
          grid[r][col - 1] = ''; note(changed, samples, label, k, was, ''); touched++;
          return;
        }
        if (now === '' || now == null) return;
        if (FILL_ONLY_IF_BLANK[field] && String(was == null ? '' : was).trim()) return;
        if (field === 'type' && TYPE_UNSPECIFIC.test(String(now).trim()) &&
            String(was == null ? '' : was).trim()) return;      // Other means unset

        // Numbers and dates never go through the dropdown list; everything else
        // must be written in the spelling the sheet's own validation allows.
        if (!(now instanceof Date) && !NUMERIC_FIELDS[field]) {
          var listed = allowedValue(allowed, col, now);
          if (listed === null) {                  // the dropdown has no equivalent
            var b = skipped[label] || (skipped[label] = { count: 0, seen: {} });
            b.count++; b.seen[String(now)] = 1;
            return;
          }
          now = listed;                           // write it the way the list spells it
        }
        if (sameValue(was, now, field)) return;

        grid[r][col - 1] = now;
        note(changed, samples, label, k, was, now);
        touched++;
      });
    });

    // 4. tickets Zendesk has and the sheet does not
    var added = [];
    Object.keys(zd.byId).sort(function (a, b) { return a - b; }).forEach(function (k) {
      if (index[k]) return;
      var w = wanted(zd.byId[k], siteCustomer);
      function ok(col, v) { var x = allowedValue(allowed, col, v); return x === null ? '' : x; }
      added.push(['#' + k, w.created, ok(COL.CUSTOMER, w.customer), ok(COL.OWNER, w.owner),
                  ok(COL.ESCALATED, w.escalated), ok(COL.LEVEL, w.level), w.solved || '',
                  ok(COL.STATUS, w.status), ok(COL.TYPE, w.type), w.subject, '',
                  w.reply, w.resolution]);
    });

    var tooManyDeletes = dropRows.length > MAX_DELETES_PER_RUN;
    if (apply && (touched || added.length || (dropRows.length && !tooManyDeletes))) {
      backupOnce(ss, sheet);
      if (grid.length) sheet.getRange(HEADER_ROWS + 1, 1, grid.length, LAST_COL).setValues(grid);
      if (dropRows.length && !tooManyDeletes) {
        dropRows.map(function (d) { return HEADER_ROWS + 1 + d; })
                .sort(function (a, b) { return b - a; })
                .forEach(function (rowNum) { sheet.deleteRow(rowNum); });
      }
      if (added.length) {
        sheet.getRange(sheet.getLastRow() + 1, 1, added.length, LAST_COL).setValues(added);
      }
      var h = sheet.getLastRow() - HEADER_ROWS;
      if (h > 0) {
        sheet.getRange(HEADER_ROWS + 1, COL.CREATED,     h, 1).setNumberFormat(NUM_FMT);
        sheet.getRange(HEADER_ROWS + 1, COL.SOLVED,      h, 1).setNumberFormat(NUM_FMT);
        sheet.getRange(HEADER_ROWS + 1, COL.RESPONSE,    h, 1).setNumberFormat('0');
        sheet.getRange(HEADER_ROWS + 1, COL.RESTORATION, h, 1).setNumberFormat('0');
      }
    }

    var lines = [(apply ? 'Ticket log synced' : 'PREVIEW — nothing written') + ':   ' +
                 zd.count + ' tickets in Zendesk, ' + n + ' rows in the sheet',
                 '  rows added       : ' + added.length +
                   (added.length ? '   ' + added.slice(0, 10).map(function (a) { return a[0]; }).join(', ') : ''),
                 '  duplicate rows   : ' + dropRows.length +
                   (dupes.length ? '   ' + dupes.slice(0, 10).join(', ') : '') +
                   (tooManyDeletes ? '   << REFUSED, over the ' + MAX_DELETES_PER_RUN + '-row limit, nothing deleted' : ''),
                 '  cells corrected  : ' + touched];
    OWNED.forEach(function (spec) {
      if (!changed[spec[2]]) return;
      lines.push('      ' + zdPad(spec[2], 22) + zdPad(String(changed[spec[2]]), 6) +
                 samples[spec[2]].join('   |   '));
    });
    Object.keys(skipped).forEach(function (label) {
      var values = Object.keys(skipped[label].seen);
      lines.push('  ' + zdPad(label + ' skipped', 26) + skipped[label].count +
                 ' — not on the sheet\'s dropdown list: ' + values.slice(0, 6).join(', ') +
                 (values.length > 6 ? ' …' : ''));
    });
    if (orphans.length) {
      lines.push('  not in Zendesk   : ' + orphans.length + ' row(s), left alone   ' +
                 orphans.slice(0, 15).join(', '));
    }
    if (!Object.keys(allowed).length) {
      lines.push('', 'NOTE: this tab carries no dropdown validation, so Zendesk\'s own',
                     'spelling is written as-is. Copy a data row from the old file and',
                     'Paste special > Data validation only, if you want the old guard back.');
    }
    if (!apply) lines.push('', 'Run syncTickets() to apply. It backs the tab up first.');
    Logger.log(lines.join('\n'));
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** What Zendesk says a row should hold. */
function wanted(z, siteCustomer) {
  return {
    created:   z.created,
    customer:  z.customer || siteCustomer[z.site] || z.site || '',
    owner:     z.owner,
    escalated: z.escalated,
    level:     z.level,
    solved:    z.solved,
    status:    z.status,
    type:      z.category,
    subject:   z.subject,
    reply:      z.reply      == null ? '' : z.reply,
    resolution: z.resolution == null ? '' : z.resolution
  };
}

/**
 * Alert tickets all belong to the "Fetch Alert System" organization, so Zendesk
 * cannot name the customer — but the alert subject carries the site's short
 * name, and the sheet already holds the full name for most sites. Learn
 * site -> full name from the rows that have both.
 */
function learnCustomers(grid, zd) {
  var sites = {};
  grid.forEach(function (row) {
    var z = zd.byId[normKey(row[COL.TICKET - 1])];
    var name = String(row[COL.CUSTOMER - 1] || '').trim();
    if (!z || !z.site || !name) return;
    if (name.toLowerCase() === z.site) return;              // still the short name
    var tally = sites[z.site] || (sites[z.site] = {});
    tally[name] = (tally[name] || 0) + 1;
  });
  var best = {};
  Object.keys(sites).forEach(function (site) {
    var pick = '', count = 0;
    Object.keys(sites[site]).forEach(function (name) {
      if (sites[site][name] > count) { pick = name; count = sites[site][name]; }
    });
    best[site] = pick;
  });
  return best;
}

/**
 * The dropdown lists the sheet enforces, by column. Writing anything else makes
 * the whole write fail — cell I3 on one run, H669 on the next, where Zendesk
 * said "pending" and the list only allows "Pending". So every value is matched
 * against the list first and written in the list's own spelling.
 */
function columnRules(sheet, n) {
  var rules = {};
  if (n < 1) return rules;
  var row = sheet.getRange(HEADER_ROWS + 1, 1, 1, LAST_COL).getDataValidations()[0];
  for (var c = 1; c <= LAST_COL; c++) {
    var rule = row[c - 1];
    if (!rule) continue;
    try {
      if (String(rule.getCriteriaType()) !== 'VALUE_IN_LIST') continue;
      var set = { exact: {}, loose: {} };
      (rule.getCriteriaValues()[0] || []).forEach(function (v) {
        var text = String(v);
        set.exact[text.trim().toLowerCase()] = text;
        set.loose[looseKey(text)] = text;
      });
      rules[c] = set;
    } catch (err) { /* a rule we cannot read is treated as no rule */ }
  }
  return rules;
}

/**
 * The value as the sheet's dropdown spells it, or null when the list has no
 * equivalent. Zendesk and the sheet name the same thing differently —
 * "Battery and Charging" / "Battery & Charging", "Fleet or Site Issues" /
 * "Fleet / Site Issues" — so the match ignores &, /, "and", "or", punctuation
 * and a trailing s.
 */
function allowedValue(rules, col, value) {
  if (typeof value === 'number') return value;
  var v = String(value == null ? '' : value).trim();
  var set = rules[col];
  if (!set || !v) return v;

  var tries = [v];
  var alias = VALUE_ALIASES[v.toLowerCase()];
  if (alias) tries.push(alias);
  for (var i = 0; i < tries.length; i++) {
    var hit = set.exact[tries[i].toLowerCase()];
    if (hit != null) return hit;
    hit = set.loose[looseKey(tries[i])];
    if (hit != null) return hit;
  }
  return null;
}

function looseKey(v) {
  return String(v).toLowerCase()
    .replace(/&|\//g, ' ')
    .replace(/\b(and|or|the)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .replace(/s$/, '');
}

function humanScore(row) {
  return (String(row[COL.SUMMARY - 1] || '').trim() ? 1 : 0) +
         (String(row[COL.REMARKS - 1] || '').trim() ? 2 : 0);
}

function backupOnce(ss, sheet) {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('SYNC_BACKUP_DONE')) return;
  var name = TICKETS_SHEET + ' backup ' + Utilities.formatDate(new Date(), TZ, 'dd-MMM HH:mm');
  sheet.copyTo(ss).setName(name);
  p.setProperty('SYNC_BACKUP_DONE', '1');
  Logger.log('First run — the tab was copied to "' + name + '".');
}

function note(changed, samples, label, ticket, was, now) {
  changed[label] = (changed[label] || 0) + 1;
  if (!samples[label]) samples[label] = [];
  if (samples[label].length < 3) {
    samples[label].push('#' + ticket + ': ' + short(was) + ' -> ' + short(now));
  }
}

function short(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'dd-MMM HH:mm');
  var s = String(v == null || v === '' ? '(blank)' : v);
  return s.length > 26 ? s.slice(0, 25) + '…' : s;
}

/** Categories differ in "and" vs "&"; statuses and names differ only in case. */
function sameValue(was, now, field) {
  if (was instanceof Date || now instanceof Date) {
    if (!(was instanceof Date) || !(now instanceof Date)) return false;
    return Math.abs(was.getTime() - now.getTime()) < 1000;
  }
  if (NUMERIC_FIELDS[field]) {
    var a = (was === '' || was == null) ? null : Number(was);
    var b = (now === '' || now == null) ? null : Number(now);
    if (a === null || b === null || isNaN(a) || isNaN(b)) return a === b;
    return Math.abs(a - b) < 0.5;
  }
  var x = String(was == null ? '' : was).trim(), y = String(now == null ? '' : now).trim();
  if (field === 'type') return normCategory(x).toLowerCase() === normCategory(y).toLowerCase();
  if (field === 'status' || field === 'escalated' || field === 'level' ||
      field === 'customer' || field === 'owner') {
    return x.toLowerCase() === y.toLowerCase();
  }
  return x === y;
}

/** "Battery and Charging" and "Battery & Charging" are the same category. */
function normCategory(v) {
  return String(v || '').replace(/\s+and\s+/gi, ' & ').replace(/\s+/g, ' ').trim();
}

/**
 * Every ticket, with the fields both tabs need. Three calls for the tickets
 * (users, organizations and metric sets ride along), plus one each for custom
 * statuses and ticket fields.
 */
function zdTickets() {
  var fields = zdFields();
  var labels = zdCustomStatuses();
  var url = '/api/v2/incremental/tickets/cursor.json?start_time=0&per_page=500' +
            '&include=users,organizations,metric_sets';
  var tickets = {}, users = {}, orgs = {}, sets = {}, pages = 0;

  while (url && pages < 80) {
    var res = zdGet(url);
    pages++;
    (res.tickets || []).forEach(function (t) {
      var prev = tickets[t.id];          // the export repeats a ticket per update
      if (!prev || String(t.updated_at || '') >= String(prev.updated_at || '')) tickets[t.id] = t;
    });
    (res.users || []).forEach(function (u) { users[u.id] = u; });
    (res.organizations || []).forEach(function (o) { orgs[o.id] = o; });
    (res.metric_sets || []).forEach(function (m) { sets[m.ticket_id] = m; });
    url = (res.end_of_stream || !res.after_url) ? null : res.after_url;
  }

  var byId = {}, count = 0;
  Object.keys(tickets).forEach(function (id) {
    var t = tickets[id];
    if (t.status === 'deleted') return;
    var m = sets[id] || {};
    var org = t.organization_id ? orgs[t.organization_id] : null;
    var orgName = org ? String(org.name || '') : '';
    var requester = t.requester_id ? users[t.requester_id] : null;
    var resolved = t.status === 'solved' || t.status === 'closed';
    var escalated = zdFlag(zdField(t, fields.ids.escalated));
    var category = fieldLabel(zdField(t, fields.ids.category), fields.options).split('::');

    byId[String(id)] = {
      created:   t.created_at ? new Date(t.created_at) : null,
      solved:    resolved && m.solved_at ? new Date(m.solved_at) : null,
      resolved:  resolved,
      customer:  NOT_A_CUSTOMER.test(orgName) ? '' : orgName,
      site:      alertSite(t.subject),
      requester: requester ? String(requester.name || '') : '',
      owner:     agentName(t.assignee_id ? users[t.assignee_id] : null),
      escalated: escalated ? 'Yes' : 'No',
      level:     escalated ? 'L3' : 'L1',
      status:    statusOf(t, labels),
      category:  normCategory(category[0]),                      // main category
      sub:       category.length > 1 ? category[category.length - 1].trim() : '',
      subject:   String(t.subject || ''),
      priority:  PRIORITY_MAP[String(t.priority || '').toLowerCase()] || '',
      type:      title(t.type),                                  // Incident, Problem…
      channel:   title(t.via && t.via.channel ? t.via.channel : ''),
      robot:     fieldLabel(zdField(t, fields.ids.robot), fields.options),
      l3owner:   fieldLabel(zdField(t, fields.ids.l3owner), fields.options),
      reply:      bizMin(m.reply_time_in_minutes),            // -> column L, business
      wait:       bizMin(m.requester_wait_time_in_minutes),   // SLA verdict only
      resolution: resolved ? resolutionMins(t, m) : null      // -> column M, calendar
    };
    count++;
  });
  return { byId: byId, count: count };
}

/** "Automatic alert for inventive, freight100-2258: ..." -> "inventive" */
function alertSite(subject) {
  var m = String(subject || '').match(/^automatic alert for\s+([^,:]+)/i);
  return m ? m[1].trim().toLowerCase() : '';
}

function zdField(ticket, id) {
  if (!id) return '';
  var f = (ticket.custom_fields || []).filter(function (x) { return String(x.id) === String(id); })[0];
  return f && f.value != null ? String(f.value) : '';
}

function zdFlag(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

function agentName(user) {
  if (!user || !user.name) return '';
  if (AGENT_ALIASES[user.name]) return AGENT_ALIASES[user.name];
  return String(user.name).trim().split(/\s+/)[0];
}

function title(v) {
  var s = String(v || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function statusOf(ticket, labels) {
  var label = ticket.custom_status_id != null ? labels[String(ticket.custom_status_id)] : '';
  var key = String(label || '').toLowerCase();
  if (key) return skStatus(LABEL_MAP[key] || key);
  return skStatus(STATUS_MAP[ticket.status] || ticket.status);
}

/**
 * Ticket field ids, found by name, plus the dropdown's own option list.
 *
 * A dropdown field's value on a ticket is its TAG, not its label — Zendesk
 * returns "battery_and_charging__low_battery" where the field's option reads
 * "Battery and Charging::Low Battery". Only the label matches your sheet, so
 * the options are read too and the tag is translated back.
 */
function zdFields() {
  var ids = {}, options = {};
  try {
    var res = zdGet('/api/v2/ticket_fields.json?per_page=100');
    Object.keys(FIELD_NAMES).forEach(function (k) {
      var f = (res.ticket_fields || []).filter(function (x) {
        return FIELD_NAMES[k].test(String(x.title || ''));
      })[0];
      ids[k] = f ? String(f.id) : '';
      if (!f) { Logger.log('No ticket field matching ' + k + ' — that column stays empty.'); return; }
      (f.custom_field_options || []).forEach(function (o) {
        if (o && o.value != null) options[String(o.value)] = String(o.name || '');
      });
    });
  } catch (err) {
    Logger.log('Could not read ticket fields (' + err.message + ').');
  }
  return { ids: ids, options: options };
}

/** The option's label where there is one, else the raw value. */
function fieldLabel(value, options) {
  var v = String(value == null ? '' : value);
  return v && options[v] ? options[v] : v;
}

function zdCustomStatuses() {
  var map = {};
  try {
    (zdGet('/api/v2/custom_statuses.json').custom_statuses || []).forEach(function (cs) {
      if (cs && cs.id != null) map[String(cs.id)] = String(cs.agent_label || '').trim();
    });
  } catch (err) {
    Logger.log('Could not read custom statuses (' + err.message + ') — using base statuses.');
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// "SLA Breach - RCA", ONE ROW PER BREACHED TICKET
// ═══════════════════════════════════════════════════════════════════════════
//
// Zendesk records each SLA outcome as a ticket metric event: apply_sla when a
// target starts, breach when it is missed, fulfill and update_status when the
// clock stops and at what minute. Explore's SLA reports read the same records.

var SLA_METRICS = { reply_time: 'response', requester_wait_time: 'resolution' };

var RCA_HEADERS = [
  'Ticket ID', 'Created Date', 'SLA Breach Type', 'Customer', 'Site', 'Robot ID',
  'Issue Summary', 'Issue Category', 'Sub Category', 'Incident Type', 'Priority',
  'Channel', 'L1 Owner', 'L3 Owner',
  'First Response Target', 'Actual Response', 'First Response SLA',
  'Resolution Target', 'Actual Resolution', 'Resolution SLA',
  'Ticket Status', 'Root Cause Description'
];
var RCA_BANDS = [[1, 14, 'Ticket Details', '#1F4E79'], [15, 20, 'SLA', '#843C0C'],
                 [21, 22, 'RCA', '#375623']];
/** The team's yellow headers; the rest are the pale blue ones. */
var RCA_YELLOW = { 1: 1, 4: 1, 7: 1, 8: 1, 9: 1, 11: 1, 12: 1, 13: 1,
                   15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 22: 1 };
var RCA_COL = { RESPONSE: 17, RESOLUTION: 20, RCA_TEXT: 22 };

function syncSla() {
  var events = zdSlaEvents(Date.now());
  if (!events) { Logger.log('SLA: the Zendesk export ran out of time — sheet left as it was.'); return null; }

  var ss = activeSS();
  var existing = ss.getSheetByName(RCA_SHEET);
  if (existing) assertWritable(existing);

  var zd = zdTickets();
  var state = slaState(events, zd.byId, Date.now());
  var sheetCustomer = logCustomers(ss);
  var kept = keptRca(ss);

  var rows = [];
  Object.keys(state).sort(function (a, b) { return a - b; }).forEach(function (key) {
    var s = state[key], z = zd.byId[key];
    var type = breachType(s);
    if (!type || !z) return;                       // breached tickets only
    rows.push([
      '#' + key, z.created || '', type,
      z.requester, sheetCustomer[key] || z.customer || z.site || '', z.robot,
      z.subject, z.category, z.sub, z.type, z.priority, z.channel, z.owner, z.l3owner,
      humanMins(s.response.target),   humanMins(s.response.mins),   verdict(s.response.status),
      humanMins(s.resolution.target), humanMins(s.resolution.mins), verdict(s.resolution.status),
      title(z.status), kept[key] || ''
    ]);
  });

  writeRca(ss, rows);
  writeClocks(ss, clockRows(state, zd.byId));
  Logger.log(slaSummary(rows, zd).join('\n'));
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// "SLA Clocks", ONE ROW PER TICKET — THE DASHBOARD'S DENOMINATOR
// ═══════════════════════════════════════════════════════════════════════════
//
// The RCA sheet answers "which tickets breached". It cannot answer "how many
// clocks ran at all", which is what a compliance PERCENTAGE divides by, and it
// carries no breach timestamp, which is what Zendesk filters a date range on.
// This tab answers both, in five columns nobody has to read by hand.

var CLOCK_HEADERS = ['Ticket ID', 'First Response SLA', 'Response Finished',
                     'Resolution SLA', 'Resolution Finished'];

/** Completed clocks only — Explore's "SLA metric status = Completed". */
function clockRows(state, byId) {
  var out = [];
  Object.keys(state).sort(function (a, b) { return a - b; }).forEach(function (key) {
    if (!byId[key]) return;                         // deleted in Zendesk
    var a = finishedClock(state[key].response), b = finishedClock(state[key].resolution);
    if (!a && !b) return;                           // nothing has finished yet
    out.push(['#' + key,
              a ? a.status : '', a && a.at ? new Date(a.at) : '',
              b ? b.status : '', b && b.at ? new Date(b.at) : '']);
  });
  return out;
}

function finishedClock(m) {
  return m && (m.status === 'Met' || m.status === 'Breached') && m.at ? m : null;
}

function writeClocks(ss, rows) {
  var sh = ss.getSheetByName(CLOCK_SHEET) || ss.insertSheet(CLOCK_SHEET);
  var w = CLOCK_HEADERS.length;
  sh.clear();
  sh.getRange(1, 1, 1, w).setValues([CLOCK_HEADERS]).setFontWeight('bold')
    .setBackground('#DDEEFF');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, w).setValues(rows);
    sh.getRange(2, 3, rows.length, 1).setNumberFormat(NUM_FMT);
    sh.getRange(2, 5, rows.length, 1).setNumberFormat(NUM_FMT);
  }
  sh.setFrozenRows(1);
  try { sh.hideSheet(); } catch (err) { /* already hidden, or the only sheet */ }

  var met = 0, breached = 0;
  rows.forEach(function (r) {
    [1, 3].forEach(function (i) {
      if (r[i] === 'Met') met++; else if (r[i] === 'Breached') breached++;
    });
  });
  Logger.log('SLA Clocks: ' + rows.length + ' tickets, ' + (met + breached) +
             ' finished clocks (' + met + ' met, ' + breached + ' breached)');
}

/** The tab as the dashboard wants it: [id, 'M'|'B'|'', when, 'M'|'B'|'', when]. */
function feedClocks() {
  var sh = activeSS().getSheetByName(CLOCK_SHEET);
  if (!sh) return [];
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];

  var grid = sh.getRange(2, 1, n, CLOCK_HEADERS.length).getValues(), out = [];
  for (var i = 0; i < grid.length; i++) {
    var id = normKey(grid[i][0]);
    if (!id) continue;
    out.push([id, clockCode(grid[i][1]), slaStamp(grid[i][2]),
                  clockCode(grid[i][3]), slaStamp(grid[i][4])]);
  }
  return out;
}

function clockCode(v) {
  var s = String(v || '').trim().toLowerCase();
  return s === 'met' ? 'M' : s === 'breached' ? 'B' : '';
}

/** Local time, never stamped Z — the browser must not shift it 5.5 hours. */
function slaStamp(v) {
  var d = v instanceof Date ? v : (v ? new Date(v) : null);
  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

/** "First Response SLA", "Resolution SLA", "Response & Resolution SLA" or ''. */
function breachType(s) {
  var a = s.response.status === 'Breached', b = s.resolution.status === 'Breached';
  return a && b ? 'Response & Resolution SLA' : a ? 'First Response SLA'
       : b ? 'Resolution SLA' : '';
}

function verdict(status) {
  if (status === 'Breached') return 'Breached';
  if (status === 'Met') return 'Met';
  if (status === 'Breached (still open)') return 'Breached (open)';
  return status ? 'Running' : 'N/A';
}

/** 240 -> "4 hours", 2880 -> "2 days", 45 -> "45 min", nothing -> "-" */
function humanMins(v) {
  if (v === '' || v == null) return '-';
  var m = Math.round(Number(v));
  if (m < 60) return m + ' min';
  if (m < 1440) { var h = Math.round(m / 6) / 10; return h + (h === 1 ? ' hour' : ' hours'); }
  var d = Math.round(m / 144) / 10;
  return d + (d === 1 ? ' day' : ' days');
}

/** Ticket -> the customer the team entered in the log. */
function logCustomers(ss) {
  var sheet = ticketsSheet(ss), out = {};
  var n = sheet.getLastRow() - HEADER_ROWS;
  if (n < 1) return out;
  sheet.getRange(HEADER_ROWS + 1, 1, n, COL.CUSTOMER).getValues().forEach(function (r) {
    var k = normKey(r[COL.TICKET - 1]);
    if (k) out[k] = String(r[COL.CUSTOMER - 1] || '').trim();
  });
  return out;
}

/** Ticket -> the Root Cause Description already typed on the RCA sheet. */
function keptRca(ss) {
  var sh = ss.getSheetByName(RCA_SHEET), out = {};
  if (!sh) return out;
  var n = sh.getLastRow() - HEADER_ROWS;
  if (n < 1) return out;
  sh.getRange(HEADER_ROWS + 1, 1, n, RCA_HEADERS.length).getValues().forEach(function (r) {
    var k = normKey(r[0]), text = String(r[RCA_COL.RCA_TEXT - 1] || '').trim();
    if (k && text) out[k] = text;
  });
  return out;
}

/** Rebuilds the sheet in the team's layout and colours. */
function writeRca(ss, rows) {
  var sh = ss.getSheetByName(RCA_SHEET) || ss.insertSheet(RCA_SHEET);
  var w = RCA_HEADERS.length;
  sh.clear();
  try { sh.getRange(1, 1, 1, w).breakApart(); } catch (err) { /* nothing merged yet */ }

  RCA_BANDS.forEach(function (b) {
    var range = sh.getRange(1, b[0], 1, b[1] - b[0] + 1);
    range.merge().setValue(b[2]).setBackground(b[3]).setFontColor('#FFFFFF')
         .setFontWeight('bold').setHorizontalAlignment('center');
  });

  sh.getRange(2, 1, 1, w).setValues([RCA_HEADERS]).setFontWeight('bold')
    .setBackgrounds([RCA_HEADERS.map(function (h, i) { return RCA_YELLOW[i + 1] ? '#FFDD44' : '#DDEEFF'; })])
    .setWrap(true);

  if (rows.length) {
    var body = sh.getRange(HEADER_ROWS + 1, 1, rows.length, w);
    body.setValues(rows).setBackground('#F7FBFF').setVerticalAlignment('top');
    sh.getRange(HEADER_ROWS + 1, 2, rows.length, 1).setNumberFormat(NUM_FMT);

    [RCA_COL.RESPONSE, RCA_COL.RESOLUTION].forEach(function (col) {
      var cells = sh.getRange(HEADER_ROWS + 1, col, rows.length, 1);
      cells.setBackgrounds(rows.map(function (r) {
        var v = r[col - 1];
        return [v === 'Breached' || v === 'Breached (open)' ? '#FFC7CE' : v === 'N/A' ? '#D9D9D9' : '#F7FBFF'];
      }));
      cells.setFontWeights(rows.map(function (r) {
        return [r[col - 1] === 'Met' || r[col - 1] === 'Running' ? 'normal' : 'bold'];
      }));
    });
  }

  sh.setFrozenRows(2);          // columns cannot be frozen under the merged bands
  sh.setColumnWidth(7, 320);     // Issue Summary
  sh.setColumnWidth(22, 360);    // Root Cause Description
}

function slaSummary(rows, zd) {
  var byType = {}, byOwner = {}, newest = null;
  rows.forEach(function (r) {
    byType[r[2]] = (byType[r[2]] || 0) + 1;
    byOwner[r[12] || '—'] = (byOwner[r[12] || '—'] || 0) + 1;
    if (r[1] instanceof Date && (!newest || r[1] > newest)) newest = r[1];
  });
  var withRca = rows.filter(function (r) { return String(r[21] || '').trim(); }).length;
  var out = ['SLA Breach - RCA: ' + rows.length + ' breached tickets   (' +
             zd.count + ' tickets in Zendesk)'];
  Object.keys(byType).sort().forEach(function (k) { out.push('  ' + zdPad(k, 28) + byType[k]); });
  out.push('  newest breached ticket    ' +
           (newest ? Utilities.formatDate(newest, TZ, 'dd-MMM-yyyy HH:mm') : 'none'));
  out.push('  root cause written        ' + withRca + ' of ' + rows.length);
  out.push('  by L1 owner: ' + Object.keys(byOwner).sort().map(function (k) {
    return k + ' ' + byOwner[k]; }).join(', '));
  return out;
}

/**
 * Per ticket: each metric's status, its clock, and the target in force.
 *
 * Three things a simpler reading gets wrong, all seen in this account:
 *   #200 breached the 240-minute first-reply target, the target was then raised
 *   to 480 and the clock stopped at 478 — Zendesk keeps the breach event but
 *   counts the ticket as met, so the target that decides is the LAST applied.
 *   #253 met restoration, was reopened, and breached the second time round.
 *   #36 ran to 457 against a 240 target with no breach recorded, because the
 *   SLA was applied after the ticket arrived — so elapsed time alone never
 *   creates a breach; only Zendesk's own event does.
 */
function slaState(events, byId, now) {
  var groups = {};
  events.forEach(function (e) {
    var k = e.ticket + '|' + e.metric;
    (groups[k] = groups[k] || []).push(e);
  });

  var out = {};
  Object.keys(groups).forEach(function (k) {
    var parts = k.split('|'), ticket = parts[0], metric = parts[1];
    if (!byId[ticket]) return;                        // deleted in Zendesk

    var evs = groups[k].sort(function (a, b) { return (a.time - b.time) || (a.id - b.id); });
    var applies = evs.filter(function (e) { return e.type === 'apply_sla'; });
    if (!applies.length) return;                      // no SLA on this metric

    var mine = evs;
    if (metric === 'reply_time') {                    // first reply, not later ones
      var inst = Math.min.apply(null, applies.map(function (e) { return e.inst; }));
      applies = applies.filter(function (e) { return e.inst === inst; });
      mine = evs.filter(function (e) { return e.inst === inst; });
    }

    var z        = byId[ticket];
    var target   = applies[applies.length - 1].target;
    var stops    = mine.filter(function (e) { return e.type === 'fulfill' || e.type === 'update_status'; });
    var timed    = mine.filter(function (e) { return e.type === 'update_status' && e.mins != null; });
    var elapsed  = timed.length ? timed[timed.length - 1].mins
                                : (metric === 'reply_time' ? z.reply : z.wait);
    var breaches = mine.filter(function (e) { return e.type === 'breach' && e.time <= now; });
    var last     = breaches.length ? breaches[breaches.length - 1] : null;

    var within   = elapsed != null && target !== '' && Number(elapsed) <= Number(target);
    var breached = !!last && !within;
    var done     = stops.length > 0;

    // When the clock finished, which is the date Zendesk files this SLA under:
    // the breach event's own timestamp when it breached, otherwise the stop.
    var stopped  = stops.length ? stops[stops.length - 1].time : null;
    var finished = !done ? null : breached && last ? last.time : stopped;

    var row = out[ticket] || (out[ticket] = {
      response:   { status: '', mins: '', target: '', at: null },
      resolution: { status: '', mins: '', target: '', at: null }
    });
    row[SLA_METRICS[metric]] = {
      status: breached ? (done ? 'Breached' : 'Breached (still open)') : done ? 'Met' : 'Running',
      mins:   elapsed == null ? '' : elapsed,
      target: target,
      at:     finished
    };
  });
  return out;
}

/**
 * The SLA events for both metrics, whole history.
 *
 * 21.1.0 ended the stream as soon as a page held fewer than 100 events.
 * Zendesk pages this export by TIME, not by count, so a quiet stretch returns
 * a short page in the MIDDLE of the stream and everything after it was never
 * read — which is why the RCA sheet stopped at #1287 on 6 September while the
 * ticket log ran on to 22 September. The stream now ends only where Zendesk
 * says it ends: end_of_stream, no next_page, or an empty page.
 */
function zdSlaEvents(started) {
  var start = 0, seen = {}, out = [], pages = 0, raw = 0, newest = 0;

  while (true) {
    if (Date.now() - started > 4.5 * 60 * 1000) {
      Logger.log('SLA events: out of time after ' + pages + ' page(s) — sheet left alone.');
      return null;
    }
    if (pages) Utilities.sleep(6500);          // this export allows 10 calls a minute
    var res = zdGet('/api/v2/incremental/ticket_metric_events.json?start_time=' + start);
    pages++;

    var evs = res.ticket_metric_events || [];
    raw += evs.length;
    evs.forEach(function (e) {
      var t = e.time ? new Date(e.time).getTime() : 0;
      if (t > newest) newest = t;
      if (e.deleted === true || !SLA_METRICS[e.metric] || seen[e.id]) return;
      if (e.type !== 'apply_sla' && e.type !== 'breach' &&
          e.type !== 'fulfill' && e.type !== 'update_status') return;
      if (e.metric === 'reply_time' && Number(e.instance_id) > 1) return;
      seen[e.id] = true;
      var sla = e.sla || {};
      out.push({
        id: Number(e.id) || 0, ticket: String(e.ticket_id), metric: e.metric,
        inst: Number(e.instance_id) || 0, type: e.type,
        time: t,
        mins: bizMin(e.status),
        target: sla.target != null ? Number(sla.target)
              : sla.target_in_seconds != null ? Number(sla.target_in_seconds) / 60 : ''
      });
    });

    // Where the next page starts: Zendesk's end_time, or the start_time it put
    // in next_page. Only Zendesk decides the stream is finished.
    var end = Number(res.end_time || 0);
    if (!end && res.next_page) {
      var m = String(res.next_page).match(/[?&]start_time=(\d+)/);
      if (m) end = Number(m[1]);
    }
    if (res.end_of_stream === true || !res.next_page || !evs.length) break;
    if (end <= start) {                    // a whole page inside one second
      Logger.log('SLA events: more than one page at ' + zdStamp(start) + ' — stepping a second on.');
      start = start + 1;
    } else {
      start = end;
    }
  }

  Logger.log('SLA events: ' + out.length + ' kept of ' + raw + ' read, ' + pages +
             ' page(s), newest event ' + (newest ? zdStamp(newest / 1000) : 'none'));
  return out;
}

/** Unix seconds -> a readable stamp, for the logs above. */
function zdStamp(sec) {
  return Utilities.formatDate(new Date(Number(sec) * 1000), TZ, 'dd-MMM-yyyy HH:mm');
}

/**
 * Read-only: walks the SLA event export and says, page by page, what Zendesk
 * returns. Run it if the RCA sheet ever looks like it stopped in the past.
 */
function slaEventProbe() {
  var start = 0, pages = 0, lastId = 0, newest = 0, started = Date.now();
  var out = ['SLA event export, page by page'];
  while (pages < 25 && Date.now() - started < 4 * 60 * 1000) {
    if (pages) Utilities.sleep(6500);
    var res = zdGet('/api/v2/incremental/ticket_metric_events.json?start_time=' + start);
    pages++;
    var evs = res.ticket_metric_events || [];
    evs.forEach(function (e) {
      var t = e.time ? new Date(e.time).getTime() : 0;
      if (t > newest) newest = t;
      var id = Number(e.ticket_id) || 0;
      if (id > lastId) lastId = id;
    });
    out.push('  page ' + pages + ': ' + zdPad(evs.length + ' events', 14) +
             'start ' + zdPad(zdStamp(start), 20) +
             'end ' + zdPad(res.end_time ? zdStamp(res.end_time) : '—', 20) +
             'end_of_stream ' + (res.end_of_stream === true ? 'YES' : 'no') +
             (res.next_page ? '' : '   no next_page'));
    var end = Number(res.end_time || 0);
    if (res.end_of_stream === true || !res.next_page || !evs.length) break;
    start = end > start ? end : start + 1;
  }
  out.push('  highest ticket seen : #' + lastId);
  out.push('  newest event        : ' + (newest ? zdStamp(newest / 1000) : 'none'));
  Logger.log(out.join('\n'));
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGERS  —  run skInstallTriggers() once, after the first clean sync
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Prints the five Explore SLA tiles for a date range, from the same numbers
 * the dashboard will show. Put Zendesk side by side with this log: if a tile
 * disagrees, the data is wrong, not the web app.
 *
 * Counts every clock that FINISHED inside the range, which is what Zendesk's
 * time filter does on its SLA tab. A ticket raised before the range still
 * counts here if its SLA finished inside it — that is the whole point.
 */
function slaCheckWindow() { return slaWindow(SLA_CHECK_RANGE[0], SLA_CHECK_RANGE[1]); }

function slaWindow(from, to) {
  var ss = activeSS();
  var sh = ss.getSheetByName(CLOCK_SHEET);
  if (!sh) { Logger.log('No "' + CLOCK_SHEET + '" tab yet — run syncSla() first.'); return null; }
  var n = sh.getLastRow() - 1;
  if (n < 1) { Logger.log('"' + CLOCK_SHEET + '" is empty — run syncSla() first.'); return null; }

  // Level and auto-alert come from the ticket log, for every ticket, not just
  // the ones raised inside the range.
  var log = ticketsSheet(ss), lvl = {}, auto = {};
  var rows = log.getLastRow() - HEADER_ROWS;
  if (rows > 0) {
    log.getRange(HEADER_ROWS + 1, 1, rows, COL.SUMMARY).getValues().forEach(function (r) {
      var k = normKey(r[COL.TICKET - 1]);
      if (!k) return;
      lvl[k]  = String(r[COL.LEVEL - 1] || '').trim().toUpperCase() === 'L3' ? 'L3' : 'L1';
      auto[k] = /^\s*automatic alert/i.test(String(r[COL.SUMMARY - 1] || ''));
    });
  }

  var t = { frTotal: 0, frBreach: 0, resTotal: 0, resBreach: 0,
            frCust: 0, frAuto: 0, resL1Cust: 0, resL3Cust: 0, resL1Auto: 0, resL3Auto: 0 };
  var listed = [];

  sh.getRange(2, 1, n, CLOCK_HEADERS.length).getValues().forEach(function (r) {
    var id = normKey(r[0]);
    if (!id) return;
    var isL3 = lvl[id] === 'L3', isAuto = !!auto[id];

    if (inRange(r[2], from, to) && clockCode(r[1])) {
      t.frTotal++;
      if (clockCode(r[1]) === 'B') {
        t.frBreach++; isAuto ? t.frAuto++ : t.frCust++;
        listed.push('#' + id + ' first response, ' + slaStamp(r[2]));
      }
    }
    if (inRange(r[4], from, to) && clockCode(r[3])) {
      t.resTotal++;
      if (clockCode(r[3]) === 'B') {
        t.resBreach++;
        if (isL3) { isAuto ? t.resL3Auto++ : t.resL3Cust++; }
        else      { isAuto ? t.resL1Auto++ : t.resL1Cust++; }
        listed.push('#' + id + ' resolution, ' + slaStamp(r[4]) + ', ' + lvl[id]);
      }
    }
  });

  var pc = function (bad, all) { return all ? (Math.round((1 - bad / all) * 1000) / 10).toFixed(1) : '100.0'; };
  Logger.log([
    'SLA for ' + from + ' to ' + to + '  (by the date each clock finished, as Zendesk counts it)',
    '  First Response SLA Compliance %      ' + pc(t.frBreach, t.frTotal) + '%   of ' + t.frTotal + ' clocks',
    '  First Response SLA breached tickets  ' + t.frBreach,
    '  Resolution SLA Compliance %          ' + pc(t.resBreach, t.resTotal) + '%   of ' + t.resTotal + ' clocks',
    '  Resolution SLA breached - L1         ' + (t.resL1Cust + t.resL1Auto),
    '  Resolution SLA breached - L3         ' + (t.resL3Cust + t.resL3Auto),
    '',
    '  1st Response breached - Customer     ' + t.frCust,
    '  1st Response breached - Auto         ' + t.frAuto,
    '  L1 Customer - Resolution breached    ' + t.resL1Cust,
    '  L3 Customer - Resolution breached    ' + t.resL3Cust,
    '  L1 Auto - Resolution breached        ' + t.resL1Auto,
    '  L3 Auto - Resolution breached        ' + t.resL3Auto,
    '',
    listed.length ? '  breached in this range:' : '  nothing breached in this range.'
  ].concat(listed.map(function (x) { return '    ' + x; })).join('\n'));
  return t;
}

/** Is this cell's date inside [from, to], compared as plain yyyy-MM-dd days? */
function inRange(v, from, to) {
  var d = slaStamp(v).substring(0, 10);
  return !!d && d >= from && d <= to;
}

function skInstallTriggers() {
  var ours = { zdSync: 1, syncDates: 1, importSla: 1, syncSla: 1, syncTickets: 1 };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (ours[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTickets').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('syncSla').timeBased().everyHours(1).create();
  Logger.log('Triggers: syncTickets every 15 min, syncSla every hour.');
}

/** Read-only check — run this before anything else. */
function skildStatus() {
  var ss = activeSS(), sheet = ticketsSheet(ss);
  var out = ['Skild AI CEC Console ' + SKILD_VERSION,
             '  spreadsheet : ' + ss.getName(),
             '  rows        : ' + Math.max(0, sheet.getLastRow() - HEADER_ROWS),
             '  columns     : ' + sheet.getMaxColumns() + ' (need ' + LAST_COL + ')'];
  try { assertWritable(sheet); out.push('  writable    : YES'); }
  catch (err) { out.push('  writable    : NO — ' + err.message.split('\n')[0]); }
  var p = PropertiesService.getScriptProperties();
  ['ZD_SUBDOMAIN', 'ZD_EMAIL', 'ZD_TOKEN'].forEach(function (k) {
    out.push('  ' + zdPad(k, 12) + ': ' + (p.getProperty(k) ? 'set' : 'MISSING'));
  });
  out.push('  triggers    : ' + (ScriptApp.getProjectTriggers()
    .map(function (t) { return t.getHandlerFunction(); }).join(', ') || 'none'));
  Logger.log(out.join('\n'));
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Zendesk GET with retries. A big page occasionally arrives cut off mid-JSON —
 * that is a broken transfer, not bad data, so the same request is asked again
 * rather than throwing "Unterminated string in JSON".
 */
function zdGet(path) {
  var p = PropertiesService.getScriptProperties();
  var sub = p.getProperty('ZD_SUBDOMAIN'), email = p.getProperty('ZD_EMAIL'),
      token = p.getProperty('ZD_TOKEN');
  if (!sub || !email || !token) {
    throw new Error('Set ZD_SUBDOMAIN, ZD_EMAIL and ZD_TOKEN in Script Properties.');
  }
  var url = path.indexOf('http') === 0 ? path : 'https://' + sub + '.zendesk.com' + path;
  var auth = Utilities.base64Encode(email + '/token:' + token);

  for (var attempt = 0; attempt < 4; attempt++) {
    var res = UrlFetchApp.fetch(url, {
      method: 'get', muteHttpExceptions: true,
      headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' }
    });
    var code = res.getResponseCode();
    if (code === 200) {
      var text = res.getContentText();
      try { return JSON.parse(text); }
      catch (err) {
        Logger.log('Zendesk reply came through truncated (' + text.length +
                   ' characters) — retrying.');
        Utilities.sleep(2000 * (attempt + 1));
        continue;
      }
    }
    if (code === 429) {
      Utilities.sleep((Number(res.getHeaders()['Retry-After'] || 10) + 1) * 1000);
      continue;
    }
    if (code === 401 || code === 403) {
      throw new Error('Zendesk rejected the credentials (' + code + '). Check ZD_EMAIL / ZD_TOKEN.');
    }
    if (code >= 500) { Utilities.sleep(2000 * (attempt + 1)); continue; }
    throw new Error('Zendesk ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  throw new Error('Zendesk unreachable after retries: ' + url);
}

/**
 * Created -> solved, in calendar minutes: Zendesk's own Full resolution time,
 * falling back to solved_at minus created_at when the metric set has none.
 * The two agree; the fallback only covers tickets Zendesk never metered.
 */
function resolutionMins(t, m) {
  var v = calMin(m.full_resolution_time_in_minutes);
  if (v != null) return v;
  if (!t.created_at || !m.solved_at) return null;
  return Math.round((new Date(m.solved_at).getTime() -
                     new Date(t.created_at).getTime()) / 60000);
}

/** Wall-clock side of a {calendar, business} pair. */
function calMin(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return Number(v);
  if (v.calendar != null) return Number(v.calendar);
  return v.business != null ? Number(v.business) : null;
}

/** Time metrics arrive as {calendar, business}; SLA targets are business minutes. */
function bizMin(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return Number(v);
  if (v.business != null) return Number(v.business);
  return v.calendar != null ? Number(v.calendar) : null;
}

/** "#19", "19", " #19 " and 19 are the same ticket. */
function normKey(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (!s) return '';
  var m = s.match(/\d+/);
  return m ? String(parseInt(m[0], 10)) : s.toLowerCase();
}

/**
 * Named skStatus, not normalizeStatus: another file in this project defines a
 * function of that name with different behaviour, and Apps Script silently
 * lets the last-loaded definition win across files in the same project.
 */
function skStatus(s) {
  var v = String(s || '').trim();
  if (FOLD_CLOSED_INTO_SOLVED && v.toLowerCase() === 'closed') return 'solved';
  return v;
}

function fmt(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, DATE_FMT);
  return v == null ? '' : String(v);
}

function zdPad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
