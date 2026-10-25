// Replace a guide's evidence with scenarios recorded on the ledger's current build.
// Usage: node adopt-final.cjs <guide> <status> <remaining|-> <scene> [scene...]
// Evidence from an earlier build is kept under priorBuildEvidence, never relabelled.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const {base,packet,regenerate}=require('./ledger.cjs');
const [guide,status,remainingArg,...scenes]=process.argv.slice(2);assert(guide&&status&&scenes.length);
const remaining=remainingArg==='-'?'':remainingArg;
const raw='/tmp/alga-smoke-evidence/co-managed-it-implement-20261025/continuation-ef194916';
const g=JSON.parse(fs.readFileSync(path.join(base,'guide-coverage.json')));const e=g.guides.find(x=>x.guide===guide);assert(e,guide);
const cur=g.applicationSourceRevision,rel=p=>path.relative(base,p).split(path.sep).join('/'),digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(e.build?.sourceRevision!==cur){
  e.priorBuildEvidence=[...(e.priorBuildEvidence||[]),{sourceRevision:e.build?.sourceRevision,buildId:e.build?.buildId,coverageStatus:e.coverageStatus,remaining:e.remaining,recordings:e.recordings,boundedEvidence:e.boundedEvidence,rawClips:e.scenario?.rawClips,compositeRecording:e.compositeRecording,playbackProofPath:e.playbackProofPath,recordedAt:e.recordedAt}];
  e.recordings=[];e.boundedEvidence=[];e.scenario={...(e.scenario||{}),rawClips:[]};
  delete e.compositeRecording;delete e.publishedRecordingUrl;delete e.playbackProofPath;delete e.playbackProof;
}
let latest=null;
for(const scene of scenes){
  const src=path.join(raw,scene),r=JSON.parse(fs.readFileSync(path.join(src,'recording.json')));
  assert.equal(r.runtime.sourceRevision,cur,scene+' recorded on '+r.runtime.sourceRevision);assert.equal(r.build.buildId,g.buildId);assert(r.durationSeconds>0);
  const dest=path.join(packet,'runs',cur,scene);fs.mkdirSync(dest,{recursive:true});
  for(const f of fs.readdirSync(src,{withFileTypes:true})){if(!f.isFile()||['storage-state.json','auth-state.json'].includes(f.name))continue;
    if(/^[a-f0-9]{32}\.webm$/.test(f.name)&&digest(path.join(src,f.name))===digest(path.join(src,'walkthrough.webm')))continue;fs.copyFileSync(path.join(src,f.name),path.join(dest,f.name))}
  const recording=rel(path.join(dest,'walkthrough.webm')),artifact=rel(path.join(dest,'recording.json'));
  if(!e.recordings.includes(recording))e.recordings.push(recording);
  e.boundedEvidence=e.boundedEvidence.filter(b=>b.artifact!==artifact);
  e.boundedEvidence.push({sourceRevision:cur,buildId:g.buildId,artifact,assertions:r.assertions.length,scenarioStatus:r.scenarioStatus,...(r.error?{harnessError:r.error.split('\n')[0]}:{}),...(r.limitations?.length?{segmentLimitations:r.limitations}:{})});
  e.scenario.rawClips=[...new Set([...(e.scenario.rawClips||[]),artifact])];
  if(!latest||r.recordedAt>latest.recordedAt)latest=r;
}
e.coverageStatus=e.status=status;e.scenario.status=status;e.remaining=remaining;e.limitations=remaining?[remaining]:[];
e.testedRevision=cur;e.runtime=latest.runtime;e.build=latest.build;e.recordedAt=latest.recordedAt;
e.playbackVerified=e.mediaPlaybackVerified=e.chapterSeekVerified=false;
regenerate(g);console.log(JSON.stringify({guide,status,scenes:scenes.length,assertions:e.boundedEvidence.reduce((n,b)=>n+b.assertions,0)}));
