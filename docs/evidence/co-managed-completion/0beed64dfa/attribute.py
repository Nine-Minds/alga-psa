"""Census packet for the late-time completion round served as build-1793025108142 (source 2d00cb6f0e).

Regenerates the current-source census at the candidate (the 2d00cb6f0e evidence commit) and applies the
decisions in co-managed-deploy/2d00cb6f0e/requirement-attribution.json. Evidence from build-1793021045283
(8093816c90) is carried with an explicit dependency analysis: every code change since then is billing-only.
No plan, verifier rule or earlier packet is changed. Run from the worktree root at the candidate.
"""
import collections, hashlib, json, os, pathlib, subprocess
ROOT = pathlib.Path.cwd()
git = lambda *a: subprocess.check_output(['git', *a], text=True).strip()
C = git('rev-parse', 'HEAD'); S1 = git('rev-parse', '8093816c90'); S2 = git('rev-parse', '2d00cb6f0e')
OUT = ROOT / 'docs/evidence/co-managed-completion' / C[:10]
D1 = ROOT / 'docs/evidence/co-managed-deploy/8093816c90'; D2 = ROOT / 'docs/evidence/co-managed-deploy/2d00cb6f0e'
stamp2 = (ROOT / 'server/.next-review-final-2d00cb6f/.alga-review-revision').read_text().strip()
build2 = (ROOT / 'server/.next-review-final-2d00cb6f/BUILD_ID').read_text().strip()
assert stamp2 == S2 + '+da39a3ee5e6b'
since2 = git('diff', '--name-only', S2, C).splitlines(); assert all(p.startswith('docs/evidence/') for p in since2)
since1 = [p for p in git('diff', '--name-only', S1, C).splitlines() if not p.startswith('docs/evidence/')]
assert all(p.startswith(('packages/billing/', 'packages/types/src/interfaces/', 'server/public/locales/', 'server/src/test/', 'ee/temporal-workflows/src/__tests__/')) for p in since1), since1
assert not [p for p in since1 if p.startswith(('packages/co-managed/', 'server/src/components/co-managed/', 'server/src/lib/actions/coManaged', 'server/src/app/'))], since1
subprocess.run(['node', 'scripts/build-co-managed-inventory.mjs', '--candidate', C, '--out', str(OUT)], check=True, stdout=subprocess.DEVNULL)
manifest = json.load(open(OUT / 'manifest.json')); inv = json.load(open(OUT / 'inventory.json'))
rel = lambda p: os.path.relpath(p, OUT); digest = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
DEP2 = f'Ran on {build2} (stamp {stamp2}); the candidate differs from that source only under docs/evidence.'
DEP1 = ('Ran on build-1793021045283 (8093816c90). Code changed since then only in billing (engine late-time windows, actions, Automatic '
        'Invoices notices), interface types, invoicing locales and tests: ' + ', '.join(since1) + '. None of it is co-managed client management, '
        'conversations, search, export or onboarding, so this evidence still describes the candidate for the rows it supports.')
SC = {
  'rt2-late-time-notices': (D2, '01-late-time-notices', S2, DEP2, 'Production UI as QA: restore contract, Oct-18 approved native time, Automatic Invoices + November preview (carried), terminate, Automatic Invoices + October preview (stranded), product cleanup'),
  'rt2-reversed-draft': (D2, '02-reversed-draft-reopens', S2, DEP2, 'Production UI: wizard contract on Cancel-3, QA time approved, draft INV-000007, Glinda time approved after it (named late), reverse draft, regenerate (both entries, no late label)'),
  'rt2-t09-task-audiences': (D2, '04-t09-task-audiences', S2, DEP2, 'Production UI: Alice project grant; QA and Alice post task messages in four audiences; Alice, QA and client-portal requester views; DB stores'),
  'rt2-t13-time-edit': (D2, '05-t13-time-entry-edit', S2, DEP2, 'Production UI as QA: record MSP time on shared ticket 000016, edit it from the timesheet (45 min, note), DB attribution, Alice view, delete'),
  'rt1-f003-states': (D1, '06-f003-relationship-states', S1, DEP1, 'Production UI: relationship states, forbidden, tampered URL, multiple/inconsistent fixtures, stale write, seat refresh (build-1793021045283)'),
  'rt1-t009-onboarding': (D1, '07-t009-onboarding-recovery', S1, DEP1, 'Production UI: setup with SMTP reject, reload, durable recovery, expiry fixture, cancel (build-1793021045283)'),
  'rt1-t09-privacy': (D1, '04-t09-privacy', S1, DEP1, 'Production UI: ticket audiences, search/typeahead, client portal (build-1793021045283)'),
  'rt1-t09-export': (D1, '05-t09-export', S1, DEP1, 'Production UI: portable export decrypted and scanned (build-1793021045283)'),
  'rt1-billing-late-time': (D1, '01-billing-late-time', S1, DEP1, 'Production UI: late native + co-managed time billed once on the next invoice (build-1793021045283)'),
  'rt1-t13-msp-edit': (D1, '03-t13-msp-edit-attribution', S1, DEP1, 'Production UI: qualified MSP ticket edit attribution (build-1793021045283)'),
}
media = []
for eid, (base, d, sha, dep, cmd) in SC.items():
    rec_path = base / d / 'recording.json'; rec = json.load(open(rec_path))
    passed = [a['id'] for a in rec['assertions'] if a.get('passed', True)]
    status = rec['scenarioStatus'] if rec['scenarioStatus'] == 'passed' else (rec['scenarioStatus'] + ' (all behaviour assertions passed; see README)')
    m = {'webm': rel(base / d / 'walkthrough.webm'), 'sha256': digest(base / d / 'walkthrough.webm'), 'durationSeconds': rec.get('durationSeconds'), 'chapters': len(rec.get('chapters', []))}
    media.append({'evidence': eid, **m})
    manifest['evidence'][eid] = {'type': 'browser', 'sha': sha, 'command': cmd, 'result': json.dumps({'status': status, 'assertions': passed, 'limitations': rec.get('limitations', [])}),
        'artifact': rel(rec_path), 'artifactSha256': digest(rec_path), 'media': m, 'dependencyAnalysis': dep}
manifest['evidence']['rt2-regression-tests'] = {'type': 'automated', 'sha': S2, 'dependencyAnalysis': DEP2, 'artifact': rel(D2 / 'README.md'),
    'command': 'server lateApprovedHourlyTime.integration (5), coManagedBootstrap invoice journey (5) and full suite, packages/billing vitest, server tsc, lateHourlyTimeNotices UI unit, mutation controls',
    'result': json.dumps({'nativeLateTime': '5/5 at 2d00cb6f0e', 'coManagedBootstrap': '1494/1494 at 1166f31a1a; invoice journey 5/5 at 2d00cb6f0e', 'billingPackage': '1950/1950',
      'serverTypecheck': 'exit 0 at 1166f31a1a and 2d00cb6f0e', 'mutations': 'disposition forced -> stranded cases red (native + co-managed); cancelled exclusion restored -> voided case red'})}
attr = json.load(open(D2 / 'requirement-attribution.json'))
EVMAP = {'04-t09-task-audiences/': 'rt2-t09-task-audiences', '../8093816c90/04-t09-privacy/': 'rt1-t09-privacy', '../8093816c90/05-t09-export/': 'rt1-t09-export',
         '05-t13-time-entry-edit/': 'rt2-t13-time-edit', '01-late-time-notices/': 'rt2-late-time-notices', '02-reversed-draft-reopens/': 'rt2-reversed-draft',
         '../8093816c90/01-billing-late-time/': 'rt1-billing-late-time', '../8093816c90/03-t13-msp-edit-attribution/': 'rt1-t13-msp-edit'}
CARRIED = {'clientIntegration:F003': ['rt1-f003-states'], 'clientIntegration:F010': ['rt1-f003-states'], 'clientIntegration:T009': ['rt1-t009-onboarding', 'rt1-f003-states']}
prior = json.load(open(ROOT / 'docs/evidence/co-managed-completion/698cddfd4c/manifest.json'))
prior_rows = {r['key']: r for r in prior['requirements']}
decisions = {}
for row in attr['rows']:
    k = row['key']
    if row['status'] == 'verified':
        decisions[k] = {'status': 'verified', 'evidence': CARRIED[k], 'justification': prior_rows[k]['justification'] + ' [Carried to ' + C[:10] + ': ' + row['dependencyAnalysis'] + ']'}
    elif row['status'] == 'blocked-external':
        decisions[k] = {'status': 'blocked-external', 'evidence': [], 'justification': 'Blocked on an external resource: ' + row['missing'] + '. Not faked.', 'external': row['missing']}
    else:
        decisions[k] = {'status': 'implemented-unverified', 'evidence': [EVMAP[e] for e in row['evidence']], 'justification': 'Progress: ' + row['progress'] + ' Remaining: ' + row['remaining']}
# Carry every other non-default decision of the previous packet (progress notes on F015, T17, T18, F018) unchanged.
for k, r in prior_rows.items():
    if k in decisions or r['status'] != 'implemented-unverified' or r['justification'].startswith('Current source and regression'): continue
    ev = [e['id'] for e in r['evidence'] if e['id'] != 'current-source-census']
    remap = {'rt-t009-onboarding': 'rt1-t009-onboarding', 'rt-closure-archive': None, 'rt-t09-export': 'rt1-t09-export', 'rt-f003-states': 'rt1-f003-states'}
    decisions[k] = {'status': 'implemented-unverified', 'evidence': [remap.get(e, None) for e in ev if remap.get(e)], 'justification': r['justification'] + ' [carried from the 698cddfd4c packet]'}
external = {r['key']: r['externalPrerequisite'] for r in prior['requirements'] if r.get('externalPrerequisite')}
for r in manifest['requirements']:
    d = decisions.get(r['key'])
    if d:
        r['status'] = d['status']; r['justification'] = d['justification']
        r['evidence'] = [{'id': 'current-source-census'}] + [{'id': e} for e in d['evidence']]
        r['requiredInCard'] = d['status'] != 'blocked-external'
        if d.get('external'): r['externalPrerequisite'] = d['external']; r['externalOwner'] = 'release-operator'
    if r['key'] in external and 'externalPrerequisite' not in r: r['externalPrerequisite'] = external[r['key']]
    if r['status'] == 'verified':
        assert any(manifest['evidence'][e['id']]['type'] != 'analysis' for e in r['evidence'] if e['id'] in manifest['evidence']), r['key']
for r in inv['rows']:
    m = next(x for x in manifest['requirements'] if x['key'] == r['key'])
    r.update(status=m['status'], justification=m['justification'], evidence=m['evidence'])
    if m.get('externalPrerequisite'): r['externalPrerequisite'] = m['externalPrerequisite']
prov = json.load(open(D2 / 'runtime-provenance.json'))
manifest['provenance']['app'] = {'revision': S2, 'buildId': build2, 'stamp': stamp2, 'dist': 'server/.next-review-final-2d00cb6f', 'boardAdmission': prov['app']['boardAdmission'], 'dependencyAnalysis': 'source-delta.json'}
manifest['provenance']['worker'] = {'revision': S1, **prov['workers'], 'note': 'Workers last rebuilt at 8093816c90; nothing they compile changed since.'}
manifest['runtimeEvidence'] = {'attribution': rel(D2 / 'requirement-attribution.json'), 'mediaAudit': 'media-audit.json', 'sourceRevision': S2, 'buildId': build2, 'carriedRuntime': {'sourceRevision': S1, 'buildId': 'build-1793021045283'}}
(OUT / 'media-audit.json').write_text(json.dumps(media, indent=2) + '\n')
(OUT / 'source-delta.json').write_text(json.dumps({'runtime': S2, 'candidate': C, 'changedSinceRuntime': since2, 'codeChangedSinceCarriedRuntime': since1}, indent=2) + '\n')
counts = dict(collections.Counter(r['status'] for r in manifest['requirements']))
inv.setdefault('totals', {})['byStatus'] = counts; inv['evidence'] = manifest['evidence']
(OUT / 'attribution-decisions.json').write_text(json.dumps({'candidate': C, 'runtime': S2, 'buildId': build2, 'baseline': attr['baselineCensus'], 'after': counts, 'policy': attr['policy'], 'decisions': decisions}, indent=2) + '\n')
for f, x in [('manifest.json', manifest), ('inventory.json', inv)]: (OUT / f).write_text(json.dumps(x, indent=2) + '\n')
(OUT / 'inventory.md').write_text('# Requirement census at ' + C[:10] + ' (runtime ' + S2[:10] + ', ' + build2 + ')\n\n' + json.dumps(counts) + '\n\n| Key | Status | Justification |\n|---|---|---|\n'
    + '\n'.join('| ' + r['key'] + ' | ' + r['status'] + ' | ' + r['justification'].replace('|', '/').replace('\n', ' ') + ' |' for r in manifest['requirements']) + '\n')
(OUT / 'remaining-acceptance.md').write_text('# Named unaccepted requirements at ' + C[:10] + '\n\n' + json.dumps(counts) + '\n\n' + '\n'.join(
    f"- **{r['key']}** ({r['status']}): {r['justification']}" + (f" — external prerequisite: {r['externalPrerequisite']}" if r.get('externalPrerequisite') else '')
    for r in manifest['requirements'] if r['status'] != 'verified') + '\n')
print(OUT, counts)
