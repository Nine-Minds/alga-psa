import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { providerFixture } from './fixtures/release-provider.mjs';
import { releaseManifestDigest, verifyReleaseTestEvidence } from '../lib/release-test-evidence.mjs';
const cli=fileURLToPath(new URL('../assemble-release-provider-evidence.mjs',import.meta.url));
function fixture(t) {
 const dir=mkdtempSync(path.join(tmpdir(),'release-assembler-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const write=(name,value)=>{mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});writeFileSync(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value));};
 const p=providerFixture(),revision='a'.repeat(40),manifest={schemaVersion:1,revision,edition:'enterprise',components:p.components};
 const policy={revision,edition:'enterprise',requiredComponents:p.components.map(c=>c.name),requiredChecks:['browser-ee'],requiredCheckConfigurations:{'browser-ee':{authentication:'credentials'}},requiredBrowserProviders:p.policy};
 const digest=releaseManifestDigest({...policy,manifest});
 const checks={schemaVersion:1,revision,edition:'enterprise',manifestDigest:digest,results:[{id:'browser-ee',status:'passed',failures:[],manifestDigest:digest,configuration:{authentication:'credentials'}}]};
 write('policy.json',policy);write('manifest.json',manifest);write('checks.json',checks);
 for(const [name,value]of Object.entries({collected:p.raw.collected,results:p.raw.report,evidence:p.raw.evidence}))write(`browser/alga/e2e-tests/execution-evidence/${name}.json`,value);
 write('browser/_temp/browser-artifact-manifest.json',p.raw.artifactManifest);
 const mapping={};Object.entries(p.raw.registryManifests).forEach(([name,encoded],i)=>{mapping[name]=`registry-${i}.json`;write(mapping[name],Buffer.from(encoded,'base64').toString());});write('registry.json',mapping);
 const args=['policy.json','manifest.json','checks.json','browser','/repo','registry.json','output.json'];
 const run=()=>spawnSync(process.execPath,[cli,...args],{cwd:dir,encoding:'utf8'});
 return {dir,write,args,run,policy,manifest,checks,p};
}
test('CLI assembles actual artifact layout and result feeds existing release verifier',t=>{
 const f=fixture(t);f.write('browser/diagnostics/results.json',{});
 assert.equal(f.run().status,0);
 assert.equal(statSync(path.join(f.dir,'output.json')).mode & 0o777,0o600);
 const bundle=JSON.parse(readFileSync(path.join(f.dir,'output.json')));
 assert.equal(verifyReleaseTestEvidence({...f.policy,manifest:f.manifest,evidence:{...f.checks,browserProviderExecution:bundle}}).status,'passed');
});
for(const damage of ['missing','ambiguous','orphan-evidence','split-collected','ambiguous-archive','run','revision','build','traffic','registry','failed-check','archive'])test(`CLI rejects ${damage} and removes stale output`,t=>{
 const f=fixture(t);f.write('output.json',{status:'passed'});
 if(damage==='missing')rmSync(path.join(f.dir,'browser/alga/e2e-tests/execution-evidence/results.json'));
 if(damage==='ambiguous')f.write('browser/other/e2e-tests/execution-evidence/results.json',f.p.raw.report);
 if(damage==='orphan-evidence')f.write('browser/orphan/e2e-tests/execution-evidence/evidence.json',f.p.raw.evidence);
 if(damage==='split-collected'){rmSync(path.join(f.dir,'browser/alga/e2e-tests/execution-evidence/collected.json'));f.write('browser/orphan/e2e-tests/execution-evidence/collected.json',f.p.raw.collected);}
 if(damage==='ambiguous-archive')f.write('browser/other/_temp/browser-artifact-manifest.json',f.p.raw.artifactManifest);
 if(damage==='revision'){f.policy.revision='b'.repeat(40);f.write('policy.json',f.policy);}
 if(damage==='build'){f.manifest.components[0].build.attempt=3;f.write('manifest.json',f.manifest);}
 if(damage==='run'){f.policy.requiredBrowserProviders.runId='999';f.write('policy.json',f.policy);}
 if(damage==='traffic'){f.p.raw.report.suites[0].specs[0].tests[0].results[0].attachments=[];f.write('browser/alga/e2e-tests/execution-evidence/results.json',f.p.raw.report);}
 if(damage==='registry')f.write('registry-0.json','{}');
 if(damage==='failed-check'){f.checks.results[0].status='failed';f.write('checks.json',f.checks);}
 if(damage==='archive')f.write('browser/_temp/browser-artifact-manifest.json',{});
 assert.equal(f.run().status,1);assert.equal(existsSync(path.join(f.dir,'output.json')),false);
});
test('output alias is rejected without deleting the registry input',t=>{
 const f=fixture(t),file=path.join(f.dir,'registry-0.json'),before=readFileSync(file);
 f.args[6]='registry-0.json';assert.equal(f.run().status,1);assert.deepEqual(readFileSync(file),before);
});

test('unparseable registry mapping fails without risking deletion of an unresolved input alias',t=>{
 const f=fixture(t);f.write('output.json',{old:'unverified'});f.write('registry.json','{invalid');
 assert.equal(f.run().status,1);
 // Argument discovery has not resolved all aliases; this existing file is not
 // a fresh successful artifact and callers must require exit zero.
 assert.deepEqual(JSON.parse(readFileSync(path.join(f.dir,'output.json'))),{old:'unverified'});
});

test('fresh output through symlinked parent cannot write inside artifact input',t=>{
 const f=fixture(t);
 const before=readFileSync(path.join(f.dir,'browser/alga/e2e-tests/execution-evidence/results.json'));
 symlinkSync(path.join(f.dir,'browser'),path.join(f.dir,'alias'),'dir');
 f.args[6]='alias/new-directory/output.json';
 assert.equal(f.run().status,1);
 assert.equal(existsSync(path.join(f.dir,'browser/new-directory')),false);
 assert.deepEqual(readFileSync(path.join(f.dir,'browser/alga/e2e-tests/execution-evidence/results.json')),before);
});
