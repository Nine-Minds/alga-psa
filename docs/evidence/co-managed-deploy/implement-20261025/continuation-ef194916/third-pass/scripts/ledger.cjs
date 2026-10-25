// Guide coverage ledger, third pass. Each guide records the application build its
// evidence was captured on; a guide counts as covered only on the build it was
// recorded against, and the ledger's current build is the canonical review app.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const repo=process.cwd(),base=path.join(repo,'docs/evidence/co-managed-deploy/implement-20261025'),packet=path.join(base,'continuation-ef194916'),publication='/home/robert/card-reviews/co-managed-it-3363';
function regenerate(g){
  const head=process.env.CM_CONSOLIDATED_EVIDENCE==='1'?'HEAD':cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const cur=g.applicationSourceRevision;
  g.checkedAt=new Date().toISOString();g.candidateRevision=head;
  g.candidateRevisionMeaning='HEAD resolves to the containing consolidated evidence commit. Application source is pinned separately per guide; evidence commits are not application builds.';
  for(const e of g.guides){e.candidateRevision=head;e.recordedOnCurrentBuild=e.build?.sourceRevision===cur}
  const on=e=>e.recordedOnCurrentBuild;
  g.coveredGuides=g.guides.filter(e=>e.coverageStatus==='covered'&&on(e)).length;
  g.coveredOnPriorBuildOnly=g.guides.filter(e=>e.coverageStatus==='covered'&&!on(e)).map(e=>({guide:e.guide,sourceRevision:e.build?.sourceRevision,buildId:e.build?.buildId}));
  g.partialGuides=g.guides.filter(e=>e.coverageStatus==='partial').length+g.coveredOnPriorBuildOnly.length;
  g.blockedGuides=g.guides.filter(e=>e.coverageStatus==='blocked-external').length;
  g.currentBuildRecordedGuides=g.guides.filter(on).length;
  g.playbackVerifiedGuides=g.guides.filter(e=>e.playbackVerified&&e.chapterSeekVerified).length;
  g.recordingReady=g.playbackVerifiedGuides===g.requiredGuides;
  g.reviewReady=false;
  g.reviewReadyReason='Guide acceptance is not requirement acceptance: the formal requirement ledger still has implemented-but-unverified and blocked-external rows, and three guides are blocked-external.';
  g.mediaPlaybackScope=`${g.playbackVerifiedGuides} of ${g.requiredGuides} published composites have verified playback, chapter seek, following-frame and HTTP range proof; each composite is labelled with the build it was recorded on.`;
  for(const p of [path.join(base,'guide-coverage.json'),path.join(packet,'guide-coverage.json')])fs.writeFileSync(p,JSON.stringify(g,null,2)+'\n');
  const short=s=>s?String(s).slice(0,10):'?';
  const rows=['# Current guide coverage','',`Evidence snapshot parent: \`${head}\`. Current application: \`${cur}\` / \`${g.buildId}\` at ${g.origin}. Checked ${g.checkedAt}.`,'',
    `${g.coveredGuides} covered on the current build; ${g.partialGuides} partial; ${g.blockedGuides} blocked-external. Published playback verified: ${g.playbackVerifiedGuides}/${g.requiredGuides}. recordingReady=${g.recordingReady}; reviewReady=false (${g.reviewReadyReason})`,'',
    '| Guide | Status | Recorded on | Recordings and playback | Exact remaining limitation |','|---|---|---|---|---|'];
  for(const e of g.guides){const links=(e.recordings||[]).map(s=>`[${s.split('/').at(-2)}](${s})`);if(e.compositeRecording)links.push(`[Published composite](${e.compositeRecording})`);if(e.playbackProofPath)links.push(`[Playback proof](${e.playbackProofPath})`);if(e.blockedExternal)links.push('[Unblock record](continuation-ef194916/third-pass/blocked-external.json)');
    rows.push(`| ${e.guide} | ${e.coverageStatus} | \`${short(e.build?.sourceRevision)}\` ${e.build?.buildId||''} | ${links.join('<br>')} | ${(e.remaining||'Scenario covered.').replaceAll('|','/')} |`)}
  fs.writeFileSync(path.join(base,'coverage-report.md'),rows.join('\n')+'\n');return g}
module.exports={repo,base,packet,publication,regenerate};
