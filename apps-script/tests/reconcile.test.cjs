const fs = require('fs');
let src = fs.readFileSync('../SkyConsole-v9.gs','utf8');
const PROPS = { FLD_ISSUE_CATEGORY:'101', FLD_LEVEL:'102', FLD_ESCALATED:'103' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k=>PROPS[k]||null, setProperty(){}, deleteProperty(){} }) };
global.Utilities = { formatDate:(d)=>String(d), base64Encode:s=>s, sleep(){} };
global.Logger = { log: ()=>{} };
global.SpreadsheetApp={}; global.LockService={}; global.ScriptApp={}; global.ContentService={createTextOutput:()=>({setMimeType:()=>{}}),MimeType:{JSON:1}}; global.UrlFetchApp={};
eval(src);

// ── a fake sheet holding 4 rows that mirror the real defects ────────────────
const HDR = 2;
function makeSheet(grid) {
  const store = grid.map(r => r.slice());
  const writes = [];
  return {
    store, writes,
    getLastRow: () => HDR + store.length,
    getRange(row, col, h, w) {
      return {
        getValues: () => store.slice(row-HDR-1, row-HDR-1+h).map(r => r.slice(col-1, col-1+w)),
        setValues: (v) => { writes.push({row,col,h,w});
          v.forEach((rr,i)=>{ const target = row-HDR-1+i;
            if (!store[target]) store[target] = new Array(11).fill('');
            rr.forEach((c,j)=> store[target][col-1+j] = c); }); },
        setNumberFormat: () => {}, setFontWeight: () => {},
      };
    },
    setFrozenRows(){}, autoResizeColumns(){}, clear(){}, copyTo(){ return {setName(){}}; },
  };
}

const D = s => new Date(s);
// row: ticket, created, customer, owner, escalated, level, solved, status, type, summary, remarks
const grid = [
  // #532 solved 1s BEFORE created, and status stale (sheet says in progress)
  ['#532', D('2026-07-27T11:42:47Z'), 'SICK PCA', 'Sahil', 'No','L1', D('2026-07-27T11:42:46Z'), 'in progress', 'Sensors',
   'AI-written summary that must survive', 'Hand-written remark that must survive'],
  // #749 created stamped by a backfill (28 Aug) — Zendesk says 10 Aug
  ['#749', D('2026-08-28T10:23:54Z'), 'Vistaprint', 'Sahil', 'No','L1', '', 'solved', 'Generic Error',
   'summary here', ''],
  // #900 correct already, except sub-second drift on solved — must NOT be flagged
  ['#900', D('2026-08-20T08:00:00Z'), 'Truck Country', 'Sanath', 'No','L1', D('2026-08-20T09:30:00.904Z'), 'solved', 'Mapping',
   'fine', 'keep me'],
  // #1400 in the sheet but gone from Zendesk -> orphan
  ['#1400', D('2026-09-10T00:00:00Z'), 'Ghost Corp', 'Gokul', 'No','L1', '', 'pending', 'Others', '', ''],
];

const cf = (cat, lvl, esc) => [{id:101,value:cat},{id:102,value:lvl},{id:103,value:esc}];
const tickets = {
  list: [
    { id:532, created_at:'2026-07-27T11:42:47Z', updated_at:'2026-07-28T09:00:00Z', status:'solved',
      subject:'Sensors not visible', organization_id:7, assignee_id:9, custom_fields:cf('Sensors::Sensors','L1',false) },
    { id:749, created_at:'2026-08-10T23:26:25Z', updated_at:'2026-08-28T10:23:54Z', status:'solved',
      subject:'Robot offline', organization_id:8, assignee_id:9, custom_fields:cf('Generic Error::Generic Error','L1',false) },
    { id:900, created_at:'2026-08-20T08:00:00Z', updated_at:'2026-08-20T09:30:00Z', status:'solved',
      subject:'Map issue', organization_id:9, assignee_id:10, custom_fields:cf('Mapping::Mapping','L1',false) },
    // brand new, not in the sheet yet, and unassigned
    { id:1500, created_at:'2026-09-16T04:00:00Z', updated_at:'2026-09-16T04:00:00Z', status:'new',
      subject:'Automatic alert for garmin, freight100-1292', organization_id:7, assignee_id:null,
      custom_fields:cf('Generic Error::Generic Error','', false) },
  ],
  users: { 9:{name:'Sahil Kumar'}, 10:{name:'Sanath Reddy R'} },
  orgs:  { 7:{name:'SICK PCA'}, 8:{name:'Vistaprint'}, 9:{name:'Truck Country'} },
  metrics: {
    532:{ticket_id:532, solved_at:'2026-07-28T09:00:00Z'},
    749:{ticket_id:749, solved_at:'2026-08-11T02:10:00Z'},
    900:{ticket_id:900, solved_at:'2026-08-20T09:30:00Z'},
  }
};

let pass=0, fail=0;
const t=(n,g,w)=>{ const ok=JSON.stringify(g)===JSON.stringify(w);
  ok?pass++:(fail++,console.log(`FAIL ${n}\n  got  ${JSON.stringify(g)}\n  want ${JSON.stringify(w)}`)); };

// ── AUDIT pass: must change nothing ────────────────────────────────────────
const sA = makeSheet(grid);
const before = JSON.stringify(sA.store);
const audit = zdApplyToSheet(sA, tickets, false);
t('audit writes nothing', JSON.stringify(sA.store), before);
t('audit found new ticket', audit.newTickets, 1);
t('audit found orphan', audit.orphans.map(o=>o.ticket), ['#1400']);
const fields = audit.changed.map(c=>`${c.ticket}/${c.field}`).sort();
console.log('\nproposed changes:'); audit.changed.forEach(c =>
  console.log(`  ${c.ticket.padEnd(7)} ${c.field.padEnd(24)} ${fmtCell(c.was)}  ->  ${fmtCell(c.now)}`));
t('#900 sub-second drift not flagged', fields.filter(f=>f.startsWith('#900')), []);
t('#532 status flagged', fields.includes('#532/Status'), true);
t('#532 solved flagged', fields.includes('#532/Solved date'), true);
t('#749 created flagged', fields.includes('#749/Created Date and Time'), true);

// ── APPLY pass ─────────────────────────────────────────────────────────────
const sB = makeSheet(grid);
const res = zdApplyToSheet(sB, tickets, true);
const byId = {}; sB.store.forEach(r => byId[r[0]] = r);

t('#532 status corrected', byId['#532'][7], 'solved');
t('#532 solved corrected', byId['#532'][6].toISOString(), '2026-07-28T09:00:00.000Z');
t('#532 summary untouched', byId['#532'][9], 'AI-written summary that must survive');
t('#532 remarks untouched', byId['#532'][10], 'Hand-written remark that must survive');
t('#749 created corrected', byId['#749'][1].toISOString(), '2026-08-10T23:26:25.000Z');
t('#749 solved filled',     byId['#749'][6].toISOString(), '2026-08-11T02:10:00.000Z');
t('#900 untouched',         byId['#900'][6].toISOString(), '2026-08-20T09:30:00.904Z');
t('#900 remarks kept',      byId['#900'][10], 'keep me');
t('orphan #1400 kept',      !!byId['#1400'], true);
t('orphan not blanked',     byId['#1400'][7], 'pending');
t('new #1500 appended',     !!byId['#1500'], true);
t('new row summary = subject', byId['#1500'][9], 'Automatic alert for garmin, freight100-1292');
t('new row status mapped',  byId['#1500'][7], 'in progress');
t('new row remarks blank',  byId['#1500'][10], '');
t('rows added count',       res.added, 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
