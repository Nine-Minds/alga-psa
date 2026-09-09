import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BROWSER_HEADER } from '../record-browser-metrics.mjs';
import { reconcileBrowserMetricExecutions as reconcile } from '../lib/reconcile-browser-metric-executions.mjs';
const row = values => BROWSER_HEADER.map(column => values[column] ?? '');
function fixture() {
  const expected = { repository:'Nine-Minds/alga-psa', revision:'a'.repeat(40), runId:'123',runAttempt:2,
    edition:'enterprise',eventName:'pull_request',runStatus:'completed',conclusion:'success' };
  const common = {schema_version:2,tested_sha:expected.revision,edition:expected.edition,event_name:expected.eventName,
    run_url:'https://github.com/Nine-Minds/alga-psa/actions/runs/123',run_id:'123',run_attempt:2,lane_status:'passed',authentication:'real-credentials',server_lifecycle:'externally-started-production-build'};
  return {schemaVersion:1,expectedExecutions:[expected],exportedRows:{header:[...BROWSER_HEADER],rows:[
    row({...common,row_kind:'run',collected:1,executed:1}),row({...common,row_kind:'journey',project_id:'ee',project:'enterprise',file:'test.spec.ts',
      journey:'["test journey"]',required:true,observed:true,outcome:'expected',first_attempt:'passed',retry_count:0})]}};
}
const set = (input, index, field, value) => { input.exportedRows.rows[index][BROWSER_HEADER.indexOf(field)] = value; };
test('current first-attempt pass joins exact run and is deterministic without mutating input',()=>{
  const input=fixture(), before=structuredClone(input), result=reconcile(input);
  assert.equal(result.records[0].status,'observed-pass'); assert.equal(result.status,'passed');
  assert.deepEqual(reconcile(input),result);assert.deepEqual(input,before);
});
for(const [name,mutate,status] of [
  ['CI success without export',x=>x.exportedRows.rows=[],'missing-export'],
  ['journey cannot substitute for run',x=>x.exportedRows.rows.shift(),'missing-export'],
  ['cancelled before recorder',x=>{x.expectedExecutions[0].conclusion='cancelled';x.exportedRows.rows=[]},'cancelled'],
  ['pending missing job',x=>{x.expectedExecutions[0].runStatus='pending';x.expectedExecutions[0].conclusion=null;x.exportedRows.rows=[]},'pending'],
  ['failed job with passed rows',x=>x.expectedExecutions[0].conclusion='failure','failed'],
  ['skipped job',x=>x.expectedExecutions[0].conclusion='skipped','failed'],
  ['older passed attempt',x=>x.exportedRows.rows.forEach((_,i)=>set(x,i,'run_attempt',1)),'missing-export'],
  ['duplicate run export',x=>x.exportedRows.rows.push([...x.exportedRows.rows[0]]),'conflicting-export'],
  ['wrong tested revision',x=>set(x,0,'tested_sha','b'.repeat(40)),'conflicting-export'],
  ['wrong event',x=>set(x,0,'event_name','push'),'conflicting-export'],
  ['retry-only pass',x=>{set(x,1,'first_attempt','failed');set(x,1,'retry_count',1);set(x,1,'outcome','flaky')},'incomplete'],
  ['missing journey',x=>x.exportedRows.rows.pop(),'incomplete'],
  ['duplicate journey identity',x=>{x.exportedRows.rows.push([...x.exportedRows.rows[1]]);set(x,0,'collected',2);set(x,0,'executed',2)},'incomplete'],
  ['unknown counts',x=>set(x,0,'collected',''),'incomplete'],
]) test(name,()=>{const input=fixture();mutate(input);const result=reconcile(input);assert.equal(result.records[0].status,status);assert.equal(result.status,'incomplete')});
test('older history is explicit but does not replace or poison a valid current export',()=>{
  const input=fixture();const old=structuredClone(input.exportedRows.rows);old.forEach(r=>r[BROWSER_HEADER.indexOf('run_attempt')]=1);input.exportedRows.rows.push(...old);
  const result=reconcile(input);assert.equal(result.records[0].status,'observed-pass');assert.deepEqual(result.records[0].staleAttempts,[1]);
});
test('native Sheets numeric strings retain identity and counts',()=>{const input=fixture();input.exportedRows.rows=input.exportedRows.rows.map(r=>r.map(v=>typeof v==='number'?String(v):v));assert.equal(reconcile(input).status,'passed')});
for(const mutate of [x=>x.expectedExecutions.push(x.expectedExecutions[0]),x=>x.expectedExecutions[0].runId='0',x=>x.expectedExecutions[0].revision='short',x=>x.exportedRows.header.reverse(),x=>x.exportedRows.rows.push({}),x=>x.expectedExecutions[0].runAttempt=0])
 test('malformed or duplicate input fails closed',()=>{const input=fixture();mutate(input);assert.throws(()=>reconcile(input))});
test('empty expectations cannot claim a pass',()=>{const input=fixture();input.expectedExecutions=[];assert.equal(reconcile(input).status,'incomplete')});
test('CLI retains non-green report, clears stale report for invalid input and protects input alias',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'metric-reconcile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'input.json'),output=path.join(dir,'output.json'),cli=path.resolve('scripts/reconcile-browser-metric-executions.mjs');
  const data=fixture();data.exportedRows.rows=[];await writeFile(input,JSON.stringify(data));
  const summary=path.join(dir,'summary.md');
  assert.equal(spawnSync(process.execPath,[cli,input,output],{env:{...process.env,GITHUB_STEP_SUMMARY:summary}}).status,1);
  assert.match(await readFile(summary,'utf8'),/enterprise, attempt 2: missing-export/);assert.equal(JSON.parse(await readFile(output)).records[0].status,'missing-export');
  await writeFile(input,'invalid');assert.equal(spawnSync(process.execPath,[cli,input,output]).status,1);await assert.rejects(readFile(output),{code:'ENOENT'});
  assert.equal(spawnSync(process.execPath,[cli,input,input]).status,1);assert.equal(await readFile(input,'utf8'),'invalid');
});
test('missing job after completed workflow remains unknown, even with old success rows',()=>{
 const input=fixture();input.expectedExecutions[0].conclusion=null;
 assert.equal(reconcile(input).records[0].status,'incomplete');
});
test('failed job retains independent passed-export evidence without claiming readiness',()=>{
 const input=fixture();input.expectedExecutions[0].conclusion='failure';const result=reconcile(input);
 assert.equal(result.records[0].status,'failed');assert.equal(result.records[0].exportStatus,'observed-pass');assert.equal(result.status,'incomplete');
});
test('wrong repository URL cannot satisfy the numeric run identity',()=>{
 const input=fixture();input.exportedRows.rows.forEach((_,i)=>set(input,i,'run_url','https://github.com/foreign/repository/actions/runs/123'));
 assert.equal(reconcile(input).records[0].status,'missing-export');
});
test('legacy rows without additive run identifiers cannot satisfy a current attempt',()=>{
 const input=fixture();input.exportedRows.rows.forEach((_,i)=>{set(input,i,'run_id','');set(input,i,'run_attempt','')});
 assert.equal(reconcile(input).records[0].status,'missing-export');
});

for (const [name, field, value] of [
 ['empty project ID','project_id',''], ['empty project','project',' '], ['empty file','file',''],
 ['empty journey','journey',''], ['malformed journey','journey','invalid'], ['empty titles','journey','[]'],
 ['non-string title','journey','[42]'], ['blank title','journey','[" "]'],
 ['missing authentication','authentication',''], ['mismatched authentication','authentication','bypassed'],
 ['missing lifecycle','server_lifecycle',''], ['mismatched lifecycle','server_lifecycle','development'],
]) test(`rejects passed rows with ${name}`,()=>{
 const input=fixture();set(input,1,field,value);const result=reconcile(input);
 assert.equal(result.records[0].exportStatus,'incomplete');assert.equal(result.status,'incomplete');
});
test('blank configuration on both run and journey remains incomplete',()=>{
 const input=fixture();for(const index of [0,1])for(const field of ['authentication','server_lifecycle'])set(input,index,field,'');
 assert.equal(reconcile(input).records[0].exportStatus,'incomplete');
});
for(const [status,conclusion,code] of [[null,null,'recorder-step-absent'],['completed','skipped','export-not-attempted'],['completed','success','export-attempted-but-missing']])
 test(`reports recorder ${status}/${conclusion} missing-export reason`,()=>{
  const input=fixture();Object.assign(input.expectedExecutions[0],{recorderStatus:status,recorderConclusion:conclusion});input.exportedRows.rows=[];
  const result=reconcile(input);assert.equal(result.status,'incomplete');assert.ok(result.records[0].issues.includes(code));
  assert.equal(result.records[0].recorderStatus,status);assert.equal(result.records[0].recorderConclusion,conclusion);
 });
test('skipped recorder cannot become green even with an existing passed export',()=>{
 const input=fixture();Object.assign(input.expectedExecutions[0],{recorderStatus:'completed',recorderConclusion:'skipped'});
 const result=reconcile(input);assert.equal(result.records[0].exportStatus,'observed-pass');assert.equal(result.status,'incomplete');
});
test('invalid optional recorder state is rejected',()=>{
 const input=fixture();Object.assign(input.expectedExecutions[0],{recorderStatus:'invented',recorderConclusion:'success'});assert.throws(()=>reconcile(input));
});
for(const width of [18,20]) test(`recognized legacy ${width}-column rows remain unverified missing exports`,()=>{
 const input=fixture();input.exportedRows.header=input.exportedRows.header.slice(0,width);input.exportedRows.rows=input.exportedRows.rows.map(row=>row.slice(0,width));
 const result=reconcile(input);assert.equal(result.records[0].exportStatus,'missing-export');assert.equal(result.status,'incomplete');
});
test('legacy header cannot conceal newer identity columns in overwide rows',()=>{
 const input=fixture();input.exportedRows.header=input.exportedRows.header.slice(0,20);assert.throws(()=>reconcile(input));
});
test('reordered legacy header and unrecognized partial extensions are rejected',()=>{
 for(const width of [18,20,24]){const input=fixture();input.exportedRows.header=input.exportedRows.header.slice(0,width);input.exportedRows.rows=[];
 if(width!==24)[input.exportedRows.header[0],input.exportedRows.header[1]]=[input.exportedRows.header[1],input.exportedRows.header[0]];
 assert.throws(()=>reconcile(input));}
});
test('legacy run exports are visible without inventing their execution attempt',()=>{
 const input=fixture();input.exportedRows.header=input.exportedRows.header.slice(0,20);input.exportedRows.rows=input.exportedRows.rows.map(row=>row.slice(0,20));
 const result=reconcile(input);assert.equal(result.records[0].legacyRunExportCount,1);
 assert.ok(result.records[0].issues.includes('legacy-export-unverified'));assert.equal(result.records[0].exportStatus,'missing-export');
 assert.deepEqual(result.records[0].staleAttempts,[]);
});
test('unverified historical run row does not invalidate a complete current export',()=>{
 const input=fixture(),legacy=[...input.exportedRows.rows[0]];legacy[BROWSER_HEADER.indexOf('run_attempt')]='unknown';input.exportedRows.rows.push(legacy);
 const result=reconcile(input);assert.equal(result.records[0].legacyRunExportCount,1);assert.equal(result.records[0].exportStatus,'observed-pass');
});
for(const [runStatus,conclusion,status] of [['completed','cancelled','cancelled'],['completed','success','incomplete'],['completed','failure','failed'],['pending',null,'pending']])
 test(`unknown revision preserves ${runStatus}/${conclusion} without trusting Sheets`,()=>{
  const input=fixture();Object.assign(input.expectedExecutions[0],{revision:null,revisionEvidence:'unavailable',revisionDiagnostics:['artifact-missing'],runStatus,conclusion});
  const result=reconcile(input),record=result.records[0];assert.equal(record.revision,null);assert.equal(record.status,status);
  assert.equal(record.exportStatus,'tested-revision-unknown');assert.equal(record.runExportCount,0);
  assert.equal(record.unverifiedCurrentAttemptRunExportCount,1);assert.ok(record.issues.includes('tested-revision-unknown'));
  assert.match(record.key,/:unknown:/);assert.equal(result.status,'incomplete');
 });
test('conflicting artifact revisions never select a tempting exported SHA',()=>{
 const input=fixture();Object.assign(input.expectedExecutions[0],{revision:null,revisionEvidence:'conflicting',revisionDiagnostics:['revision-conflicting']});
 const record=reconcile(input).records[0];assert.equal(record.exportStatus,'tested-revision-unknown');assert.deepEqual(record.revisionDiagnostics,['revision-conflicting']);
});
test('known artifact source retains validated metadata and can match exact exports',()=>{
 const input=fixture();Object.assign(input.expectedExecutions[0],{revisionEvidence:'candidate-artifact',revisionDiagnostics:[]});
 assert.equal(reconcile(input).records[0].status,'observed-pass');
});
for(const fields of [{revision:null},{revision:null,revisionEvidence:'operator',revisionDiagnostics:['artifact-missing']},
 {revision:null,revisionEvidence:'unavailable',revisionDiagnostics:['<script>untrusted</script>']},
 {revision:null,revisionEvidence:'unavailable',revisionDiagnostics:[]},{revisionEvidence:'unavailable'}])
 test('rejects unsupported revision provenance and arbitrary diagnostics',()=>{const input=fixture();Object.assign(input.expectedExecutions[0],fields);assert.throws(()=>reconcile(input))});
test('cancelled before source artifacts and export remains a visible unknown cancellation',()=>{
 const input=fixture();Object.assign(input.expectedExecutions[0],{revision:null,revisionEvidence:'unavailable',revisionDiagnostics:['artifact-missing'],conclusion:'cancelled'});
 input.exportedRows.rows=[];const record=reconcile(input).records[0];assert.equal(record.status,'cancelled');assert.equal(record.exportStatus,'tested-revision-unknown');assert.equal(record.unverifiedCurrentAttemptRunExportCount,0);
});
