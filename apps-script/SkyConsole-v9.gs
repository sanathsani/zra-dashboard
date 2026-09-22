/**
 * Sky Console v9 — Google Apps Script backend + Zendesk reconciler
 * =============================================================================
 * This replaces ALL existing code in the project. Paste it over everything.
 *
 * It merges two things that used to be separate:
 *   1. The v8 backend the ZRA extension talks to (whoami/create/get/update,
 *      plus `similar` and `getConfig`, which v8 had dropped).
 *   2. A reconciler that treats Zendesk as the authority for columns A-I.
 *
 * SHEET LAYOUT — "All tickets Info"
 *   A Ticket #        B Created Date     C Customer Name   D L1 Ticket Owner
 *   E Escalated       F L1 / L3          G Solved Date     H Status
 *   I Issue Type      J Issue Summary    K Remarks
 *
 * WHO OWNS WHAT
 *   A-I  Zendesk. Overwritten on every sync, so a wrong value anywhere in the
 *        chain is corrected within 15 minutes rather than living forever.
 *   J    The extension's AI summary. The sync writes it ONLY when blank.
 *   K    Yours, by hand. Never touched.
 *
 * WHAT CHANGED FROM v8 — three bugs, all of them silent
 *
 *   1. There were two onEdit() functions. The first watched column 7 for a
 *      status change and wrote the timestamp into column 6 — that is, it read
 *      Solved Date as if it were Status, and wrote into L1/L3. Only the second
 *      ran (a later function declaration replaces an earlier one), so it was
 *      dead code, but it was one reorder away from filling L1/L3 with dates.
 *      There is now one onEdit.
 *
 *   2. updateTicket() erased data. `req.owner || ""` means a request that
 *      omits owner blanks the owner already in the sheet. The same line existed
 *      for escalated, level, type, summary and remarks — so an update carrying
 *      only a status change wiped six columns, including hand-written Remarks.
 *      Fields are now only written when the request actually supplies them.
 *
 *   3. Created and Solved were stamped with now(), and stored as TEXT.
 *      now() recorded when the automation touched the row, not what Zendesk
 *      said: an audit of 1,220 rows found 106 solved before they were created,
 *      382 resolved tickets with no solved date, and created dates
 *      contradicting the ticket numbering by up to 17 days. Every rollup you
 *      have (Month-2026, Week-2026, the flow tabs, the dashboard trend) reads
 *      those two columns. They are now real Date values, and the sync corrects
 *      them from Zendesk. The local stamp is kept only as a provisional value
 *      so a fresh row is never blank.
 *
 * =============================================================================
 * SETUP
 *
 * 1. Zendesk API token
 *      https://skild-ai-support.zendesk.com/admin/apps-integrations/apis/zendesk-api/settings
 *      Turn ON "Token access" > API tokens tab > Add API token > Save
 *      Copy it immediately — it is shown once.
 *
 * 2. Project Settings (gear) > Script Properties:
 *      ZD_SUBDOMAIN   skild-ai-support
 *      ZD_EMAIL       the email of the account that created the token
 *      ZD_TOKEN       the token
 *
 * 3. Run zdListFields() once. Add the three ids it prints:
 *      FLD_ISSUE_CATEGORY   FLD_LEVEL   FLD_ESCALATED
 *
 * 4. Run zdAudit()      — read only. Writes a "Sync Audit" tab. Read it.
 * 5. Run zdReconcile()  — applies it, after backing the sheet up.
 * 6. Run zdInstallTrigger() — keeps it current every 15 minutes.
 *
 * Also run setupAdmin() once if the Allowlist is empty.
 *
 * After ANY code change, if the extension uses this as a web app:
 *   Deploy > Manage deployments > pencil > New version > Deploy
 * =============================================================================
 */

// ── CONFIG ──────────────────────────────────────────────────────────────────
var BACKEND_VERSION = '9.0.0';
var TICKETS_SHEET   = 'All tickets Info';
var ALLOWLIST_SHEET = 'Allowlist';
var AUDIT_SHEET     = 'Sync Audit';

/**
 * Leave blank when this script lives INSIDE the spreadsheet (opened via the
 * sheet's Extensions > Apps Script). Set it — or better, add a SHEET_ID script
 * property — when the script is standalone, because a standalone project has no
 * "active" spreadsheet and getActiveSpreadsheet() returns null.
 * The id is the long string in the sheet URL:
 *   docs.google.com/spreadsheets/d/<THIS PART>/edit
 */
var SHEET_ID = '';

var TZ       = 'Asia/Kolkata';
var DATE_FMT = 'dd-MMM-yyyy HH:mm:ss';   // for formatDate, i.e. text output
var NUM_FMT  = 'dd-mmm-yyyy hh:mm:ss';   // for setNumberFormat, i.e. cells

var COL = {
  TICKET: 1, CREATED: 2, CUSTOMER: 3, OWNER: 4, ESCALATED: 5,
  LEVEL: 6, SOLVED: 7, STATUS: 8, TYPE: 9, SUMMARY: 10, REMARKS: 11
};
var LAST_COL    = 11;
var HEADER_ROWS = 2;      // rows 1-2 are headers

/**
 * v8's normalizeStatus() folded "closed" into "solved", yet the sheet holds 127
 * rows that genuinely say "closed" — so the two disagreed. One switch now
 * governs both the extension path and the sync, so they cannot drift again.
 * false keeps Zendesk's distinction; true reproduces v8's behaviour.
 */
var FOLD_CLOSED_INTO_SOLVED = false;

/** Zendesk status -> the wording this sheet uses. */
var STATUS_MAP = {
  'new':     'in progress',
  'open':    'in progress',
  'hold':    'pending',      // waiting on a third party
  'pending': 'pending',      // waiting on the customer
  'solved':  'solved',
  'closed':  'closed'
};

/**
 * Zendesk agent name -> the first name the sheet uses. Anything unlisted falls
 * back to the first word, which is right for most people. zdAudit() reports
 * every name it could not match so you can add it here.
 */
var AGENT_ALIASES = {
  // 'Sanath Reddy R': 'Sanath',
};

var MAX_RUNTIME_MS = 4.5 * 60 * 1000;   // headroom under the 6-minute cap

/**
 * Two rows for one ticket double-count in every rollup, so extras are deleted —
 * but only after any hand-written Summary or Remarks on them is merged into the
 * row that survives. MAX_DELETES_PER_RUN is a circuit breaker: if a matching
 * bug ever made many rows look like duplicates, the run reports and deletes
 * nothing rather than gutting the sheet.
 */
var MAX_DELETES_PER_RUN = 25;

/** Sheet rows with no matching Zendesk ticket: listed, not deleted, by default. */
var DELETE_ORPHANS = false;

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — the backend the ZRA extension calls
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

// ── Access ──────────────────────────────────────────────────────────────────
function checkAccess(email) {
  var sheet = ensureAllowlist();
  var last = sheet.getLastRow();
  // An empty allowlist means "not set up yet" — allow, so the first connection
  // test can succeed and tell you what to do.
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
    sh.getRange(1, 1, 1, 3).setValues([['Email', 'Admin (Yes/No)', 'Added']])
      .setFontWeight('bold');
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

/** The spreadsheet to work on, whether this script is bound or standalone. */
function activeSS() {
  var id = SHEET_ID || PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No spreadsheet. This project is standalone, so add a ' +
                    'SHEET_ID script property holding the id from the sheet URL ' +
                    '(docs.google.com/spreadsheets/d/<id>/edit), or paste this ' +
                    'code into the script opened from the sheet itself via ' +
                    'Extensions > Apps Script.');
  }
  return ss;
}

function ticketsSheet(ss) {
  var sh = ss.getSheetByName(TICKETS_SHEET);
  if (!sh) throw new Error('Sheet "' + TICKETS_SHEET + '" not found');
  return sh;
}

// ── Ticket CRUD ─────────────────────────────────────────────────────────────
/**
 * One path for create and update. Unlike v8's updateTicket, a field absent from
 * the request leaves the cell alone instead of blanking it.
 */
function createOrUpdate(ss, req) {
  var sheet = ticketsSheet(ss);
  var ticket = String(req.ticket || '').trim();
  if (!ticket) return { ok: false, error: 'No ticket number' };

  var row = findRow(sheet, ticket);
  var isNew = row === -1;
  if (isNew) {
    row = firstEmptyRow(sheet);
    sheet.getRange(row, COL.TICKET).setValue(ticket);
    // Provisional only — the Zendesk sync replaces this with the real date.
    sheet.getRange(row, COL.CREATED).setValue(new Date())
         .setNumberFormat(NUM_FMT);
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

/** Write only when the request actually carries a value. */
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
    row:       rowIndex,
    rowIndex:  rowIndex,
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

/** Past tickets in the same category, newest first — powers the HUD's history. */
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

// ── onEdit — one function, watching the right columns ───────────────────────
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== TICKETS_SHEET) return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row <= HEADER_ROWS) return;

  // Ticket number typed in -> provisional created date, if blank.
  if (col === COL.TICKET && e.value) {
    var c = sheet.getRange(row, COL.CREATED);
    if (!c.getValue()) c.setValue(new Date()).setNumberFormat(NUM_FMT);
  }

  // Status set to solved/closed -> provisional solved date, if blank.
  // (v8 watched column 7 here and wrote to column 6. Both were wrong.)
  if (col === COL.STATUS) {
    if (isResolvedStatus(e.value)) {
      var s = sheet.getRange(row, COL.SOLVED);
      if (!s.getValue()) s.setValue(new Date()).setNumberFormat(NUM_FMT);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — the Zendesk reconciler
// ═══════════════════════════════════════════════════════════════════════════

/** Step 3. Prints every ticket field and its id. */
function zdListFields() {
  var res = zdGet('/api/v2/ticket_fields.json?per_page=100');
  var lines = ['', 'id          type                 title'];
  (res.ticket_fields || []).forEach(function (f) {
    lines.push(zdPad(String(f.id), 12) + zdPad(f.type, 21) + f.title);
  });
  lines.push('', 'Add to Script Properties: FLD_ISSUE_CATEGORY, FLD_LEVEL, FLD_ESCALATED');
  Logger.log(lines.join('\n'));
}

/** Step 4. Read-only: reports what a reconcile would change. */
function zdAudit() { zdRun({ apply: false }); }

/** Step 5. Applies the corrections, after backing the sheet up. */
function zdReconcile() { zdRun({ apply: true, backup: true }); }

/** Step 6. Every 15 minutes, quietly. */
function zdSync() { zdRun({ apply: true, backup: false, incrementalOnly: true }); }

function zdInstallTrigger() {
  zdRemoveTrigger();
  ScriptApp.newTrigger('zdSync').timeBased().everyMinutes(15).create();
  Logger.log('Trigger installed: zdSync every 15 minutes.');
}

function zdRemoveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'zdSync') ScriptApp.deleteTrigger(t);
  });
}

/** Forget the cursor so the next run re-reads the whole history. */
function zdResetCursor() {
  PropertiesService.getScriptProperties().deleteProperty('ZD_CURSOR');
  Logger.log('Cursor cleared — the next run does a full pass.');
}

function zdRun(opts) {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Another run is in progress.'); return; }

  try {
    var ss = activeSS();
    var sheet = ticketsSheet(ss);

    var tickets = zdFetchTickets(opts.incrementalOnly, started);
    if (!tickets.list.length) { Logger.log('Nothing new from Zendesk.'); return; }
    Logger.log('Zendesk returned ' + tickets.list.length + ' tickets.');

    if (opts.backup) {
      var name = TICKETS_SHEET + ' backup ' +
                 Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
      sheet.copyTo(ss).setName(name);
      Logger.log('Backed up to "' + name + '".');
    }

    var result = zdApplyToSheet(sheet, tickets, opts.apply);
    zdWriteAudit(ss, result, opts.apply);

    Logger.log([
      '', (opts.apply ? 'APPLIED' : 'AUDIT — nothing written'),
      '  rows added      : ' + result.added,
      '  cells corrected : ' + result.changed.length,
      '  duplicates      : ' + result.dupes.length + ' ticket(s), ' +
                               result.deleted + ' row(s) removed' +
                               (result.deleteBlocked ? '  << REFUSED, over safety limit' : ''),
      '  in Zendesk only : ' + result.newTickets,
      '  in sheet only   : ' + result.orphans.length +
        (result.orphans.length ? ' (' + result.orphans.slice(0, 10).map(function (o) {
          return o.ticket; }).join(', ') + ')' : ''),
      '  unmatched owners: ' + Object.keys(result.unknownOwners).join(', '),
      '', 'See the "' + AUDIT_SHEET + '" tab for the detail.'
    ].join('\n'));

  } finally {
    lock.releaseLock();
  }
}

// ── Zendesk HTTP ────────────────────────────────────────────────────────────
function zdProps() { return PropertiesService.getScriptProperties(); }

function zdGet(path) {
  var p = zdProps();
  var sub   = p.getProperty('ZD_SUBDOMAIN');
  var email = p.getProperty('ZD_EMAIL');
  var token = p.getProperty('ZD_TOKEN');
  if (!sub || !email || !token) {
    throw new Error('Set ZD_SUBDOMAIN, ZD_EMAIL and ZD_TOKEN in Script Properties.');
  }

  var url = path.indexOf('http') === 0 ? path : 'https://' + sub + '.zendesk.com' + path;
  var auth = Utilities.base64Encode(email + '/token:' + token);

  for (var attempt = 0; attempt < 4; attempt++) {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 429) {
      var wait = Number(res.getHeaders()['Retry-After'] || 10);
      Logger.log('Rate limited, waiting ' + wait + 's');
      Utilities.sleep((wait + 1) * 1000);
      continue;
    }
    if (code === 401 || code === 403) {
      throw new Error('Zendesk rejected the credentials (' + code + '). Check ZD_EMAIL ' +
                      'and ZD_TOKEN, and that token access is enabled.');
    }
    if (code >= 500) { Utilities.sleep(2000 * (attempt + 1)); continue; }
    throw new Error('Zendesk ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  throw new Error('Zendesk unreachable after retries: ' + url);
}

/**
 * Cursor-based incremental export, with users, organizations and metric_sets
 * sideloaded so names and the real solved_at arrive without extra calls.
 * The endpoint allows 10 calls a minute and 1000 tickets each, so a full pass
 * over ~1300 tickets is two calls.
 */
function zdFetchTickets(useCursor, started) {
  var p = zdProps();
  var list = [], users = {}, orgs = {}, metrics = {};
  var cursor = useCursor ? p.getProperty('ZD_CURSOR') : null;

  var base = '/api/v2/incremental/tickets/cursor.json?per_page=1000' +
             '&include=users,organizations,metric_sets';
  var url = cursor ? base + '&cursor=' + encodeURIComponent(cursor) : base + '&start_time=0';

  while (url) {
    if (Date.now() - started > MAX_RUNTIME_MS) {
      Logger.log('Time budget reached — the saved cursor resumes next run.');
      break;
    }
    var res = zdGet(url);
    (res.tickets       || []).forEach(function (t) { list.push(t); });
    (res.users         || []).forEach(function (u) { users[u.id] = u; });
    (res.organizations || []).forEach(function (o) { orgs[o.id] = o; });
    (res.metric_sets   || []).forEach(function (m) { metrics[m.ticket_id] = m; });

    if (res.after_cursor) p.setProperty('ZD_CURSOR', res.after_cursor);
    url = (res.end_of_stream || !res.after_url) ? null : res.after_url;
  }

  return { list: list, users: users, orgs: orgs, metrics: metrics };
}

// ── Mapping a Zendesk ticket to the nine owned columns ──────────────────────
function zdFieldValue(ticket, id) {
  if (!id) return '';
  var f = (ticket.custom_fields || []).filter(function (x) {
    return String(x.id) === String(id);
  })[0];
  return f && f.value != null ? String(f.value) : '';
}

/** "Generic Error::Generic Error" -> "Generic Error" (the sheet stores the leaf). */
function zdLeaf(v) {
  if (!v) return '';
  var parts = String(v).split('::');
  return parts[parts.length - 1].trim();
}

function zdYesNo(v) {
  // `v || ''` would turn a boolean false into '', which is exactly what a
  // Zendesk checkbox sends for "not escalated".
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (s === 'true' || s === 'yes' || s === '1') return 'Yes';
  if (s === 'false' || s === 'no' || s === '0') return 'No';
  return s.indexOf('escalat') !== -1 ? 'Yes' : 'No';
}

function zdAgentName(user) {
  if (!user || !user.name) return '';
  if (AGENT_ALIASES[user.name]) return AGENT_ALIASES[user.name];
  return String(user.name).trim().split(/\s+/)[0];
}

function zdDeriveLevel(ticket, p) {
  var lvl = zdLeaf(zdFieldValue(ticket, p.getProperty('FLD_LEVEL')));
  if (lvl) return lvl.toUpperCase().indexOf('L3') !== -1 ? 'L3' : 'L1';
  var esc = zdYesNo(zdFieldValue(ticket, p.getProperty('FLD_ESCALATED')));
  return esc === 'Yes' ? 'L3' : 'L1';
}

function zdToRow(ticket, ctx) {
  var p = ctx.p;
  var org      = ticket.organization_id ? ctx.orgs[ticket.organization_id]  : null;
  var assignee = ticket.assignee_id     ? ctx.users[ticket.assignee_id]     : null;
  var metric   = ctx.metrics[ticket.id];

  var escalated = zdYesNo(zdFieldValue(ticket, p.getProperty('FLD_ESCALATED')));
  var level = zdDeriveLevel(ticket, p);
  if (!escalated) escalated = (level === 'L3' ? 'Yes' : 'No');

  var solved = metric && metric.solved_at ? new Date(metric.solved_at) : '';
  if (!solved && isResolvedStatus(ticket.status) && ticket.updated_at) {
    solved = new Date(ticket.updated_at);   // no metric set: best available
  }

  return {
    ticket:      '#' + ticket.id,
    created:     ticket.created_at ? new Date(ticket.created_at) : '',
    customer:    org ? org.name : '',
    owner:       zdAgentName(assignee),
    escalated:   escalated,
    level:       level,
    solved:      solved,
    status:      normalizeStatus(STATUS_MAP[ticket.status] || ticket.status),
    type:        zdLeaf(zdFieldValue(ticket, p.getProperty('FLD_ISSUE_CATEGORY'))),
    subject:     ticket.subject || '',
    rawAssignee: assignee ? assignee.name : ''
  };
}

// ── Compare and write ───────────────────────────────────────────────────────
var OWNED = [
  ['created',   COL.CREATED,   'Created Date and Time'],
  ['customer',  COL.CUSTOMER,  'Customer Name'],
  ['owner',     COL.OWNER,     'L1 ticket owner'],
  ['escalated', COL.ESCALATED, 'Escalated'],
  ['level',     COL.LEVEL,     'L1 / L3'],
  ['solved',    COL.SOLVED,    'Solved date'],
  ['status',    COL.STATUS,    'Status'],
  ['type',      COL.TYPE,      'Issue Type']
];

/**
 * Canonical ticket key. "#19", "19", " #19 " and 19 are one ticket; without
 * this the lookup misses and a duplicate row gets appended instead.
 */
function normKey(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (!s) return '';
  var m = s.match(/\d+/);
  return m ? String(parseInt(m[0], 10)) : s.toLowerCase();
}

/** How much irreplaceable human writing a row carries. Remarks weigh more. */
function humanScore(row) {
  return (String(row[COL.SUMMARY - 1] || '').trim() ? 1 : 0) +
         (String(row[COL.REMARKS - 1] || '').trim() ? 2 : 0);
}

function sameValue(a, b) {
  var aDate = a instanceof Date, bDate = b instanceof Date;
  if (aDate || bDate) {
    if (!aDate || !bDate) return (a === '' || a == null) && (b === '' || b == null);
    return Math.abs(a.getTime() - b.getTime()) < 1000;   // ignore sub-second noise
  }
  return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}

function zdApplyToSheet(sheet, tickets, apply) {
  var p = zdProps();
  var ctx = { p: p, users: tickets.users, orgs: tickets.orgs, metrics: tickets.metrics };

  var lastRow = Math.max(sheet.getLastRow(), HEADER_ROWS);
  var height  = lastRow - HEADER_ROWS;
  var grid = height > 0
    ? sheet.getRange(HEADER_ROWS + 1, 1, height, LAST_COL).getValues()
    : [];

  // key -> every grid index carrying it, so duplicates are visible
  var index = {};
  for (var i = 0; i < grid.length; i++) {
    var key = normKey(grid[i][COL.TICKET - 1]);
    if (!key) continue;
    if (!index[key]) index[key] = [];
    index[key].push(i);
  }

  // Collapse duplicates: keep the row with the most human writing, merge the
  // others' Summary/Remarks into it, then mark them for deletion.
  var dupes = [], dropIdx = [];
  Object.keys(index).forEach(function (k) {
    var hits = index[k];
    if (hits.length < 2) return;

    var ranked = hits.map(function (ix) { return { i: ix, score: humanScore(grid[ix]) }; });
    ranked.sort(function (a, b) { return (b.score - a.score) || (a.i - b.i); });
    var keep = ranked[0].i;
    var drop = ranked.slice(1).map(function (r) { return r.i; });

    var merged = [];
    drop.forEach(function (d) {
      [[COL.SUMMARY, 'Issue Summary'], [COL.REMARKS, 'Remarks']].forEach(function (pair) {
        var col = pair[0];
        if (!String(grid[keep][col - 1] || '').trim() &&
             String(grid[d][col - 1] || '').trim()) {
          grid[keep][col - 1] = grid[d][col - 1];
          merged.push(pair[1] + ' from row ' + (HEADER_ROWS + 1 + d));
        }
      });
    });

    dupes.push({
      ticket:   String(grid[keep][COL.TICKET - 1] || '#' + k),
      keepRow:  HEADER_ROWS + 1 + keep,
      dropRows: drop.map(function (d) { return HEADER_ROWS + 1 + d; }),
      merged:   merged
    });
    drop.forEach(function (d) { dropIdx.push(d); });
    index[k] = [keep];
  });

  var changed = [], appended = [], unknownOwners = {}, newTickets = 0, seen = {};

  tickets.list.forEach(function (t) {
    if (t.status === 'deleted') return;
    var z = zdToRow(t, ctx);
    var key = normKey(z.ticket);
    seen[key] = true;

    if (z.rawAssignee && !z.owner) unknownOwners[z.rawAssignee] = true;

    var at = index[key] ? index[key][0] : undefined;
    if (at === undefined) { newTickets++; appended.push(z); return; }

    OWNED.forEach(function (spec) {
      var field = spec[0], col = spec[1], label = spec[2];
      var was = grid[at][col - 1], now = z[field];
      if (now === '' || now == null) return;        // never blank a filled cell
      if (sameValue(was, now)) return;
      changed.push({ ticket: z.ticket, row: HEADER_ROWS + 1 + at, col: col,
                     field: label, was: was, now: now });
      if (apply) grid[at][col - 1] = now;
    });

    // Issue Summary only when nobody has written one.
    if (apply && !String(grid[at][COL.SUMMARY - 1] || '').trim() && z.subject) {
      grid[at][COL.SUMMARY - 1] = z.subject;
    }
  });

  var orphanKeys = Object.keys(index).filter(function (k) { return !seen[k]; });
  var orphans = orphanKeys.map(function (k) {
    return { key: k, row: HEADER_ROWS + 1 + index[k][0],
             ticket: String(grid[index[k][0]][COL.TICKET - 1] || '#' + k) };
  });

  var deleteIdx = dropIdx.slice();
  if (DELETE_ORPHANS) orphanKeys.forEach(function (k) { deleteIdx.push(index[k][0]); });
  var deleteBlocked = deleteIdx.length > MAX_DELETES_PER_RUN;

  if (apply) {
    if (grid.length) {
      sheet.getRange(HEADER_ROWS + 1, 1, grid.length, LAST_COL).setValues(grid);
    }
    if (appended.length) {
      var block = appended.map(function (z) {
        return [z.ticket, z.created, z.customer, z.owner, z.escalated,
                z.level, z.solved, z.status, z.type, z.subject, ''];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, block.length, LAST_COL).setValues(block);
    }

    // Deletions last, bottom-up, so row numbers stay valid as we go. Appended
    // rows sit below everything here, so they only shift upward.
    if (deleteIdx.length && !deleteBlocked) {
      deleteIdx.map(function (ix) { return HEADER_ROWS + 1 + ix; })
               .sort(function (a, b) { return b - a; })
               .forEach(function (rowNum) { sheet.deleteRow(rowNum); });
    } else if (deleteBlocked) {
      Logger.log('REFUSED to delete ' + deleteIdx.length + ' rows — over the ' +
                 MAX_DELETES_PER_RUN + ' row safety limit. Nothing deleted. ' +
                 'Check the Sync Audit tab before raising MAX_DELETES_PER_RUN.');
    }

    // Real dates, explicitly formatted, so the SUMPRODUCT rollups keep matching.
    var h = sheet.getLastRow() - HEADER_ROWS;
    if (h > 0) {
      sheet.getRange(HEADER_ROWS + 1, COL.CREATED, h, 1).setNumberFormat(NUM_FMT);
      sheet.getRange(HEADER_ROWS + 1, COL.SOLVED,  h, 1).setNumberFormat(NUM_FMT);
    }
  }

  return { changed: changed, added: apply ? appended.length : 0,
           newTickets: newTickets, orphans: orphans, unknownOwners: unknownOwners,
           dupes: dupes, deleted: (apply && !deleteBlocked) ? deleteIdx.length : 0,
           deleteBlocked: deleteBlocked };
}

function zdWriteAudit(ss, result, applied) {
  var sh = ss.getSheetByName(AUDIT_SHEET) || ss.insertSheet(AUDIT_SHEET);
  sh.clear();

  var byField = {};
  result.changed.forEach(function (c) { byField[c.field] = (byField[c.field] || 0) + 1; });

  var out = [[applied ? 'APPLIED' : 'AUDIT ONLY — nothing was written',
              Utilities.formatDate(new Date(), TZ, DATE_FMT), '', '', '']];
  out.push(['', '', '', '', '']);
  out.push(['Summary', '', '', '', '']);
  out.push(['Cells differing from Zendesk', result.changed.length, '', '', '']);
  Object.keys(byField).sort().forEach(function (f) {
    out.push(['  ' + f, byField[f], '', '', '']);
  });
  out.push(['Tickets in Zendesk but not the sheet (added)', result.newTickets, '', '', '']);
  out.push(['Duplicate ticket rows', result.dupes.length,
            result.dupes.length ? 'extra rows: ' + result.dupes.reduce(function (n, d) {
              return n + d.dropRows.length; }, 0) : '', '', '']);
  if (result.deleteBlocked) {
    out.push(['!! DELETION REFUSED', 'over the ' + MAX_DELETES_PER_RUN + '-row safety limit',
              'nothing deleted — review below', '', '']);
  }
  out.push(['Tickets in the sheet but not Zendesk', result.orphans.length,
            result.orphans.slice(0, 40).map(function (o) { return o.ticket; }).join(', '),
            DELETE_ORPHANS ? 'deleted' : 'left alone', '']);
  var uo = Object.keys(result.unknownOwners);
  out.push(['Zendesk agents with no sheet name', uo.length, uo.join(', '), '', '']);

  if (result.dupes.length) {
    out.push(['', '', '', '', '']);
    out.push(['Duplicates', 'Row kept', 'Rows removed', 'Writing carried over', '']);
    result.dupes.forEach(function (d) {
      out.push([d.ticket, d.keepRow, d.dropRows.join(', '),
                d.merged.length ? d.merged.join('; ') : 'none', '']);
    });
  }

  out.push(['', '', '', '', '']);
  out.push(['Ticket', 'Field', 'Sheet had', 'Zendesk says', 'Row']);
  var headerAt = out.length;

  result.changed.forEach(function (c) {
    out.push([c.ticket, c.field, fmtCell(c.was), fmtCell(c.now), c.row]);
  });

  sh.getRange(1, 1, out.length, 5).setValues(out);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold');
  sh.getRange(headerAt, 1, 1, 5).setFontWeight('bold');
  sh.setFrozenRows(headerAt);
  sh.autoResizeColumns(1, 5);
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** One switch governs both the extension path and the sync, so they can't drift. */
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

/** Cells hold real Dates; text is produced only on output. */
function fmt(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, DATE_FMT);
  return v == null ? '' : String(v);
}

function fmtCell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, DATE_FMT);
  return (v === '' || v == null) ? '(blank)' : String(v);
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
