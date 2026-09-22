const fs = require('fs');
let src = fs.readFileSync('../SkyConsole-v9.gs','utf8');
const PROPS={FLD_ISSUE_CATEGORY:'101',FLD_LEVEL:'102',FLD_ESCALATED:'103'};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>PROPS[k]||null,setProperty(){},deleteProperty(){}})};
global.Utilities={formatDate:d=>String(d),base64Encode:s=>s,sleep(){}};
global.Logger={log:m=>LOG.push(m)}; const LOG=[];
global.SpreadsheetApp={}; global.LockService={}; global.ScriptApp={}; global.ContentService={createTextOutput:()=>({setMimeType:()=>{}}),MimeType:{JSON:1}}; global.UrlFetchApp={};
eval(src);

const HDR=2;
function makeSheet(grid){
  const store=grid.map(r=>r.slice()); const deleted=[];
  return { store, deleted,
    getLastRow:()=>HDR+store.length,
    getRange(row,col,h,w){ return {
      getValues:()=>store.slice(row-HDR-1,row-HDR-1+h).map(r=>r.slice(col-1,col-1+w)),
      setValues:v=>{ v.forEach((rr,i)=>{ const t=row-HDR-1+i;
        if(!store[t]) store[t]=new Array(11).fill('');
        rr.forEach((c,j)=> store[t][col-1+j]=c); }); },
      setNumberFormat(){}, setFontWeight(){} }; },
    deleteRow(n){ deleted.push(n); store.splice(n-HDR-1,1); },
    setFrozenRows(){}, autoResizeColumns(){}, clear(){}, copyTo(){return{setName(){}};} };
}
const D=s=>new Date(s);
let pass=0,fail=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  ok?pass++:(fail++,console.log(`FAIL ${n}\n  got  ${JSON.stringify(g)}\n  want ${JSON.stringify(w)}`));};

// ticket, created, customer, owner, escalated, level, solved, status, type, summary, remarks
const grid = [
  // #19 three times: bare "19", padded " #19 ", and the one holding the remark
  ['19',    D('2026-06-22T18:35:38Z'),'Catalent','Sahil','Yes','L3','', 'solved','Parts & Logistics','', ''],
  [' #19 ', D('2026-06-22T18:35:38Z'),'Catalent','Sahil','Yes','L3','', 'solved','Parts & Logistics','ai summary',''],
  ['#19',   D('2026-06-22T18:35:38Z'),'Catalent','Sahil','Yes','L3','', 'solved','Parts & Logistics','', 'HAND-WRITTEN remark'],
  // #36 clean single row
  ['#36',   D('2026-06-22T21:18:18Z'),'SICK PCA','Sanath','No','L1','','solved','Sensors','s36','r36'],
  // #999 orphan — not in Zendesk
  ['#999',  D('2026-09-01T00:00:00Z'),'Ghost','Gokul','No','L1','','pending','Others','',''],
];
const cf=(c,l,e)=>[{id:101,value:c},{id:102,value:l},{id:103,value:e}];
const tickets={
  list:[
    {id:19,created_at:'2026-06-22T18:35:38Z',updated_at:'2026-06-23T00:00:00Z',status:'solved',
     subject:'Return shipment',organization_id:1,assignee_id:9,custom_fields:cf('Parts & Logistics::Parts & Logistics','L3',true)},
    {id:36,created_at:'2026-06-22T21:18:18Z',updated_at:'2026-06-23T00:00:00Z',status:'solved',
     subject:'Sensors',organization_id:2,assignee_id:10,custom_fields:cf('Sensors::Sensors','L1',false)},
    // missing from the sheet entirely -> must be appended
    {id:77,created_at:'2026-07-01T00:00:00Z',updated_at:'2026-07-01T01:00:00Z',status:'open',
     subject:'Never logged by the team',organization_id:1,assignee_id:9,custom_fields:cf('Mapping::Mapping','L1',false)},
  ],
  users:{9:{name:'Sahil Kumar'},10:{name:'Sanath Reddy R'}},
  orgs:{1:{name:'Catalent Pharma Solutions'},2:{name:'SICK PCA'}},
  metrics:{19:{ticket_id:19,solved_at:'2026-06-23T00:00:00Z'},36:{ticket_id:36,solved_at:'2026-06-23T00:00:00Z'}}
};

// ── normKey ──
t('norm bare',   normKey('19'), '19');
t('norm hash',   normKey('#19'), '19');
t('norm padded', normKey(' #19 '), '19');
t('norm number', normKey(19), '19');
t('norm empty',  normKey(''), '');
t('humanScore remarks>summary', humanScore(grid[2]) > humanScore(grid[1]), true);

// ── AUDIT: nothing written, nothing deleted ──
const sA=makeSheet(grid);
const snap=JSON.stringify(sA.store);
const a=zdApplyToSheet(sA,tickets,false);
t('audit no delete', sA.deleted, []);
t('audit no write',  JSON.stringify(sA.store), snap);
t('audit dupes found', a.dupes.length, 1);
t('audit dupe extra rows', a.dupes[0].dropRows.length, 2);
t('audit missing found', a.newTickets, 1);
t('audit orphan found', a.orphans.map(o=>o.ticket), ['#999']);

// ── APPLY ──
const sB=makeSheet(grid);
const r=zdApplyToSheet(sB,tickets,true);
const byKey={}; sB.store.forEach(row=>{ byKey[normKey(row[0])]=row; });

t('one row for #19 left', sB.store.filter(x=>normKey(x[0])==='19').length, 1);
t('two rows deleted', r.deleted, 2);
t('deleted bottom-up', sB.deleted, [4,3]);
t('remark survived',  byKey['19'][10], 'HAND-WRITTEN remark');
t('summary merged in', byKey['19'][9], 'ai summary');
t('#19 solved filled', byKey['19'][6].toISOString(), '2026-06-23T00:00:00.000Z');
t('#36 intact',        byKey['36'][10], 'r36');
t('missing #77 added', !!byKey['77'], true);
t('#77 status mapped', byKey['77'][7], 'in progress');
t('#77 summary=subject', byKey['77'][9], 'Never logged by the team');
t('orphan kept',       !!byKey['999'], true);

// ── circuit breaker ──
const many=[]; for(let i=0;i<40;i++) many.push(['#500',D('2026-08-01T00:00:00Z'),'X','Sahil','No','L1','','solved','Others','','']);
const sC=makeSheet(many);
const rc=zdApplyToSheet(sC,{list:[{id:500,created_at:'2026-08-01T00:00:00Z',updated_at:'2026-08-01T00:00:00Z',
  status:'solved',subject:'x',organization_id:1,assignee_id:9,custom_fields:cf('Others::Others','L1',false)}],
  users:tickets.users,orgs:tickets.orgs,metrics:{}},true);
t('breaker tripped', rc.deleteBlocked, true);
t('breaker deleted nothing', sC.deleted.length, 0);
t('breaker reported', rc.dupes[0].dropRows.length, 39);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
