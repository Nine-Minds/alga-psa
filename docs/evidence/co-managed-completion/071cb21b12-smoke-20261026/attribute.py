"""Reproducible attribution of the captain-designated 14-guide behavioral ledger.
Regenerates the source census first; never infers a pass from a guide label.
Run from the worktree. No product source, plan, or verifier rules are changed.
"""
import pathlib,json,subprocess,hashlib,collections,datetime,os
ROOT=pathlib.Path.cwd(); OUT=ROOT/'docs/evidence/co-managed-completion/071cb21b12-smoke-20261026'; OUT.mkdir(parents=True,exist_ok=True)
C=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(); S='54e75edfabfd814edb9ca0685a5e46d0e050a470'
changed=subprocess.check_output(['git','diff','--name-only',S,C],text=True).splitlines()
assert all(p.startswith('docs/evidence/') for p in changed), 'Runtime equivalence no longer holds'
subprocess.run(['node','scripts/build-co-managed-inventory.mjs','--candidate',C,'--out',str(OUT)],check=True,stdout=subprocess.DEVNULL)
base=ROOT/'docs/evidence/co-managed-deploy/7e137086e6/guides'
manifest=json.load(open(OUT/'manifest.json')); inv=json.load(open(OUT/'inventory.json'))
guides={p.parent.name:json.load(open(p)) for p in base.glob('*/guide-result.json')}
ids={name:('guide-'+name) for name in guides}
def rel(p):return os.path.relpath(p,OUT)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
media=json.load(open(base/'media-inventory.json')); checked=[]
for m in media:
 p=base/m['source']; assert digest(p)==m['sha256'];checked.append({**m,'artifact':rel(p)})
(OUT/'media-audit.json').write_text(json.dumps(checked,indent=2)+'\n')
for name,g in guides.items():
 artifact=base/name/'guide-result.json'; group=[m for m in checked if m['guide']==g['guide']];assert len(group)==1
 manifest['evidence'][ids[name]]={'type':'browser','sha':S,'command':'Real production UI walkthrough: '+g['guide'],
  'result':json.dumps({'coverage':g['coverage'],'sections':g.get('sections',[]),'limitations':g.get('limitations',[]),'missingResources':g.get('missingResources',[])},ensure_ascii=False),
  'artifact':rel(artifact),'artifactAvailable':True,'artifactSha256':digest(artifact),'media':group[0],
  'dependencyAnalysis':f'Deployed source {S}, build-1792983401994. git diff {S}..{C} contains only docs/evidence paths (source-delta.json). No application/configuration/worker changes; runtime is not relabelled as HEAD. Guide evidence is the behavioral ledger designated by captain Option A; this attribution audit is not a new execution of every guide.'}
(OUT/'source-delta.json').write_text(json.dumps({'runtime':S,'candidate':C,'changedFiles':changed},indent=2)+'\n')
D={}
def put(key,status,gs,why):D[key]={'status':status,'guides':gs.split() if gs else [],'justification':why}
U='implemented-unverified'; V='verified'; F='failed'; B='blocked-external'
foundation=[
('T01',U,'00-main 12-customer-integrations','Operational ticket/provider and catalog denial samples pass; full UI/API/action product matrix, nested sponsorship, PSA/AlgaDesk parity not executed.'),
('T02',U,'02-licensing-and-seats','Simulator resize/replay supports capacity only; real checkout, out-of-order webhooks, annual sponsorship and independent Pro quantities/prices not established.'),
('T03',U,'02-licensing-and-seats','BLOCKED: signed sponsor-bound capacity and isolated self-host installation/lapse fixture absent; no offline validity/invalid-claim matrix.'),
('T04',U,'01-onboarding 02-licensing-and-seats','Lost response and unclaimed cleanup pass; concurrent last-seat invitation/import/reactivation races are not recorded.'),
('T05',U,'01-onboarding','New local client and acceptance verified; existing-tenant, second-sponsor, nested and foreign-installation negative cases remain untested.'),
('T06',U,'03-access-policies 07-conversations-and-files','Role/sibling/grant negatives recorded; no restricted field policy or complete two-MSP API/search/report/realtime matrix.'),
('T07',U,'04-delegated-administration','Board/profile/resend and stale revocation pass. Direct credential-reset, impersonation, scope expansion and privileged-proxy negative commands not exercised; UI omissions alone cannot accept the full contract.'),
('T08',U,'05-ticket-queue 08-sla','Escalation/handback/bulk retry and SLA paths pass; complete close/reopen/authoritative-ticket lifecycle and retry combinations are not all recorded.'),
('T09',F,'07-conversations-and-files 12-customer-integrations','Shared IT teams comment emailed to requester (guide12 probe comment7574b17c; requester delivery and SMTP receipt). Browser/attachment separation does not override email disclosure.'),
('T10',U,'00-main 05-ticket-queue 08-sla','Customer options and SLA mapping checked; identical ticket-number cross-customer and full board/FK routing matrix not recorded.'),
('T11',U,'05-ticket-queue','Under October14 amendment native/shared lists are separate. Scope/count/full filtered export and stale bulk denial pass; unauthorized projection/count matrix and client combined reader need remaining coverage.'),
('T12',V,'06-projects-and-tasks','All concrete contract clauses exercised: customer shares one project; both organizations edit same task; qualified MSP assignment preserves local assignee; sharing alone does not add working tasks; unshared project denied; revoke closes task, queue and file while customer retains it. Team-principal positive variant remains a guide limitation, not a claim of this acceptance.'),
('T13',F,'09-time-and-billing','Contract rate ignored and stored minimum/rounding not applied; catalog workaround enabled one draft, so native billing correctness and contract-backed pricing fail. Double invoice prevention not established.'),
('T14',U,'06-projects-and-tasks 09-time-and-billing','Persisted customer/MSP/combined task/project sums and private note exclusion pass; edits/deletes/moves and approval variants not all exercised.'),
('T15',U,'08-sla','Mapping/handback/resume/breach evidence passes; non-24/7 calendar and both CE/EE backend arithmetic not exercised.'),
('T16',U,'03-access-policies 04-delegated-administration 06-projects-and-tasks 10-departure-and-archives','Stale editor/file/queue revocation pass; queued notification/mail, cached search and workflow/concurrent-command cutoff matrix not executed.'),
('T17',U,'02-licensing-and-seats 10-departure-and-archives','Termination read-only evidence is not a 30-day lapse/renewal intake/growth/capacity matrix; lifecycle fixture absent.'),
('T18',U,'10-departure-and-archives 11-export-restore-and-upgrade','Retained bytes and encrypted inspect pass; current-build restore into isolated destination including credentials/files not executed. Destination storage/operator required; no promotion from historical restore.'),
('T19',U,'11-export-restore-and-upgrade','BLOCKED: independent hosted subscription/signed license and disposable live relationship required; failed-payment/seed retries and one-time conversion not executed.'),
('T20',U,'10-departure-and-archives','Customer deletion with invoice retention and fresh/upgrade Citus migrations not executed by this ledger.'),
('T21',U,'00-main 03-access-policies','Flag enabled only; disabled/loading/unknown/error plus both deployment-mode/native parity matrix not executed.'),
('T22',U,'01-onboarding 12-customer-integrations','No flag-off direct API/action/background matrix; enabled-path success does not prove backend independence.'),
]
for a in foundation:put(*a)
client={
'F001':('03-access-policies','Per-client UI read observed; independent unauthorized/paginated discovery behavior not established.'),
'F002':('03-access-policies','Customer/sponsor identity observed; selector conflict and lock-order contracts need behavioral concurrency evidence.'),
'F003':('10-departure-and-archives','Ended client tab wrongly defaults to not enabled/setup rather than retained relationship.'),
'F004':('01-onboarding','Same-intent retry recorded; different-operation concurrent Enable submissions not raced.'),
'F005':('03-access-policies 08-sla','Policy/SLA behavior recorded; six-consumer selector/revision matrix not fully exercised.'),
'F006':('04-delegated-administration 10-departure-and-archives','Individual management flows recorded; common-target/receipt negative matrix incomplete.'),
'F007':('05-ticket-queue','Qualified work navigation passes; legacy/conflicting selectors not comprehensively exercised.'),
'F008':('02-licensing-and-seats','Allocation UI observed; distinct invitation reservation/role-redaction counts not fully compared.'),
'F009':('01-onboarding','Client composition observed; package import direction is structural, not accepted by a video.'),
'F010':('01-onboarding 10-departure-and-archives','Active setup summary works; ended tab returns not enabled, so state-appropriate summary fails.'),
'F011':('01-onboarding','Full-page client Co-managed tab used; drawer and Details-only quick view not recorded.'),
'F012':('01-onboarding','Async flag, stale responses, transitions and dialog-unmount matrix absent.'),
'F013':('01-onboarding','Lost-response draft survives; simultaneous drawer IDs and dismissal/section draft matrix absent.'),
'F014':('01-onboarding','Fixed-client setup and acceptance recorded; automatic prefilling is not separately asserted, so not accepting every clause.'),
'F015':('01-onboarding','Resend, uncertain retry and cancellation pass; worker failure/expired invitation/delivery failure not induced.'),
'F016':('02-licensing-and-seats','Resize and restore pass; pending reservation, expected-seat race and lapse/growth matrix missing.'),
'F017':('03-access-policies 04-delegated-administration 08-sla','Selected-client MSP staff assignment/read-only customer scope, SLA mappings and granted delegated controls exercised in client relationship context; saves/reloads and target-bound DB receipts support the complete embedded-management contract.'),
'F018':('10-departure-and-archives','After departure client tab offers not enabled/setup; expected ended state/retained navigation absent.'),
'F019':('02-licensing-and-seats','Hosted simulator configuration only; edition/eligibility/configuration/readiness matrix missing.'),
'F020':('02-licensing-and-seats','No provider failure while preserving relationship management experiment.'),
'F021':('02-licensing-and-seats','Shortfall reviewed but not paid; refreshed target/provider-amount comparison incomplete.'),
'F022':('02-licensing-and-seats','Same-operation replay only; stale preview and cross-client uncertain purchase matrix missing.'),
'F023':('02-licensing-and-seats','Existing subscription resize completed; checkout expiry/failure/allocation race not executed.'),
'F024':('02-licensing-and-seats','Account return/draft TTL/logout/session isolation and secret-storage cases missing.'),
'F025':('02-licensing-and-seats','Pool editor used; pending recovery/self-host License Management return not exercised.'),
'F026':('02-licensing-and-seats','Role, CE, claim and checkout degradation matrix not exercised.'),
'F027':('01-onboarding','Overview used; pagination/search/independent authority and restricted count inference not fully established.'),
'F028':('01-onboarding 05-ticket-queue','Client setup/work links used; all old global edit/legacy ownership paths not checked.'),
'F029':('05-ticket-queue','Shared customer filter/export passes; combined native/client counts and qualification collision matrix missing.'),
'F030':('06-projects-and-tasks','Qualified task queue links exercised; native client feature-unavailable fallback missing.'),
'F031':('00-main','No flag-off asynchronous composition/backend-independence matrix.'),
'F032':('00-main','Entry/Grid observed; translated locale/theme/narrow/keyboard and CE/EE builds not fully covered.'),
'F033':('collection','Ledger is recorded, but full hosted/self-host migrated/provider acceptance and all plan/audit updates incomplete.'),
'T001':('03-access-policies','No same-client id collision plus stale/forbidden/inconsistent relationship resolution matrix.'),
'T002':('01-onboarding','No full action authorization/selector boundary matrix at this candidate.'),
'T003':('01-onboarding','Normal setup and lost response do not establish all required setup failure/topology inputs.'),
'T004':('01-onboarding','Different-operation concurrency and Citus locking/index paths not exercised.'),
'T005':('03-access-policies 04-delegated-administration 08-sla','Individual flows pass, full management-adapter independent identities/revision matrix missing.'),
'T006':('02-licensing-and-seats','Usage/invitation accounting and race/lapse exclusion matrix missing.'),
'T007':('01-onboarding','Drawer/quick view and parameterized unavailable/denied product composition not exercised.'),
'T008':('01-onboarding','Delayed flags/late promises/portal checkout unmount matrix not exercised.'),
'T009':('01-onboarding 10-departure-and-archives','Ended client state fails; delivery-vs-expiry recovery variants not executed.'),
'T010':('02-licensing-and-seats','Purchase role/deployment/configuration/claim failure matrix missing.'),
'T011':('02-licensing-and-seats','Resize sample only; full stale baseline/invalid quantity/shortfall purchase review matrix incomplete.'),
'T012':('02-licensing-and-seats','Cross-client pending and competing allocation races/lost purchase response not recorded.'),
'T013':('02-licensing-and-seats','Embedded checkout recovery matrix absent; simulator resized existing subscription.'),
'T014':('02-licensing-and-seats','Self-host entitlement and expiring per-session draft return matrix absent.'),
'T015':('01-onboarding','Overview ordinary read only; independent role/count/pagination/redaction matrix incomplete.'),
'T016':('05-ticket-queue 06-projects-and-tasks','Qualified work/export samples pass; client combined rows/id collisions/flag-off matrix missing.'),
'T017':('05-ticket-queue','Legacy adapter foreign/conflicting selectors and disabled state not exercised.'),
'T018':('01-onboarding 02-licensing-and-seats','External release-operator: real Stripe test account/price/checkout plus role/flag-off hosted browser matrix required; simulator does not substitute.'),
'T019':('02-licensing-and-seats','External release-operator: signed sponsor-bound capacity and isolated self-host installation, invalid/expired claims and return-draft journey required.'),
'T020':('01-onboarding','No actual flag-off backend execution matrix.'),
'T021':('00-main collection','CE/EE build, drawer/narrow/theme/keyboard/locale and T21-off independent account surfaces not all executed.'),
}
for key,(gs,why) in client.items():put('clientIntegration:'+key,V if key=='F017' else F if key in ('F003','F010','F018','T009') else B if key in ('T018','T019') else U,gs,why)
# Narrow user-visible requirements actually evidenced by the ledger.
for key,gs,why in [
('ticketList:F040','05-ticket-queue','Separate Customer Tickets page renders native vocabulary and qualified links while All Tickets remains native.'),
('ticketList:F044','05-ticket-queue','Working/oversight list and full filtered CSV include shared customers only; native control remains in All Tickets.'),
('nativeTicketScreen:F018','00-main','Shared Entry/Grid customer option sets used and saved; category/status/priority persist in owner tenant.'),
('nativeTicketScreen:F024','00-main 08-sla','Native Entry and Grid Co-managed sections show responsibility, separate clocks and handoff actions.'),
('nativeTicketScreen:F030','06-projects-and-tasks 09-time-and-billing','Customer/MSP/combined effort shown and reconciled to stored entries on both sides.'),
('nativeTicketScreen:F032','00-main 05-ticket-queue','Qualified route renders native screen within MSP shell with customer identity; followed from the queue.'),
('nativeTicketScreen:F033','00-main','Customer native route renders the Co-managed section in Entry/Grid without stacked legacy panel.'),
]:put(key,V,gs,why)
put('nativeTicketScreen:F023',F,'12-customer-integrations','Customer native composer displays Shared IT teams but the stored comment is requester-visible and requester mail contains its body.')
put('ticketList:F040',U,'05-ticket-queue','Separate page/rendering proven, but release-boundary loading and workspace=msp rejection are not executed in the guide; do not accept the entire row.')
# Validate decisions and attach executed evidence; unreviewed rows keep exact existing remainingAcceptance.
keys={r['key'] for r in inv['rows']};assert set(D)<=keys
for r in inv['rows']:
 d=D.get(r['key'])
 if d:
  assert all(g in guides for g in d['guides']);r['status']=d['status'];r['justification']=d['justification'];r['remainingAcceptance']='' if d['status']==V else d['justification'];r['evidence']=[{'id':ids[g]} for g in d['guides']]
 else:r['justification']='No full guide-to-clause attribution established in this smoke. '+r['remainingAcceptance']
 bykey={x['key']:x for x in manifest['requirements']};m=bykey[r['key']];m.update(status=r['status'],justification=r['justification'],evidence=r['evidence']);m['requiredInCard']=r['status']!=B
 if r['status']==B:m['externalOwner']='release-operator'
manifest['runtimeEvidence']={'recordingCoverage':rel(base/'video-coverage.json'),'attribution':'attribution-decisions.json','mediaAudit':'media-audit.json','sourceRevision':S,'buildId':'build-1792983401994','dependencyAnalysis':'Source equivalence verified by source-delta.json; no media or runtime relabelled.'}
manifest['provenance']['app']={'revision':S,'buildId':'build-1792983401994','dependencyAnalysis':'source-delta.json'}
manifest['openDefects']=[
 {'id':'shared-it-requester-email-disclosure','kind':'security','summary':D['T09']['justification']},
 {'id':'contract-hourly-rate-and-minimum','kind':'functional','summary':D['T13']['justification']},
 {'id':'ended-client-state','kind':'functional','summary':D['clientIntegration:F018']['justification']},
]
manifest['reviewEnvironment']={'stable':False,'observedMinutes':0,'healingEvents':None,'note':'No stability certification in this bounded smoke.'}
pr=json.load(open('/tmp/alga-smoke-evidence/co-managed-it-20261026-0453/pr-state.json'))
manifest['pr']={**manifest.get('pr',{}),'url':pr['url'],'head':pr['headRefOid'],'mergeable':pr['mergeable'],'mergeStateStatus':pr['mergeStateStatus'],'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
manifest['mergeability']={'mergeable':pr['mergeable'],'mergeStateStatus':pr['mergeStateStatus'],'checkedAtSha':C,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
manifest['currentSmokeEvidence']={'directory':'/tmp/alga-smoke-evidence/co-managed-it-20261026-0453','privacyReceipt':'12-privacy-requester-mail.json','privacyCommentId':'aa0fa6f0-58e9-4fbe-87d3-293723ff65f0','tagChecks':'Native and active A-to-blank/A-to-B without reload and reload agreement; terminated refused with unchanged database.'}
inv['evidence']=manifest['evidence'];inv['totals']['byStatus']=dict(collections.Counter(r['status'] for r in inv['rows']))
(OUT/'attribution-decisions.json').write_text(json.dumps({'candidate':C,'runtime':S,'policy':'Captain Option A. Full requirement clauses only; partial guides may support a narrow row, never an automatic full-guide pass. No tests/flags inferred from source existence.','decisions':D},indent=2)+'\n')
for f,x in [('inventory.json',inv),('manifest.json',manifest)]: (OUT/f).write_text(json.dumps(x,indent=2)+'\n')
(OUT/'inventory.md').write_text('# Current guide attribution\n\n'+json.dumps(inv['totals'])+'\n\n| Key | Status | Justification / remaining acceptance |\n|---|---|---|\n'+'\n'.join('| '+r['key']+' | '+r['status']+' | '+r['justification'].replace('|','/')+' |' for r in inv['rows'])+'\n')
(OUT/'remaining-acceptance.md').write_text('# Named unaccepted requirements\n\n'+'\n'.join('- **'+r['key']+'** ('+r['status']+'): '+r['remainingAcceptance'] for r in inv['rows'] if r['status']!=V)+'\n')
print(OUT);print(inv['totals'])
