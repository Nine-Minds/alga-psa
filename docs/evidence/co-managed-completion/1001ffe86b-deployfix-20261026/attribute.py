"""Attribution for the deploy-fix round at candidate 22c832d4b4 (served as a board-admitted production build).
Regenerates the source census for the candidate, carries the 071cb21b12 smoke decisions forward unchanged
except where this round re-ran behaviour on the served build, and never promotes a row whose clauses were
not all exercised. Run from the worktree after the three guide runs; no plan or verifier rule is changed.
"""
import pathlib, json, subprocess, hashlib, collections, datetime, os
ROOT = pathlib.Path.cwd()
NAME = '1001ffe86b-deployfix-20261026'
OUT = ROOT / 'docs/evidence/co-managed-completion' / NAME
PRIOR = ROOT / 'docs/evidence/co-managed-completion/071cb21b12-smoke-20261026'
C = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
S = subprocess.check_output(['git', 'rev-parse', '1001ffe86b'], text=True).strip()  # source the production build was made from
DIST = 'server/.next-review-final-1001ffe86'
stamp = (ROOT / DIST / '.alga-review-revision').read_text().strip()
build_id = (ROOT / DIST / 'BUILD_ID').read_text().strip()
assert stamp == S + '+da39a3ee5e6b', f'served build stamp {stamp} is not the clean candidate source'
changed = subprocess.check_output(['git', 'diff', '--name-only', S, C], text=True).splitlines()
assert all(p.startswith('docs/evidence/') for p in changed), 'Runtime equivalence no longer holds'
facts = OUT / 'candidate-facts.json'
subprocess.run(['node', 'scripts/build-co-managed-inventory.mjs', '--candidate', C, '--out', str(OUT), '--facts', str(facts)], check=True, stdout=subprocess.DEVNULL)
manifest = json.load(open(OUT / 'manifest.json')); inv = json.load(open(OUT / 'inventory.json'))
prior_decisions = json.load(open(PRIOR / 'attribution-decisions.json'))['decisions']
prior_manifest = json.load(open(PRIOR / 'manifest.json'))
def rel(p): return os.path.relpath(p, OUT)
def digest(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()

# --- evidence: the 14-guide ledger from the 071cb21b12 smoke keeps its real runtime (54e75edfab) ----------
for gid, item in prior_manifest['evidence'].items():
    if gid.startswith('guide-'):
        e = dict(item); e['artifact'] = os.path.relpath(PRIOR / item['artifact'], OUT)
        e['dependencyAnalysis'] = (item.get('dependencyAnalysis', '') + ' Carried forward unchanged from the 071cb21b12 attribution; '
            f'its runtime stays 54e75edfab/build-1792983401994, not {S[:10]}. Rows it supports keep their 071cb21b12 status unless this round '
            're-ran them; see the per-row dependency notes in attribution-decisions.json.')
        manifest['evidence'][gid] = e

# --- evidence: this round's runs on the served build -------------------------------------------------------
G = OUT / 'guides'
runs = {
  'deployfix-12-privacy-probe': ('12-privacy-probe', 'Real production UI: Alice posts default/re-selected Shared IT, private, Grid Shared IT and a requester reply on requester ticket 000016; DB audiences, requester delivery rows and SMTP sink checked', ['db-smtp-receipt.json']),
  'deployfix-09-billing': ('09-billing', 'Real production UI: remove the catalog-price workaround, reverse the phantom draft, restore the White Rabbit contract, generate from Automatic Invoices, verify exact amounts in UI and DB, regenerate (no double billing), terminate again', ['db-before.json', 'db-new-invoice.json', 'db-after.json']),
  'deployfix-10-departure-sponsor': ('10-departure-sponsor', 'Real production UI as QA (Oz): Kansas Farms ended tab/summary/archive navigation, White Rabbit active control, absent-relationship client control', []),
  'deployfix-10-departure-ended-workspace': ('10-departure-ended-workspace', 'Real production UI as the Kansas Farms admin: ended access/SLA pages, Entry/Grid write-control audit, direct server-action writes refused, DB unchanged; Alice active control', ['db-receipt.json', 'direct-server-action-writes.json']),
}
media = []
for eid, (d, cmd, receipts) in runs.items():
    rec = json.load(open(G / d / 'recording.json')); webm = G / d / 'walkthrough.webm'; vtt = G / d / 'chapters.vtt'
    assert rec['scenarioStatus'] == 'passed', f'{d} did not pass'
    assert rec['build']['buildId'] == build_id and rec['build']['revision'] == stamp, f'{d} ran on another build'
    m = {'webm': rel(webm), 'sha256': digest(webm), 'durationSeconds': rec.get('durationSeconds'), 'vtt': rel(vtt), 'vttSha256': digest(vtt),
         'recording': rel(G / d / 'recording.json'), 'recordingSha256': digest(G / d / 'recording.json'), 'chapters': len(rec.get('chapters', []))}
    media.append({'evidence': eid, **m})
    manifest['evidence'][eid] = {'type': 'browser', 'sha': S, 'command': cmd,
        'result': json.dumps({'status': rec['scenarioStatus'], 'assertions': [a['id'] for a in rec['assertions']], 'limitations': rec.get('limitations', [])}),
        'artifact': rel(G / d / 'recording.json'), 'artifactAvailable': True, 'artifactSha256': digest(G / d / 'recording.json'), 'media': m,
        'receipts': {r: {'path': rel(G / d / r), 'sha256': digest(G / d / r)} for r in receipts},
        'dependencyAnalysis': f'Ran on {build_id} served on :23374 from {DIST} (stamp {stamp}); HEAD differs from the source only in docs/evidence.'}
(OUT / 'media-audit.json').write_text(json.dumps(media, indent=2) + '\n')
tests = json.load(open(OUT / 'regression-tests.json'))
manifest['evidence']['deployfix-regression-tests'] = {'type': 'test', 'sha': S, 'command': '; '.join(t['command'] for t in tests['runs']),
    'result': json.dumps({t['name']: t['result'] for t in tests['runs']}), 'artifact': 'regression-tests.json', 'artifactAvailable': True,
    'artifactSha256': digest(OUT / 'regression-tests.json'), 'dependencyAnalysis': 'Regression and mutation runs for the three fixes at the candidate source.'}

# --- decisions -----------------------------------------------------------------------------------------------
D = {}
for key, d in prior_decisions.items():
    D[key] = {'status': d['status'], 'evidence': ['guide-' + g for g in d['guides']], 'justification': d['justification'], 'source': '071cb21b12 carried forward'}
U, V, F, B = 'implemented-unverified', 'verified', 'failed', 'blocked-external'
# Rows verified at 071cb21b12 keep that status and their 54e75edfab evidence; each note says what this round changed near it.
CARRIED = {
  'T12': 'No project/task code changed this round (packages/projects untouched).',
  'clientIntegration:F017': 'Active-relationship sections unchanged: the policy/SLA panels only gained an ended-state branch (reached only when no target resolves) and the client view only changed its ended/setup/selector conditions; the active White Rabbit tab was re-observed on the final build (deployfix-10-departure-sponsor).',
  'ticketList:F044': 'Customer Tickets list code untouched this round.',
  'nativeTicketScreen:F018': 'Shared option sets and saves untouched; this round only gates write affordances on read-only screens and frozen title/client/contact fields.',
  'nativeTicketScreen:F024': 'Co-managed section slots untouched this round.',
  'nativeTicketScreen:F030': 'Effort display code untouched this round.',
  'nativeTicketScreen:F032': 'Qualified route untouched; the composer change only affects which audience is submitted.',
  'nativeTicketScreen:F033': 'The local provider changed its comment write paths and loading state only; the Co-managed section slot is unchanged. Alice\'s native ticket was re-exercised on the final build (deployfix-12-privacy-probe) without asserting the section.',
}
for key, note in CARRIED.items():
    assert D[key]['status'] == V, key
    D[key]['justification'] += ' [deploy-fix round dependency note: ' + note + ' Evidence runtime remains 54e75edfab/build-1792983401994.]'
def put(key, status, evidence, why):
    D[key] = {'status': status, 'evidence': evidence, 'justification': why, 'source': f'deploy-fix round on {build_id}'}
P12, P09, P10S, P10C, TST = 'deployfix-12-privacy-probe', 'deployfix-09-billing', 'deployfix-10-departure-sponsor', 'deployfix-10-departure-ended-workspace', 'deployfix-regression-tests'
put('nativeTicketScreen:F023', V, [P12, TST], 'All clauses exercised on the served build: the customer native composer shows the requester/shared_it/private audience control and writes each one (Entry: default and re-selected Shared IT, Private to White Rabbit IT, Requester and IT teams; Grid: Shared IT lane selected by default). Stored thread audiences are shared_it / organization_private / requester; only the requester reply produced a requester delivery row and requester mail.')
put('T09', U, [P12, TST, 'guide-07-conversations-and-files', 'guide-12-customer-integrations'], 'The failed clause is fixed and proven on the served build: Shared IT and private notes produce no requester delivery row and no requester mail (DB + SMTP sink), requester replies still deliver; the server refuses a requester-visible co-managed comment with no audience (PostgreSQL). Still required on this build: portal visibility, foreign-author attribution, notification/search/export and shared project comment disclosure matrix (only conversation/email was re-run).')
put('T13', U, [P09, TST, 'guide-09-time-and-billing'], 'The failed clauses are fixed and proven on the served build with no catalog price: the 17 White Rabbit co-managed entries bill at the contract rate with the line 15-minute minimum and rounding (17 x 0.25 h x $100.00 = $425.00 in UI and DB), and regeneration offers nothing so nothing is billed twice. Still required on this build: customer time without service/contract setup, MSP time entry/edit/approval, catalog-priced time with a real catalog price, and native (non-co-managed) billing regression; those clauses were not re-run.')
put('clientIntegration:F003', U, [P10S, TST, 'guide-10-departure-and-archives'], 'Ended (Kansas Farms), single current (White Rabbit) and absent (Emerald City) client states render explicitly on the served build; the ended default selection is covered by PostgreSQL. Still required: multiple, inconsistent and forbidden relationship states and live rejection of a write whose expected relationship identity changed.')
put('clientIntegration:F010', U, [P10S, 'guide-01-onboarding'], 'State-appropriate summaries proven on the served build: absent offers Enable, active shows seat usage and Manage, ended shows the end date and View history. Still required: the shared refresh state between summary and client view (a refresh/mutation driven update was not exercised).')
put('clientIntegration:F018', V, [P10S, P10C, TST], 'All clauses exercised on the served build: the active White Rabbit tab exposes End co-management; the ended Kansas Farms tab and summary show the end date and navigate to the Shared work archive (opened); the ended view reads no live customer usage (Seats released, no live seat count; PostgreSQL asserts usedSeats null for an ended relationship) and its labels come from the sponsor-owned operation.')
put('clientIntegration:T009', U, [P10S, 'guide-01-onboarding', 'guide-10-departure-and-archives'], 'The ended-state clause (ended state uses retained history, no setup) is fixed and proven on the served build. Still required: the fixed-client setup journey with reserved progress, pending acceptance, original-operation reopen after failure/reload, invitation expiry versus delivery failure, and summary/usage refresh after allocation or recovery.')

keys = {r['key'] for r in inv['rows']}; assert set(D) <= keys
for r in inv['rows']:
    d = D.get(r['key'])
    if d:
        r['status'] = d['status']; r['justification'] = d['justification']; r['remainingAcceptance'] = '' if d['status'] == V else d['justification']
        r['evidence'] = [{'id': e} for e in d['evidence']]
    else:
        r['justification'] = 'No full clause attribution established. ' + r['remainingAcceptance']
    m = {x['key']: x for x in manifest['requirements']}[r['key']]
    m.update(status=r['status'], justification=r['justification'], evidence=r['evidence']); m['requiredInCard'] = r['status'] != B
    if r['status'] == B: m['externalOwner'] = 'release-operator'
for d in D.values():
    for e in d['evidence']: assert e in manifest['evidence'], e

worker = json.load(open(OUT / 'worker-provenance.json'))
manifest['provenance']['app'] = {'revision': S, 'buildId': build_id, 'dist': DIST, 'stamp': stamp, 'servedAt': ':23374 (board review-app)', 'dependencyAnalysis': 'source-delta.json'}
manifest['provenance']['worker'] = worker
manifest['runtimeEvidence'] = {'attribution': 'attribution-decisions.json', 'mediaAudit': 'media-audit.json', 'sourceRevision': S, 'buildId': build_id,
    'supersededAttempts': 'attempts/build-1792995121422/README.md'}
manifest['openDefects'] = []
manifest['reviewEnvironment'] = {'stable': False, 'observedMinutes': 0, 'healingEvents': None, 'note': 'No stability observation in this bounded round.'}
(OUT / 'source-delta.json').write_text(json.dumps({'runtime': S, 'candidate': C, 'changedFiles': changed}, indent=2) + '\n')
inv['evidence'] = manifest['evidence']; inv['totals']['byStatus'] = dict(collections.Counter(r['status'] for r in inv['rows']))
(OUT / 'attribution-decisions.json').write_text(json.dumps({'candidate': C, 'runtime': S, 'buildId': build_id,
    'policy': 'Rows move to verified only when every clause was exercised on the served build; partially re-run rows leave failed for implemented-unverified with the gap named; everything else carries the 071cb21b12 decision and its 54e75edfab evidence unchanged.',
    'decisions': D}, indent=2) + '\n')
for f, x in [('inventory.json', inv), ('manifest.json', manifest)]: (OUT / f).write_text(json.dumps(x, indent=2) + '\n')
(OUT / 'inventory.md').write_text('# Deploy-fix attribution\n\n' + json.dumps(inv['totals']) + '\n\n| Key | Status | Justification / remaining acceptance |\n|---|---|---|\n' + '\n'.join('| ' + r['key'] + ' | ' + r['status'] + ' | ' + r['justification'].replace('|', '/') + ' |' for r in inv['rows']) + '\n')
(OUT / 'remaining-acceptance.md').write_text('# Named unaccepted requirements\n\n' + '\n'.join('- **' + r['key'] + '** (' + r['status'] + '): ' + r['remainingAcceptance'] for r in inv['rows'] if r['status'] != V) + '\n')
print(OUT); print(inv['totals'])
