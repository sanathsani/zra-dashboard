/**
 * Sky Console — final extension backend + ticket log sync + SLA Breach RCA sheet
 * =============================================================================
 * Replaces ALL existing code in the project. Paste it over everything.
 *
 *   1. Backend for the ZRA extension: Allowlist sign-in, create / get / update.
 *
 *   2. syncTickets() — every 15 minutes, brings "All tickets Info" in line with
 *      Zendesk:
 *        · a ticket in Zendesk with no row        -> row added
 *        · two rows for one ticket                -> extra removed, text merged
 *        · wrong values in B, D, E, F, G, H, I, J -> corrected
 *        · C Customer                             -> yours; only filled if blank
 *        · K Remarks                              -> never touched
 *      A row whose ticket number is not in Zendesk is reported, not deleted.
 *      previewTickets() shows everything it would do without writing.
 *
 *      Three rules keep it from damaging the sheet:
 *        · a value your dropdowns do not allow is skipped and reported, and
 *          anything written uses the dropdown's own spelling ("Pending", not
 *          "pending"; "Fleet / Site Issues", not "Fleet or Site Issues")
 *        · Issue Category "Other" in Zendesk means nobody chose one, so it
 *          never replaces a category your team picked
 *        · it refuses to delete more than 50 rows in a run
 *
 *   3. syncSla() — every hour, writes "SLA Breach - RCA": one row per breached
 *      ticket in your tracker's layout and colours. Zendesk fills 21 columns;
 *      Root Cause Description is yours and is preserved between runs.
 *
 * SETUP
 *   21.0.0 adds two columns to "All tickets Info": First Response (min) and
 *   Restoration (min), both straight from the Zendesk metric set the sync
 *   already downloads. Run syncTickets() once and every existing row is filled
 *   — there is no separate backfill to run.
 *
 *   1. Script Properties (already set): ZD_SUBDOMAIN, ZD_EMAIL, ZD_TOKEN
 *   2. previewTickets()   — writes nothing, logs what it would do
 *   3. syncTickets()      — copies the tab to a backup on its first run
 *   4. checkSla()         — builds the sheet and checks it against Explore
 *   5. installTriggers()
 *
 * After a code change: Deploy > Manage deployments > pencil > New version.
 * =============================================================================
 */

// ── CONFIG ──────────────────────────────────────────────────────────────────
var BACKEND_VERSION = '21.0.0';
var TICKETS_SHEET   = 'All tickets Info';
var ALLOWLIST_SHEET = 'Allowlist';
var RCA_SHEET       = 'SLA Breach - RCA';

/** Blank when the script is opened from the sheet; else set a SHEET_ID property. */
var SHEET_ID = '';

var TZ       = 'Asia/Kolkata';
var DATE_FMT = 'dd-MMM-yyyy HH:mm:ss';
var NUM_FMT  = 'dd-mmm-yyyy hh:mm:ss';

var COL = {
  TICKET: 1, CREATED: 2, CUSTOMER: 3, OWNER: 4, ESCALATED: 5,
  LEVEL: 6, SOLVED: 7, STATUS: 8, TYPE: 9, SUMMARY: 10, REMARKS: 11,
  /* 21.0.0 — the two Zendesk clocks the dashboard's time-bracket charts read.
     zdTickets() already fetched both; they were simply never written down. */
  RESPONSE: 12, RESTORE: 13
};
var LAST_COL    = 13;
var METRIC_HEADERS = { 12: 'First Response (min)', 13: 'Restoration (min)' };
var HEADER_ROWS = 2;

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

/**
 * "Other" in Zendesk's Issue Category means nobody picked a category, not that
 * the ticket belongs in a bucket called Other. The first v18 run replaced 47
 * specific categories — Navigation & Localization, Robot Hardware — with it.
 * So it is treated as no answer: written only into a blank cell, never over a
 * category your team chose.
 */
var TYPE_UNSPECIFIC = /^(other|others|miscellaneous|uncategorized|none)$/i;

/** Names Zendesk and the sheet give the same thing, where no rule can bridge them. */
var VALUE_ALIASES = { 'test tickets': 'Test', 'other': 'Others', 'others': 'Other' };

/** Zendesk priority -> the P-numbers the RCA tracker uses. */
var PRIORITY_MAP = { urgent: 'P1', high: 'P2', normal: 'P3', low: 'P4' };

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — backend the ZRA extension calls
// ═══════════════════════════════════════════════════════════════════════════

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (err) { return reply({ ok: false, error: 'Server busy, try again' }); }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return reply({ ok: false, error: 'Empty request' });
    }
    var req = JSON.parse(e.postData.contents);
    var email = String(req.userEmail || '').trim().toLowerCase();

    var access = checkAccess(email);
    if (!access.allowed) {
      return reply({ ok: false, code: 'DENIED',
        error: 'Access denied for ' + (email || 'unknown') + '. Add it to the Allowlist sheet.' });
    }

    var ss = activeSS();
    switch (req.action) {
      case 'whoami':    return reply({ ok: true, email: email, admin: access.admin,
                                       backendVersion: BACKEND_VERSION });
      case 'create':    return reply(createOrUpdate(ss, req));
      case 'update':    return reply(createOrUpdate(ss, req));
      case 'get':       return reply(getTicket(ss, req.ticket));
      case 'similar':   return reply(findSimilar(ss, req));
      case 'getConfig': return reply(getConfig(ss));
      default:          return reply({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return reply({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function doGet() {
  return reply({ ok: true, service: 'Sky Console backend', version: BACKEND_VERSION });
}

function checkAccess(email) {
  var sheet = ensureAllowlist();
  var last = sheet.getLastRow();
  if (last < 2) return { allowed: true, admin: true, unconfigured: true };
  if (!email) return { allowed: false };

  var rows = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    var e = String(rows[i][0] || '').trim().toLowerCase();
    if (e && e === email) {
      var flag = String(rows[i][1] || '').trim().toLowerCase();
      return { allowed: true, admin: (flag === 'yes' || flag === 'admin') };
    }
  }
  return { allowed: false };
}

function ensureAllowlist() {
  var ss = activeSS();
  var sh = ss.getSheetByName(ALLOWLIST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ALLOWLIST_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['Email', 'Admin (Yes/No)', 'Added']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Run once from the editor if the Allowlist is empty. */
function setupAdmin() {
  var ADMIN_EMAIL = 'sanath.reddy@awign.com';
  var allowlist = ensureAllowlist();
  if (allowlist.getLastRow() < 2) {
    allowlist.appendRow([ADMIN_EMAIL, 'Yes', new Date()]);
    Logger.log('Admin seeded: ' + ADMIN_EMAIL);
  } else {
    Logger.log('Allowlist already populated — add agents in the sheet.');
  }
}

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

/** Create and update share one path; a field the request leaves out is not blanked. */
function createOrUpdate(ss, req) {
  var sheet = ticketsSheet(ss);
  var ticket = String(req.ticket || '').trim();
  if (!ticket) return { ok: false, error: 'No ticket number' };

  var row = findRow(sheet, ticket);
  var isNew = row === -1;
  if (isNew) {
    row = firstEmptyRow(sheet);
    sheet.getRange(row, COL.TICKET).setValue(ticket);
    sheet.getRange(row, COL.CREATED).setValue(new Date()).setNumberFormat(NUM_FMT);
  }

  setIf(sheet, row, COL.CUSTOMER,  req.customer);
  setIf(sheet, row, COL.OWNER,     req.owner);
  setIf(sheet, row, COL.ESCALATED, req.escalated);
  setIf(sheet, row, COL.LEVEL,     req.level);
  setIf(sheet, row, COL.TYPE,      req.type);
  setIf(sheet, row, COL.SUMMARY,   req.summary);
  setIf(sheet, row, COL.REMARKS,   req.remarks);

  if (req.status) {
    var status = normalizeStatus(req.status);
    sheet.getRange(row, COL.STATUS).setValue(status);
    if (isResolvedStatus(status)) {
      var cell = sheet.getRange(row, COL.SOLVED);
      if (!cell.getValue()) cell.setValue(new Date()).setNumberFormat(NUM_FMT);
    }
  }
  return { ok: true, row: row, created: isNew, ticket: ticket };
}

function setIf(sheet, row, col, value) {
  if (value === undefined || value === null || value === '') return;
  sheet.getRange(row, col).setValue(value);
}

function getTicket(ss, ticket) {
  var sheet = ticketsSheet(ss);
  var row = findRow(sheet, ticket);
  if (row === -1) return { ok: true, found: false };
  var v = sheet.getRange(row, 1, 1, LAST_COL).getValues()[0];
  return { ok: true, found: true, row: rowToObject(v, row), ticket: rowToObject(v, row) };
}

function rowToObject(v, rowIndex) {
  return {
    row: rowIndex, rowIndex: rowIndex,
    ticket:    fmt(v[COL.TICKET    - 1]),
    created:   fmt(v[COL.CREATED   - 1]),
    customer:  fmt(v[COL.CUSTOMER  - 1]),
    owner:     fmt(v[COL.OWNER     - 1]),
    escalated: fmt(v[COL.ESCALATED - 1]),
    level:     fmt(v[COL.LEVEL     - 1]),
    solved:    fmt(v[COL.SOLVED    - 1]),
    status:    fmt(v[COL.STATUS    - 1]),
    type:      fmt(v[COL.TYPE      - 1]),
    summary:   fmt(v[COL.SUMMARY   - 1]),
    remarks:   fmt(v[COL.REMARKS   - 1])
  };
}

/** Past tickets in the same category, newest first — the HUD's history. */
function findSimilar(ss, req) {
  var sheet = ticketsSheet(ss);
  var needle = String(req.category || '').trim().toLowerCase();
  var limit = Number(req.limit || 5);
  if (!needle) return { ok: true, rows: [] };

  var last = sheet.getLastRow();
  if (last <= HEADER_ROWS) return { ok: true, rows: [] };

  var all = sheet.getRange(HEADER_ROWS + 1, 1, last - HEADER_ROWS, LAST_COL).getValues();
  var out = [];
  for (var i = all.length - 1; i >= 0 && out.length < limit; i--) {
    var type    = String(all[i][COL.TYPE    - 1] || '').toLowerCase();
    var remarks = String(all[i][COL.REMARKS - 1] || '').toLowerCase();
    var summary = String(all[i][COL.SUMMARY - 1] || '').toLowerCase();
    if (type.indexOf(needle) !== -1 || remarks.indexOf(needle) !== -1 ||
        summary.indexOf(needle) !== -1) {
      out.push(rowToObject(all[i], HEADER_ROWS + 1 + i));
    }
  }
  return { ok: true, rows: out };
}

function getConfig(ss) {
  var sheet = ticketsSheet(ss);
  return { ok: true, backendVersion: BACKEND_VERSION,
           rows: Math.max(0, sheet.getLastRow() - HEADER_ROWS) };
}

/**
 * 21.0.0 — the tracker grew two columns. Written once, styled to match the
 * headers already on the row, so nobody has to add them by hand.
 */
function ensureMetricColumns(sheet) {
  if (sheet.getMaxColumns() < LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), LAST_COL - sheet.getMaxColumns());
  }
  var model = sheet.getRange(1, COL.SUMMARY);          // an existing header cell
  Object.keys(METRIC_HEADERS).forEach(function (col) {
    var cell = sheet.getRange(1, Number(col));
    if (String(cell.getValue() || '').trim()) return;  // already there
    model.copyTo(cell, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    cell.setValue(METRIC_HEADERS[col]).setWrap(true);
    sheet.setColumnWidth(Number(col), 112);
  });
}

/** Provisional dates when someone types in the sheet; the sync corrects them. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== TICKETS_SHEET) return;
  var row = e.range.getRow(), col = e.range.getColumn();
  if (row <= HEADER_ROWS) return;

  if (col === COL.TICKET && e.value) {
    var c = sheet.getRange(row, COL.CREATED);
    if (!c.getValue()) c.setValue(new Date()).setNumberFormat(NUM_FMT);
  }
  if (col === COL.STATUS && isResolvedStatus(e.value)) {
    var s = sheet.getRange(row, COL.SOLVED);
    if (!s.getValue()) s.setValue(new Date()).setNumberFormat(NUM_FMT);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — the ticket log, brought in line with Zendesk
// ═══════════════════════════════════════════════════════════════════════════

/** The columns the sync corrects. Customer is filled only when blank. */
var OWNED = [
  ['created',   COL.CREATED,   'Created'],
  ['customer',  COL.CUSTOMER,  'Customer'],
  ['owner',     COL.OWNER,     'L1 owner'],
  ['escalated', COL.ESCALATED, 'Escalated'],
  ['level',     COL.LEVEL,     'L1 / L3'],
  ['solved',    COL.SOLVED,    'Solved'],
  ['status',    COL.STATUS,    'Status'],
  ['type',      COL.TYPE,      'Issue Type'],
  ['subject',   COL.SUMMARY,   'Issue Summary'],
  ['response',  COL.RESPONSE,  'First response (min)'],
  ['restore',   COL.RESTORE,   'Restoration (min)']
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
    if (apply) ensureMetricColumns(sheet);
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
        if (now === '' || now == null) return;
        if (FILL_ONLY_IF_BLANK[field] && String(was == null ? '' : was).trim()) return;
        if (field === 'type' && TYPE_UNSPECIFIC.test(String(now).trim()) &&
            String(was == null ? '' : was).trim()) return;      // Other means unset

        if (!(now instanceof Date)) {
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
                  w.response, w.restore]);
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
        sheet.getRange(HEADER_ROWS + 1, COL.CREATED, h, 1).setNumberFormat(NUM_FMT);
        sheet.getRange(HEADER_ROWS + 1, COL.SOLVED,  h, 1).setNumberFormat(NUM_FMT);
        sheet.getRange(HEADER_ROWS + 1, COL.RESPONSE, h, 2)
             .setNumberFormat('0').setHorizontalAlignment('right');
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
      lines.push('      ' + zdPad(spec[2], 15) + zdPad(String(changed[spec[2]]), 6) +
                 samples[spec[2]].join('   |   '));
    });
    Object.keys(skipped).forEach(function (label) {
      var values = Object.keys(skipped[label].seen);
      lines.push('  ' + zdPad(label + ' skipped', 21) + skipped[label].count +
                 ' — not on the sheet\'s dropdown list: ' + values.slice(0, 6).join(', ') +
                 (values.length > 6 ? ' …' : ''));
    });
    if (orphans.length) {
      lines.push('  not in Zendesk   : ' + orphans.length + ' row(s), left alone   ' +
                 orphans.slice(0, 15).join(', '));
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
    /* blank, not zero, when Zendesk has no clock — a ticket nobody replied to
       is the "No replies" bracket, which is not the same as a 0-minute reply. */
    response:  z.reply == null ? '' : Math.round(z.reply),
    restore:   z.wait  == null ? '' : Math.round(z.wait)
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
 * the whole write fail — cell I3 on the first v15 run, H669 on the next, where
 * Zendesk said "pending" and the list only allows "Pending". So every value is
 * matched against the list first and written in the list's own spelling.
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
 * "Fleet / Site Issues", "Software or Firmware" / "Software / Firmware" — so
 * the match ignores &, /, "and", "or", punctuation and a trailing s.
 */
function allowedValue(rules, col, value) {
  var v = String(value == null ? '' : value).trim();
  var set = rules[col];
  if (!set || !v) return v;

  // Zendesk's own wording first, then the alias — so either spelling of a
  // renamed value matches, whichever one the dropdown ends up holding.
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
  var a = String(was == null ? '' : was).trim(), b = String(now == null ? '' : now).trim();
  if (field === 'type') return normCategory(a).toLowerCase() === normCategory(b).toLowerCase();
  if (field === 'status' || field === 'escalated' || field === 'level' ||
      field === 'customer' || field === 'owner') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/** "Battery and Charging" and "Battery & Charging" are the same category. */
function normCategory(v) {
  return String(v || '').replace(/\s+and\s+/gi, ' & ').replace(/\s+/g, ' ').trim();
}

/**
 * Every ticket, with the fields both sheets need. Two calls for the tickets
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
      reply:     bizMin(m.reply_time_in_minutes),
      wait:      bizMin(m.requester_wait_time_in_minutes)
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
  if (key) return normalizeStatus(LABEL_MAP[key] || key);
  return normalizeStatus(STATUS_MAP[ticket.status] || ticket.status);
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
// PART 3 — "SLA Breach - RCA", one row per breached ticket
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
/** Your tracker's yellow headers; the rest are the pale blue ones. */
var RCA_YELLOW = { 1: 1, 4: 1, 7: 1, 8: 1, 9: 1, 11: 1, 12: 1, 13: 1,
                   15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 22: 1 };
var RCA_COL = { RESPONSE: 17, RESOLUTION: 20, RCA_TEXT: 22 };

function syncSla() {
  var events = zdSlaEvents(Date.now());
  if (!events) { Logger.log('SLA: the Zendesk export ran out of time — sheet left as it was.'); return null; }

  var ss = activeSS();
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
  Logger.log(slaSummary(rows, zd).join('\n'));
  return rows;
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

/** Ticket -> the customer your team entered in the log. */
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

/** Rebuilds the sheet in your tracker's layout and colours. */
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
  var byType = {}, byOwner = {};
  rows.forEach(function (r) {
    byType[r[2]] = (byType[r[2]] || 0) + 1;
    byOwner[r[12] || '—'] = (byOwner[r[12] || '—'] || 0) + 1;
  });
  var withRca = rows.filter(function (r) { return String(r[21] || '').trim(); }).length;
  var out = ['SLA Breach - RCA: ' + rows.length + ' breached tickets   (' +
             zd.count + ' tickets in Zendesk)'];
  Object.keys(byType).sort().forEach(function (k) { out.push('  ' + zdPad(k, 28) + byType[k]); });
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

    var row = out[ticket] || (out[ticket] = {
      response:   { status: '', mins: '', target: '' },
      resolution: { status: '', mins: '', target: '' }
    });
    row[SLA_METRICS[metric]] = {
      status: breached ? (done ? 'Breached' : 'Breached (still open)') : done ? 'Met' : 'Running',
      mins:   elapsed == null ? '' : elapsed,
      target: target
    };
  });
  return out;
}

/**
 * The SLA events for both metrics, whole history. Each page's end_time is the
 * next start_time, so events on that second repeat and are de-duplicated by id.
 * Events Zendesk withdrew are ignored. Null if it runs out of time.
 */
function zdSlaEvents(started) {
  var start = 0, seen = {}, out = [], pages = 0;
  while (true) {
    if (Date.now() - started > 4.5 * 60 * 1000) return null;
    if (pages) Utilities.sleep(6500);            // this export allows 10 calls a minute
    var res = zdGet('/api/v2/incremental/ticket_metric_events.json?start_time=' + start);
    pages++;

    var evs = res.ticket_metric_events || [];
    evs.forEach(function (e) {
      if (e.deleted === true || !SLA_METRICS[e.metric] || seen[e.id]) return;
      if (e.type !== 'apply_sla' && e.type !== 'breach' &&
          e.type !== 'fulfill' && e.type !== 'update_status') return;
      if (e.metric === 'reply_time' && Number(e.instance_id) > 1) return;
      seen[e.id] = true;
      var sla = e.sla || {};
      out.push({
        id: Number(e.id) || 0, ticket: String(e.ticket_id), metric: e.metric,
        inst: Number(e.instance_id) || 0, type: e.type,
        time: e.time ? new Date(e.time).getTime() : 0,
        mins: bizMin(e.status),
        target: sla.target != null ? Number(sla.target)
              : sla.target_in_seconds != null ? Number(sla.target_in_seconds) / 60 : ''
      });
    });

    if (evs.length < 100 || !res.next_page || res.end_of_stream) return out;
    var end = Number(res.end_time || 0);
    start = end > start ? end : start + 1;
  }
}

// ── Checking against Explore (safe to delete once you trust it) ─────────────

/** SLA Metrics tiles of the Explore dashboard, This year, read 17-Sep. */
var EXPLORE_TILES = { frBreached: 61, rwBreachedL3: 74, rwBreachedL1: 0 };

/** Ticket ids from the "Response SLA breached tickets" drill-in. */
var EXPLORE_RESPONSE_BREACHED = [
  42, 53, 54, 74, 75, 77, 79, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97,
  98, 99, 100, 101, 102, 111, 112, 113, 122, 126, 136, 146, 147, 157, 170, 171,
  177, 270, 283, 296, 297, 358, 393, 394, 404, 405, 408, 410, 417, 450, 516, 522,
  538, 560, 575, 734, 741, 743, 1015
];

/** Ticket ids from the "Resolution SLA breached tickets - L3" drill-in. */
var EXPLORE_RESOLUTION_L3_BREACHED = [
  19, 38, 41, 50, 51, 54, 60, 74, 75, 77, 79, 85, 87, 88, 89, 90, 91, 92, 93, 94,
  95, 96, 97, 98, 99, 100, 101, 102, 103, 111, 113, 122, 128, 136, 138, 140, 146,
  147, 169, 175, 176, 177, 252, 253, 284, 312, 355, 398, 414, 487, 502, 503, 514,
  521, 522, 534, 560, 566, 575, 715, 724, 727, 728, 754, 787, 803, 814, 839, 887,
  926, 930, 932, 1091, 1287
];

/** Builds the sheet, then compares it with Explore two ways. */
function checkSla() {
  var rows = syncSla();
  if (!rows) return;

  var fr = rows.filter(function (r) { return r[RCA_COL.RESPONSE - 1] === 'Breached'; });
  var rw = rows.filter(function (r) { return r[RCA_COL.RESOLUTION - 1] === 'Breached'; });
  function line(label, mine, theirs) {
    return '  ' + zdPad(label, 26) + zdPad(String(mine), 8) + 'Explore ' + theirs +
           (String(mine) === String(theirs) ? '' : '   <<');
  }
  var out = ['', 'CHECK 1 — the SLA Metrics dashboard tiles',
    line('First response breached', fr.length, EXPLORE_TILES.frBreached),
    line('Resolution breached', rw.length, EXPLORE_TILES.rwBreachedL3 + EXPLORE_TILES.rwBreachedL1)];

  out.push('', 'CHECK 2 — the drill-in exports, ticket by ticket');
  [['First response', RCA_COL.RESPONSE, EXPLORE_RESPONSE_BREACHED],
   ['Resolution',     RCA_COL.RESOLUTION, EXPLORE_RESOLUTION_L3_BREACHED]]
  .forEach(function (c) {
    var all = {}, rec = {}, exp = {};
    rows.forEach(function (r) {
      all[normKey(r[0])] = r;
      if (r[c[1] - 1] === 'Breached') rec[normKey(r[0])] = r;
    });
    c[2].forEach(function (id) { exp[String(id)] = true; });
    var both    = Object.keys(exp).filter(function (k) { return rec[k]; });
    var onlyExp = Object.keys(exp).filter(function (k) { return !rec[k]; });
    var onlyRec = Object.keys(rec).filter(function (k) { return !exp[k]; })
                    .sort(function (a, b) { return a - b; });

    out.push('', c[0] + ':  Explore ' + c[2].length + '   here ' + Object.keys(rec).length +
                 '   same ' + both.length,
             '  only in Explore : ' + (onlyExp.length ? onlyExp.map(function (k) { return '#' + k; }).join(', ') : 'none'),
             '  only here       : ' + (onlyRec.length ? onlyRec.map(function (k) { return '#' + k; }).join(', ') : 'none'));
  });

  out.push('', 'Breaches after the export, or tickets a report filters out, are expected to differ.');
  Logger.log(out.join('\n'));
}

/** Every SLA event Zendesk holds for the tickets listed in explainTickets(). */
function explainSla(list) {
  var out = [];
  String(list || '').split(/[^0-9]+/).filter(String).slice(0, 12).forEach(function (id) {
    var t = null, ev = [];
    try { t = zdGet('/api/v2/tickets/' + id + '.json').ticket; }
    catch (err) { out.push('#' + id + '  ticket: ' + err.message); }
    try { ev = flattenEvents(zdGet('/api/v2/tickets/' + id + '/metric_events.json')); }
    catch (err) { out.push('#' + id + '  events: ' + err.message); return; }

    out.push('', '#' + id + (t ? '   status ' + t.status + '   priority ' + (t.priority || 'none') +
      '   created ' + t.created_at : ''));
    ev.forEach(function (e) {
      if (!SLA_METRICS[e.metric] || e.type === 'measure') return;
      var sla = e.sla || {};
      out.push('   ' + zdPad(e.time, 22) + zdPad(e.type, 12) + zdPad(e.metric, 21) +
               'inst ' + zdPad(e.instance_id, 4) +
               (sla.policy ? '"' + sla.policy.title + '" target ' +
                 (sla.target != null ? sla.target : Number(sla.target_in_seconds) / 60) : '') +
               (e.deleted ? '   DELETED' : '') +
               (e.status ? '   ' + JSON.stringify(e.status) : ''));
    });
    if (!ev.length) out.push('   (no metric events)');
  });
  Logger.log(out.join('\n'));
}

/** The Run button passes no argument, so edit the list here and run this. */
function explainTickets() {
  explainSla('253, 200, 1053');
}

function flattenEvents(res) {
  var out = [];
  (function walk(v, depth) {
    if (!v || depth > 3) return;
    if (Object.prototype.toString.call(v) === '[object Array]') {
      v.forEach(function (x) {
        if (x && typeof x === 'object' && x.type && x.metric) out.push(x);
        else walk(x, depth + 1);
      });
    } else if (typeof v === 'object') {
      Object.keys(v).forEach(function (k) { walk(v[k], depth + 1); });
    }
  })(res, 0);
  return out.sort(function (a, b) { return String(a.time) < String(b.time) ? -1 : 1; });
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGERS
// ═══════════════════════════════════════════════════════════════════════════

/** Run once. Tickets every 15 minutes, SLA every hour; older triggers removed. */
function installTriggers() {
  var ours = { zdSync: 1, syncDates: 1, importSla: 1, syncSla: 1, syncTickets: 1 };
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (ours[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncTickets').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('syncSla').timeBased().everyHours(1).create();
  Logger.log('Triggers: syncTickets every 15 min, syncSla every hour.');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

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
      // A big page occasionally arrives cut off mid-JSON. That is a broken
      // transfer, not bad data, so the same request is simply asked again.
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

function normalizeStatus(s) {
  var v = String(s || '').trim();
  if (FOLD_CLOSED_INTO_SOLVED && v.toLowerCase() === 'closed') return 'solved';
  return v;
}

function isResolvedStatus(s) {
  var v = String(s || '').trim().toLowerCase();
  return v === 'solved' || v === 'closed';
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function fmt(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, DATE_FMT);
  return v == null ? '' : String(v);
}

function findRow(sheet, ticket) {
  var want = normKey(ticket);
  if (!want) return -1;
  var last = sheet.getLastRow();
  if (last <= HEADER_ROWS) return -1;
  var vals = sheet.getRange(HEADER_ROWS + 1, COL.TICKET, last - HEADER_ROWS, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (normKey(vals[i][0]) === want) return i + HEADER_ROWS + 1;
  }
  return -1;
}

function firstEmptyRow(sheet) {
  var last = sheet.getLastRow();
  if (last <= HEADER_ROWS) return HEADER_ROWS + 1;
  var vals = sheet.getRange(HEADER_ROWS + 1, COL.TICKET, last - HEADER_ROWS, 1).getValues();
  var lastData = HEADER_ROWS;
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() !== '') lastData = i + HEADER_ROWS + 1;
  }
  return lastData + 1;
}

function zdPad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
