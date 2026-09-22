// Exercise the pure logic against the real shapes, with Apps Script stubbed out.
const fs = require('fs');
let src = fs.readFileSync('../SkyConsole-v9.gs','utf8');

const PROPS = { FLD_ISSUE_CATEGORY:'101', FLD_LEVEL:'102', FLD_ESCALATED:'103' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => PROPS[k] || null, setProperty(){}, deleteProperty(){} }) };
global.Utilities = { formatDate: (d)=>d.toISOString(), base64Encode: s=>Buffer.from(s).toString('base64'), sleep(){} };
global.Logger = { log: ()=>{} };
global.SpreadsheetApp = {}; global.LockService = {}; global.ScriptApp = {}; global.UrlFetchApp = {};
eval(src);

let pass=0, fail=0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`));
};

// zdLeaf — the Parent::Child field the sheet stores as its leaf
t('leaf nested', zdLeaf('Generic Error::Generic Error'), 'Generic Error');
t('leaf deep',   zdLeaf('Hardware::Battery::Charging'), 'Charging');
t('leaf plain',  zdLeaf('Sensors'), 'Sensors');
t('leaf empty',  zdLeaf(null), '');

// zdYesNo
t('yes bool', zdYesNo(true), 'Yes');
t('no bool',  zdYesNo(false), 'No');
t('yes str',  zdYesNo('yes'), 'Yes');
t('blank',    zdYesNo(''), '');
t('escalate tag', zdYesNo('send_to_escalation'), 'Yes');

// status map
t('new->prog',    STATUS_MAP['new'], 'in progress');
t('open->prog',   STATUS_MAP['open'], 'in progress');
t('hold->pend',   STATUS_MAP['hold'], 'pending');
t('solved',       STATUS_MAP['solved'], 'solved');
t('closed',       STATUS_MAP['closed'], 'closed');

// sameValue — sub-second drift must NOT count as a difference (that was 770 false hits)
t('date 0.1s apart', sameValue(new Date('2026-07-15T09:16:00.000Z'), new Date('2026-07-15T09:15:59.904Z')), true);
t('date 5m apart',   sameValue(new Date('2026-07-15T09:16:00Z'), new Date('2026-07-15T09:21:00Z')), false);
t('blank vs blank',  sameValue('', null), true);
t('date vs blank',   sameValue(new Date(), ''), false);
t('str trim',        sameValue(' solved ', 'solved'), true);

// zdToRow end to end
const ctx = {
  p: PropertiesService.getScriptProperties(),
  orgs: { 7: { name: 'GARMIN INTERNATIONAL, INC.' } },
  users: { 9: { name: 'Sanath Reddy R' } },
  metrics: { 42: { ticket_id: 42, solved_at: '2026-06-24T05:10:00Z' } }
};
const row = zdToRow({
  id: 42, created_at: '2026-06-23T01:04:54Z', updated_at: '2026-06-24T05:10:00Z',
  status: 'solved', subject: 'A-Factory Mapping not loading routes',
  organization_id: 7, assignee_id: 9,
  custom_fields: [ {id:101, value:'Mapping::Mapping'}, {id:102, value:'L1'}, {id:103, value:false} ]
}, ctx);
t('ticket #',  row.ticket, '#42');
t('customer',  row.customer, 'GARMIN INTERNATIONAL, INC.');
t('owner',     row.owner, 'Sanath');
t('type',      row.type, 'Mapping');
t('level',     row.level, 'L1');
t('escalated', row.escalated, 'No');
t('status',    row.status, 'solved');
t('created',   row.created.toISOString(), '2026-06-23T01:04:54.000Z');
t('solved',    row.solved.toISOString(), '2026-06-24T05:10:00.000Z');

// L3 with no level field -> derived from escalation
const r2 = zdToRow({ id: 19, created_at:'2026-06-22T18:35:38Z', status:'open',
  organization_id:7, assignee_id:9, subject:'x',
  custom_fields:[{id:103, value:true}] }, ctx);
t('derived L3',      r2.level, 'L3');
t('derived esc',     r2.escalated, 'Yes');
t('open->in prog',   r2.status, 'in progress');
t('no metric solved', r2.solved, '');

// a solved ticket with no metric set falls back to updated_at
const r3 = zdToRow({ id: 99, created_at:'2026-08-01T00:00:00Z', updated_at:'2026-08-02T10:00:00Z',
  status:'closed', organization_id:7, assignee_id:9, subject:'y', custom_fields:[] }, ctx);
t('fallback solved', r3.solved.toISOString(), '2026-08-02T10:00:00.000Z');
t('closed status',   r3.status, 'closed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
