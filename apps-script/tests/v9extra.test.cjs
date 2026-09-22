// The v8 backend half: the two bugs that were silently destroying data.
const fs=require('fs');
let src=fs.readFileSync('../SkyConsole-v9.gs','utf8');
const PROPS={}; global.PropertiesService={getScriptProperties:()=>({getProperty:k=>PROPS[k]||null,setProperty(){},deleteProperty(){}})};
global.Utilities={formatDate:d=>String(d),base64Encode:s=>s,sleep(){}};
global.Logger={log(){}}; global.SpreadsheetApp={}; global.LockService={}; global.ScriptApp={};
global.ContentService={createTextOutput:()=>({setMimeType:()=>{}}),MimeType:{JSON:1}}; global.UrlFetchApp={};
eval(src);

const HDR=2;
function mkSheet(rows){
  const store=rows.map(r=>r.slice());
  return { store, name:'All tickets Info', getName(){return this.name;},
    getLastRow:()=>HDR+store.length,
    getRange(row,col,h,w){ h=h||1; w=w||1; return {
      getValues:()=>store.slice(row-HDR-1,row-HDR-1+h).map(r=>r.slice(col-1,col-1+w)),
      getValue:()=>store[row-HDR-1]?store[row-HDR-1][col-1]:'',
      setValue(v){ if(!store[row-HDR-1]) store[row-HDR-1]=new Array(11).fill('');
        store[row-HDR-1][col-1]=v; return {setNumberFormat(){}}; },
      setValues(v){ v.forEach((rr,i)=>{ const t=row-HDR-1+i;
        if(!store[t]) store[t]=new Array(11).fill('');
        rr.forEach((c,j)=>store[t][col-1+j]=c); }); },
      setNumberFormat(){ return this; }, setFontWeight(){ return this; } }; },
    deleteRow(n){ store.splice(n-HDR-1,1); } };
}
let pass=0,fail=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);
  ok?pass++:(fail++,console.log(`FAIL ${n}\n  got  ${JSON.stringify(g)}\n  want ${JSON.stringify(w)}`));};

// ── bug 2: an update carrying only a status must not blank six columns ──────
const sheet = mkSheet([
  ['#19', new Date('2026-06-22T18:35:38Z'),'Catalent','Sahil','Yes','L3','', 'in progress',
   'Parts & Logistics','AI SUMMARY','HAND REMARK'],
]);
const ss = { getSheetByName:n=> n==='All tickets Info' ? sheet : null, insertSheet:()=>mkSheet([]) };
createOrUpdate(ss, { ticket:'#19', status:'solved' });
const r = sheet.store[0];
t('owner kept',     r[3], 'Sahil');
t('escalated kept', r[4], 'Yes');
t('level kept',     r[5], 'L3');
t('type kept',      r[8], 'Parts & Logistics');
t('summary kept',   r[9], 'AI SUMMARY');
t('remarks kept',   r[10],'HAND REMARK');
t('status updated', r[7], 'solved');
t('solved stamped', r[6] instanceof Date, true);

// findRow matches regardless of how the ticket is written
t('findRow bare',   findRow(sheet,'19'), 3);
t('findRow hash',   findRow(sheet,'#19'), 3);
t('findRow padded', findRow(sheet,' #19 '), 3);
t('findRow missing',findRow(sheet,'#999'), -1);

// createOrUpdate must not create a second row for the same ticket
const before = sheet.store.length;
createOrUpdate(ss, { ticket:'19', owner:'Sanath' });
t('no duplicate row', sheet.store.length, before);
t('owner overwritten', sheet.store[0][3], 'Sanath');

// ── bug 1: onEdit writes Solved on a STATUS edit, never into L1/L3 ─────────
const s2 = mkSheet([['#40', new Date('2026-07-01T00:00:00Z'),'X','Sahil','No','L1','','pending','Others','','']]);
s2.name='All tickets Info';
onEdit({ range:{ getSheet:()=>s2, getRow:()=>3, getColumn:()=>COL.STATUS }, value:'solved' });
t('onEdit stamped Solved', s2.store[0][COL.SOLVED-1] instanceof Date, true);
t('onEdit left L1/L3',     s2.store[0][COL.LEVEL-1], 'L1');

// an edit to the Solved column itself must not trigger anything
const s3 = mkSheet([['#41', new Date('2026-07-01T00:00:00Z'),'X','Sahil','No','L1','','pending','Others','','']]);
s3.name='All tickets Info';
onEdit({ range:{ getSheet:()=>s3, getRow:()=>3, getColumn:()=>COL.SOLVED }, value:'solved' });
t('col-7 edit inert on L1/L3', s3.store[0][COL.LEVEL-1], 'L1');

// ── closed handling driven by the one switch ───────────────────────────────
t('closed preserved',  normalizeStatus('closed'), 'closed');
t('closed is resolved', isResolvedStatus('closed'), true);
t('zd closed maps',    STATUS_MAP['closed'], 'closed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
