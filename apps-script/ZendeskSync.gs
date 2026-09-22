/**
 * ZendeskSync.gs — reconcile "All tickets Info" against Zendesk.
 * =============================================================================
 * WHY THIS EXISTS
 *
 * The sheet's ticket log is filled by hand and by the ZRA extension. Two of its
 * columns were being stamped with the time the automation touched the row, not
 * the time Zendesk recorded:
 *
 *   B "Created Date and Time"  <- now() when the row was inserted
 *   G "Solved date"            <- now() when the status first read solved
 *
 * Every date-based rollup you have sits on those two columns (Month-2026,
 * Week-2026, the monthly flow tabs, and the dashboard's daily trend), so a
 * wrong stamp quietly moves a ticket into the wrong day, week and month.
 *
 * Zendesk is the authority for both. This script takes ownership of columns
 * A-I, corrects them from the API on every run, and leaves the two columns your
 * team writes by hand alone.
 *
 *   A-I  ticket, created, customer, owner, escalated, L1/L3, solved, status, type
 *        -> overwritten from Zendesk every run
 *   J    Issue Summary  -> written ONLY when blank (raw subject as a stand-in;
 *                          the extension's AI summary is never overwritten)
 *   K    Remarks        -> never touched
 *
 * Because A-I are rewritten each run, a bad value written by anything else is
 * self-healing: it is corrected at the next sync.
 *
 * =============================================================================
 * SETUP — about ten minutes, in this order
 *
 * 1. Create a Zendesk API token
 *      Admin Center > Apps and integrations > APIs > Zendesk API
 *      > Settings: turn ON "Token access"
 *      > Add API token, give it a label, COPY IT NOW (shown once)
 *
 * 2. In this spreadsheet: Extensions > Apps Script, paste this file, save.
 *
 * 3. Project Settings (gear icon) > Script Properties > add:
 *      ZD_SUBDOMAIN   skild-ai-support
 *      ZD_EMAIL       your.name@awign.com      (the account the token belongs to)
 *      ZD_TOKEN       the token from step 1
 *
 * 4. Run  zdListFields()  once. The log prints every ticket field with its id.
 *    Add the three you need as Script Properties:
 *      FLD_ISSUE_CATEGORY   id of "Issue Category"
 *      FLD_LEVEL            id of the L1/L3 field
 *      FLD_ESCALATED        id of "Send to Escalation"
 *    (Leave one blank and the script derives it where it can — see deriveLevel.)
 *
 * 5. Run  zdAudit()  — READ ONLY. Writes a "Sync Audit" tab listing every
 *    difference it would make. Nothing else changes. Read it.
 *
 * 6. Happy with it? Run  zdReconcile()  to apply. It backs the sheet up first.
 *
 * 7. Run  zdInstallTrigger()  to keep it in sync every 15 minutes.
 *
 * Rate limits are not a concern here: the incremental export allows 10 calls a
 * minute and returns up to 1000 tickets each, so a full pass over ~1300 tickets
 * is two calls and a 15-minute trigger uses four an hour.
 * =============================================================================
 */

// ── Configuration ───────────────────────────────────────────────────────────
// Globals are prefixed ZD_ so this file can sit beside Sky Console v8 in the
// same Apps Script project without either overwriting the other's config.
var SHEET_NAME  = 'All tickets Info';
var AUDIT_SHEET = 'Sync Audit';
var ZD_HEADER_ROWS = 2;              // row 1 headers, row 2 sub-headers
var ZD_TZ          = 'Asia/Kolkata';
var ZD_NUM_FMT    = 'dd-mmm-yyyy hh:mm:ss';

var ZD_COL = {
  TICKET: 1, CREATED: 2, CUSTOMER: 3, OWNER: 4, ESCALATED: 5,
  LEVEL: 6, SOLVED: 7, STATUS: 8, TYPE: 9, SUMMARY: 10, REMARKS: 11
};

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
 * Zendesk agent name -> the first name the sheet uses.
 * Anything not listed falls back to the first word of the Zendesk name, which
 * is right for most people. zdAudit() reports every owner it could not match so
 * you can add it here.
 */
var AGENT_ALIASES = {
  // 'Sanath Reddy R': 'Sanath',
};

var MAX_RUNTIME_MS = 4.5 * 60 * 1000;   // leave headroom under the 6-minute cap

/**
 * Duplicate handling. Two rows for one ticket double-count in every rollup, so
 * the extra rows are deleted — but only after any hand-written Issue Summary or
 * Remarks on them is merged into the row that survives.
 *
 * MAX_DELETES_PER_RUN is a circuit breaker: if a matching bug ever made many
 * rows look like duplicates, the run reports and deletes nothing rather than
 * gutting the sheet. Raise it deliberately if a real cleanup needs more.
 */
var MAX_DELETES_PER_RUN = 25;

/**
 * Rows in the sheet with no matching Zendesk ticket. Left alone by default and
 * listed in the audit: they are usually deleted tickets or a mistyped number,
 * and that is your call, not the script's.
 */
var DELETE_ORPHANS = false;

// ── Entry points ────────────────────────────────────────────────────────────

/** Step 4. Prints every ticket field and its id. */
function zdListFields() {
  var res = zdGet('/api/v2/ticket_fields.json?per_page=100');
  var lines = ['', 'id          type                 title'];
  (res.ticket_fields || []).forEach(function (f) {
    lines.push(zdPad(String(f.id), 12) + zdPad(f.type, 21) + f.title);
  });
  lines.push('', 'Add to Script Properties: FLD_ISSUE_CATEGORY, FLD_LEVEL, FLD_ESCALATED');
  Logger.log(lines.join('\n'));
}

/** Step 5. Read-only. Reports what a reconcile would change. */
function zdAudit() { run_({ apply: false }); }

/** Step 6. Applies the corrections. Backs up the sheet first. */
function zdReconcile() { run_({ apply: true, backup: true }); }

/** Step 7. Every 15 minutes, apply quietly. */
function zdSync() { run_({ apply: true, backup: false, incrementalOnly: true }); }

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

/** Forget the saved cursor so the next run re-reads the whole history. */
function zdResetCursor() {
  PropertiesService.getScriptProperties().deleteProperty('ZD_CURSOR');
  Logger.log('Cursor cleared — the next run does a full pass.');
}

// ── The run ─────────────────────────────────────────────────────────────────
function run_(opts) {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Another run is in progress.'); return; }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('Sheet "' + SHEET_NAME + '" not found');

    // A full pass for audit/reconcile; the cursor only for the timed sync.
    var tickets = fetchTickets_(opts.incrementalOnly, started);
    if (!tickets.list.length) { Logger.log('Nothing new from Zendesk.'); return; }
    Logger.log('Zendesk returned ' + tickets.list.length + ' tickets.');

    if (opts.backup) {
      var name = SHEET_NAME + ' backup ' + Utilities.formatDate(new Date(), ZD_TZ, 'yyyy-MM-dd HH:mm');
      sheet.copyTo(ss).setName(name);
      Logger.log('Backed up to "' + name + '".');
    }

    var result = applyToSheet_(sheet, tickets, opts.apply);
    writeAudit_(ss, result, opts.apply);

    Logger.log([
      '', (opts.apply ? 'APPLIED' : 'AUDIT — nothing written'),
      '  rows added      : ' + result.added,
      '  cells corrected : ' + result.changed.length,
      '  duplicates      : ' + result.dupes.length + ' ticket(s), ' + result.deleted + ' row(s) removed' +
                               (result.deleteBlocked ? '  << REFUSED, over safety limit' : ''),
      '  in Zendesk only : ' + result.newTickets,
      '  in sheet only   : ' + result.orphans.length + (result.orphans.length ? ' (' + result.orphans.slice(0, 10).map(function (o) { return o.ticket; }).join(', ') + ')' : ''),
      '  unmatched owners: ' + Object.keys(result.unknownOwners).join(', '),
      '', 'See the "' + AUDIT_SHEET + '" tab for the detail.'
    ].join('\n'));

  } finally {
    lock.releaseLock();
  }
}

// ── Zendesk ─────────────────────────────────────────────────────────────────
function props_() { return PropertiesService.getScriptProperties(); }

function zdGet(path) {
  var p = props_();
  var sub = p.getProperty('ZD_SUBDOMAIN'), email = p.getProperty('ZD_EMAIL'), token = p.getProperty('ZD_TOKEN');
  if (!sub || !email || !token) throw new Error('Set ZD_SUBDOMAIN, ZD_EMAIL and ZD_TOKEN in Script Properties.');

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
      throw new Error('Zendesk rejected the credentials (' + code + '). Check ZD_EMAIL/ZD_TOKEN, and that token access is enabled.');
    }
    if (code >= 500) { Utilities.sleep(2000 * (attempt + 1)); continue; }
    throw new Error('Zendesk ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  throw new Error('Zendesk unreachable after retries: ' + url);
}

/**
 * Cursor-based incremental export, with users/organizations/metric_sets
 * sideloaded so we get names and the real solved_at without extra calls.
 */
function fetchTickets_(useCursor, started) {
  var p = props_();
  var list = [], users = {}, orgs = {};
  var cursor = useCursor ? p.getProperty('ZD_CURSOR') : null;

  var url = cursor
    ? '/api/v2/incremental/tickets/cursor.json?cursor=' + encodeURIComponent(cursor) + '&per_page=1000&include=users,organizations,metric_sets'
    : '/api/v2/incremental/tickets/cursor.json?start_time=0&per_page=1000&include=users,organizations,metric_sets';

  var metrics = {};
  while (url) {
    if (Date.now() - started > MAX_RUNTIME_MS) {
      Logger.log('Time budget reached — stopping early; the saved cursor resumes next run.');
      break;
    }
    var res = zdGet(url);
    (res.tickets || []).forEach(function (t) { list.push(t); });
    (res.users || []).forEach(function (u) { users[u.id] = u; });
    (res.organizations || []).forEach(function (o) { orgs[o.id] = o; });
    (res.metric_sets || []).forEach(function (m) { metrics[m.ticket_id] = m; });

    if (res.after_cursor) p.setProperty('ZD_CURSOR', res.after_cursor);
    url = (res.end_of_stream || !res.after_url) ? null : res.after_url;
  }

  return { list: list, users: users, orgs: orgs, metrics: metrics };
}

// ── Mapping one Zendesk ticket to the sheet's nine owned columns ────────────
function fieldValue_(ticket, id) {
  if (!id) return '';
  var f = (ticket.custom_fields || []).filter(function (x) { return String(x.id) === String(id); })[0];
  return f && f.value != null ? String(f.value) : '';
}

/** "Generic Error::Generic Error" -> "Generic Error" (the sheet stores the leaf). */
function leafOf_(v) {
  if (!v) return '';
  var parts = String(v).split('::');
  return parts[parts.length - 1].trim();
}

function yesNo_(v) {
  // Note: `v || ''` would turn a boolean false into '', which is exactly what a
  // Zendesk checkbox field sends for "not escalated".
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (s === 'true' || s === 'yes' || s === '1') return 'Yes';
  if (s === 'false' || s === 'no' || s === '0') return 'No';
  return s.indexOf('escalat') !== -1 ? 'Yes' : 'No';
}

function agentName_(user) {
  if (!user || !user.name) return '';
  if (AGENT_ALIASES[user.name]) return AGENT_ALIASES[user.name];
  return String(user.name).trim().split(/\s+/)[0];
}

function deriveLevel_(ticket, p) {
  var lvl = leafOf_(fieldValue_(ticket, p.getProperty('FLD_LEVEL')));
  if (lvl) return lvl.toUpperCase().indexOf('L3') !== -1 ? 'L3' : 'L1';
  // No L1/L3 field configured: fall back to whether it was escalated.
  var esc = yesNo_(fieldValue_(ticket, p.getProperty('FLD_ESCALATED')));
  return esc === 'Yes' ? 'L3' : 'L1';
}

function zdToRow_(ticket, ctx) {
  var p = ctx.p;
  var org = ticket.organization_id ? ctx.orgs[ticket.organization_id] : null;
  var assignee = ticket.assignee_id ? ctx.users[ticket.assignee_id] : null;
  var metric = ctx.metrics[ticket.id];

  var escalated = yesNo_(fieldValue_(ticket, p.getProperty('FLD_ESCALATED')));
  var level = deriveLevel_(ticket, p);
  if (!escalated) escalated = (level === 'L3' ? 'Yes' : 'No');

  var solved = metric && metric.solved_at ? new Date(metric.solved_at) : '';
  // A solved/closed ticket with no metric set: fall back to the last update.
  if (!solved && (ticket.status === 'solved' || ticket.status === 'closed') && ticket.updated_at) {
    solved = new Date(ticket.updated_at);
  }

  return {
    ticket:    '#' + ticket.id,
    created:   ticket.created_at ? new Date(ticket.created_at) : '',
    customer:  org ? org.name : '',
    owner:     agentName_(assignee),
    escalated: escalated,
    level:     level,
    solved:    solved,
    status:    STATUS_MAP[ticket.status] || ticket.status,
    type:      leafOf_(fieldValue_(ticket, p.getProperty('FLD_ISSUE_CATEGORY'))),
    subject:   ticket.subject || '',
    rawAssignee: assignee ? assignee.name : ''
  };
}

// ── Compare and write ───────────────────────────────────────────────────────

/**
 * Canonical ticket key. "#19", "19", " #19 " and 19 are the same ticket; without
 * this the lookup misses and the script appends a duplicate instead of updating.
 */
function normKey_(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (!s) return '';
  var m = s.match(/\d+/);
  return m ? String(parseInt(m[0], 10)) : s.toLowerCase();
}

/** How much irreplaceable human writing a row carries. Remarks weigh more. */
function humanScore_(row) {
  var summary = String(row[ZD_COL.SUMMARY - 1] || '').trim() ? 1 : 0;
  var remarks = String(row[ZD_COL.REMARKS - 1] || '').trim() ? 2 : 0;
  return summary + remarks;
}
var OWNED = [
  ['created',   ZD_COL.CREATED,   'Created Date and Time'],
  ['customer',  ZD_COL.CUSTOMER,  'Customer Name'],
  ['owner',     ZD_COL.OWNER,     'L1 ticket owner'],
  ['escalated', ZD_COL.ESCALATED, 'Escalated'],
  ['level',     ZD_COL.LEVEL,     'L1 / L3'],
  ['solved',    ZD_COL.SOLVED,    'Solved date'],
  ['status',    ZD_COL.STATUS,    'Status'],
  ['type',      ZD_COL.TYPE,      'Issue Type']
];

function sameValue_(a, b) {
  var aDate = a instanceof Date, bDate = b instanceof Date;
  if (aDate || bDate) {
    if (!aDate || !bDate) return (a === '' || a == null) && (b === '' || b == null);
    return Math.abs(a.getTime() - b.getTime()) < 1000;   // ignore sub-second noise
  }
  return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}

function applyToSheet_(sheet, tickets, apply) {
  var p = props_();
  var ctx = { p: p, users: tickets.users, orgs: tickets.orgs, metrics: tickets.metrics };

  var lastRow = Math.max(sheet.getLastRow(), ZD_HEADER_ROWS);
  var height = lastRow - ZD_HEADER_ROWS;
  var grid = height > 0
    ? sheet.getRange(ZD_HEADER_ROWS + 1, 1, height, ZD_COL.REMARKS).getValues()
    : [];

  // key -> every grid index carrying it, so duplicates are visible
  var index = {};
  for (var i = 0; i < grid.length; i++) {
    var key = normKey_(grid[i][ZD_COL.TICKET - 1]);
    if (!key) continue;
    if (!index[key]) index[key] = [];
    index[key].push(i);
  }

  // ── resolve duplicates: keep the row holding the most human writing, merge
  //    the others' Summary/Remarks into it, and mark them for deletion.
  var dupes = [], dropIdx = [];
  Object.keys(index).forEach(function (k) {
    var hits = index[k];
    if (hits.length < 2) return;

    var ranked = hits.map(function (i) { return { i: i, score: humanScore_(grid[i]) }; });
    ranked.sort(function (a, b) { return (b.score - a.score) || (a.i - b.i); });
    var keep = ranked[0].i;
    var drop = ranked.slice(1).map(function (r) { return r.i; });

    var merged = [];
    drop.forEach(function (d) {
      [[ZD_COL.SUMMARY, 'Issue Summary'], [ZD_COL.REMARKS, 'Remarks']].forEach(function (pair) {
        var col = pair[0];
        var keepVal = String(grid[keep][col - 1] || '').trim();
        var dropVal = String(grid[d][col - 1] || '').trim();
        if (!keepVal && dropVal) {
          grid[keep][col - 1] = grid[d][col - 1];
          merged.push(pair[1] + ' from row ' + (ZD_HEADER_ROWS + 1 + d));
        }
      });
    });

    dupes.push({
      ticket: String(grid[keep][ZD_COL.TICKET - 1] || '#' + k),
      keepRow: ZD_HEADER_ROWS + 1 + keep,
      dropRows: drop.map(function (d) { return ZD_HEADER_ROWS + 1 + d; }),
      merged: merged
    });
    drop.forEach(function (d) { dropIdx.push(d); });
    index[k] = [keep];
  });

  var changed = [], appended = [], unknownOwners = {}, newTickets = 0;
  var seen = {};

  tickets.list.forEach(function (t) {
    if (t.status === 'deleted') return;
    var z = zdToRow_(t, ctx);
    seen[normKey_(z.ticket)] = true;

    if (z.rawAssignee && z.owner && z.rawAssignee.split(/\s+/)[0] !== z.owner) {
      // alias in use — fine
    } else if (z.rawAssignee && !z.owner) {
      unknownOwners[z.rawAssignee] = true;
    }

    var at = index[normKey_(z.ticket)] ? index[normKey_(z.ticket)][0] : undefined;
    if (at === undefined) {
      newTickets++;
      appended.push(z);
      return;
    }

    OWNED.forEach(function (spec) {
      var key = spec[0], col = spec[1], label = spec[2];
      var was = grid[at][col - 1];
      var now = z[key];
      if (now === '' || now == null) return;          // never blank a filled cell
      if (sameValue_(was, now)) return;
      changed.push({ ticket: z.ticket, row: ZD_HEADER_ROWS + 1 + at, col: col,
                     field: label, was: was, now: now });
      if (apply) grid[at][col - 1] = now;
    });

    // Issue Summary only when the team has not written one.
    if (apply && !String(grid[at][ZD_COL.SUMMARY - 1] || '').trim() && z.subject) {
      grid[at][ZD_COL.SUMMARY - 1] = z.subject;
    }
  });

  var orphanKeys = Object.keys(index).filter(function (k) { return !seen[k]; });
  var orphans = orphanKeys.map(function (k) {
    return { key: k, row: ZD_HEADER_ROWS + 1 + index[k][0],
             ticket: String(grid[index[k][0]][ZD_COL.TICKET - 1] || '#' + k) };
  });

  // Rows to remove: duplicates always, orphans only if explicitly enabled.
  var deleteIdx = dropIdx.slice();
  if (DELETE_ORPHANS) orphanKeys.forEach(function (k) { deleteIdx.push(index[k][0]); });

  var deleteBlocked = deleteIdx.length > MAX_DELETES_PER_RUN;

  if (apply) {
    if (grid.length) {
      sheet.getRange(ZD_HEADER_ROWS + 1, 1, grid.length, ZD_COL.REMARKS).setValues(grid);
    }
    if (appended.length) {
      var block = appended.map(function (z) {
        return [z.ticket, z.created, z.customer, z.owner, z.escalated,
                z.level, z.solved, z.status, z.type, z.subject, ''];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, block.length, ZD_COL.REMARKS).setValues(block);
    }

    // Deletions last, and bottom-up so the row numbers stay valid as we go.
    // Appended rows sit below everything here, so they only shift upward.
    if (deleteIdx.length && !deleteBlocked) {
      deleteIdx
        .map(function (i) { return ZD_HEADER_ROWS + 1 + i; })
        .sort(function (a, b) { return b - a; })
        .forEach(function (rowNum) { sheet.deleteRow(rowNum); });
    } else if (deleteBlocked) {
      Logger.log('REFUSED to delete ' + deleteIdx.length + ' rows — over the ' +
                 MAX_DELETES_PER_RUN + ' row safety limit. Nothing was deleted. ' +
                 'Check the Sync Audit tab before raising MAX_DELETES_PER_RUN.');
    }

    // Real dates, explicitly formatted, so the SUMPRODUCT rollups keep matching.
    var h = sheet.getLastRow() - ZD_HEADER_ROWS;
    if (h > 0) {
      sheet.getRange(ZD_HEADER_ROWS + 1, ZD_COL.CREATED, h, 1).setNumberFormat(ZD_NUM_FMT);
      sheet.getRange(ZD_HEADER_ROWS + 1, ZD_COL.SOLVED,  h, 1).setNumberFormat(ZD_NUM_FMT);
    }
  }

  return { changed: changed, added: apply ? appended.length : 0,
           newTickets: newTickets, orphans: orphans, unknownOwners: unknownOwners,
           dupes: dupes, deleted: (apply && !deleteBlocked) ? deleteIdx.length : 0,
           deleteBlocked: deleteBlocked };
}

function writeAudit_(ss, result, applied) {
  var sh = ss.getSheetByName(AUDIT_SHEET) || ss.insertSheet(AUDIT_SHEET);
  sh.clear();

  var byField = {};
  result.changed.forEach(function (c) { byField[c.field] = (byField[c.field] || 0) + 1; });

  var out = [[applied ? 'APPLIED' : 'AUDIT ONLY — nothing was written',
              Utilities.formatDate(new Date(), ZD_TZ, 'dd-MMM-yyyy HH:mm:ss'), '', '', '']];
  out.push(['', '', '', '', '']);
  out.push(['Summary', '', '', '', '']);
  out.push(['Cells differing from Zendesk', result.changed.length, '', '', '']);
  Object.keys(byField).sort().forEach(function (f) { out.push(['  ' + f, byField[f], '', '', '']); });
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
    out.push([c.ticket, c.field, fmtCell_(c.was), fmtCell_(c.now), c.row]);
  });

  sh.getRange(1, 1, out.length, 5).setValues(out);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold');
  sh.getRange(headerAt, 1, 1, 5).setFontWeight('bold');
  sh.setFrozenRows(headerAt);
  sh.autoResizeColumns(1, 5);
}

function fmtCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZD_TZ, 'dd-MMM-yyyy HH:mm:ss');
  return v === '' || v == null ? '(blank)' : String(v);
}

function zdPad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
