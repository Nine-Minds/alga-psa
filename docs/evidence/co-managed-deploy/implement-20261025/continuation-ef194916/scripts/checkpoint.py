import pathlib,json,shutil,hashlib,subprocess,datetime,re
repo=pathlib.Path('/home/robert/alga-copies/feature-co-managed-it')
raw=pathlib.Path(__file__).resolve().parent.parent
base=repo/'docs/evidence/co-managed-deploy/implement-20261025';packet=base/'continuation-ef194916'
source='1b9b112749b948ee1b6611b91e07d52e7b98ba32';prefix='continuation-ef194916/runs/'+source+'/'
now=datetime.datetime.now(datetime.timezone.utc).isoformat();head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
config=json.loads((raw/'checkpoint-config.json').read_text())
def copy_scene(scene):
 src=raw/scene;dest=base/prefix/scene
 assert (src/'recording.json').exists(),scene
 dest.mkdir(parents=True,exist_ok=True)
 for f in src.rglob('*'):
  if not f.is_file():continue
  if f.suffix=='.webm' and re.fullmatch('[a-f0-9]{32}',f.stem):
   # Keep only one copy of a primary clip, retain every secondary camera.
   w=src/'walkthrough.webm'
   if f.parent==src and w.exists() and hashlib.sha256(w.read_bytes()).digest()==hashlib.sha256(f.read_bytes()).digest():continue
  if f.name in ('storage-state.json','auth-state.json'):continue
  d=dest/f.relative_to(src);d.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,d)
 return json.loads((dest/'recording.json').read_text())
ledger=json.loads((base/'guide-coverage.json').read_text())
for entry in ledger['guides']:
 entry['candidateRevision']=head
 if entry['guide'] not in config:continue
 c=config[entry['guide']];scenes=c['scenes'];rs=[copy_scene(s) for s in scenes]
 entry.update(status=c['status'],coverageStatus=c['status'],remaining=c['limitation'],limitations=[x for x in [c['limitation'],'Current media publication/playback checks remain pending.'] if x],testedRevision=source,runtime=rs[0]['runtime'],build=rs[0]['build'],recordedAt=max(r['recordedAt'] for r in rs),durationSeconds=sum(r.get('durationSeconds',0) for r in rs),scenario={'status':c['status'],'rawClips':[prefix+s+'/recording.json' for s in scenes]},recordings=[prefix+s+'/walkthrough.webm' for s in scenes],boundedEvidence=[{'sourceRevision':source,'buildId':r['build']['buildId'],'artifact':prefix+s+'/recording.json','assertions':len(r['assertions']),'scenarioStatus':r['scenarioStatus']}for s,r in zip(scenes,rs)])
 # A previous candidate's media proof never proves current media.
 if entry.get('playbackProof',{}).get('sourceRevision')!=source:entry.pop('playbackProof',None)
ledger.update(checkedAt=now,candidateRevision=head,applicationSourceRevision=source,candidateRevisionMeaning='Evidence snapshot parent revision. Application source is independently recorded; subsequent commits in this packet contain evidence only.',coveredGuides=sum(e['status']=='covered' for e in ledger['guides']),partialGuides=sum(e['status']=='partial' for e in ledger['guides']),currentBuildRecordedGuides=sum(bool(e.get('recordings')) for e in ledger['guides']),reviewReady=False,recordingReady=False,mediaPlaybackScope='Committed current-build clips are listed per guide. Current publication/playback and chapter-seek verification remain pending.')
for p in (base/'guide-coverage.json',packet/'guide-coverage.json'):p.write_text(json.dumps(ledger,indent=2)+'\n')
for f in (raw/'scripts').iterdir():
 if f.is_file():shutil.copy2(f,packet/'scripts'/f.name)
for name in ['03-access-fixtures.json','billing-fixture.json','unused-agent-candidates-before.json','unused-agent-candidates-stopped.json']:
 if (raw/name).exists():shutil.copy2(raw/name,packet/name)
media=[]
for f in sorted(packet.rglob('*')):
 if f.is_file() and f.suffix in ('.png','.webm'):
  media.append({'path':str(f.relative_to(packet)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
(packet/'media-inventory.json').write_text(json.dumps({'generatedAt':now,'files':media},indent=2)+'\n')
report=['# Current guide coverage','',f'Evidence snapshot: `{head}`. Deployed application: `{source}` / `build-1792941614066`. Checked {now}.','',f"{ledger['coveredGuides']} covered; {ledger['partialGuides']} partial. Review readiness remains false.",'','| Guide | Status | Recording directories | Remaining limitation |','|---|---|---|---|']
for e in ledger['guides']:
 dirs='<br>'.join('[`'+s.rsplit('/',1)[0]+'`]('+s+')' for s in e.get('recordings',[])) or 'No current-build recording'
 report.append('| '+e['guide']+' | '+e['status']+' | '+dirs+' | '+(e.get('remaining') or 'Scenario covered; current media publication checks pending.').replace('|','/')+' |')
(base/'coverage-report.md').write_text('\n'.join(report)+'\n')
print(json.dumps({'head':head,'covered':ledger['coveredGuides'],'partial':ledger['partialGuides'],'media':len(media)}))
