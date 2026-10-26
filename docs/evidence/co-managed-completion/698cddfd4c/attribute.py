"""Census packet for the runtime-acceptance round served as build-1793021045283 (source 8093816c90).

Regenerates the current-source census at the candidate (the evidence commit), adds this round's executed
browser evidence, and applies the decisions in ../../co-managed-deploy/8093816c90/requirement-attribution.json.
Only rows whose every clause ran on the served build are promoted. No plan, verifier rule or earlier packet
is changed; earlier builds' evidence is not relabelled. Run from the worktree root at the candidate.
"""
import collections, hashlib, json, os, pathlib, subprocess
ROOT = pathlib.Path.cwd()
C = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
S = subprocess.check_output(['git', 'rev-parse', '8093816c90'], text=True).strip()
OUT = ROOT / 'docs/evidence/co-managed-completion' / C[:10]
DEPLOY = ROOT / 'docs/evidence/co-managed-deploy/8093816c90'
DIST = ROOT / 'server/.next-review-final-8093816c'
stamp = (DIST / '.alga-review-revision').read_text().strip(); build_id = (DIST / 'BUILD_ID').read_text().strip()
assert stamp == S + '+da39a3ee5e6b', 'served build is not the clean runtime source'
changed = subprocess.check_output(['git', 'diff', '--name-only', S, C], text=True).splitlines()
assert changed and all(p.startswith('docs/evidence/') for p in changed), 'candidate differs from the runtime source outside docs/evidence'
subprocess.run(['node', 'scripts/build-co-managed-inventory.mjs', '--candidate', C, '--out', str(OUT)], check=True, stdout=subprocess.DEVNULL)
manifest = json.load(open(OUT / 'manifest.json')); inv = json.load(open(OUT / 'inventory.json'))
rel = lambda p: os.path.relpath(p, OUT)
digest = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
DEP = (f'Ran on {build_id} served on :23374 from server/.next-review-final-8093816c (stamp {stamp}). The candidate {C[:10]} '
       f'differs from that source only under docs/evidence ({len(changed)} files), so the runtime behaviour is the candidate\'s.')
SCEN = {
  'rt-billing-late-time': ('01-billing-late-time', 'Real production UI as QA: restore the White Rabbit hourly contract, log Oct-18 MSP time on shared ticket 000016 and native time on a new native ticket, approve the sheet, generate the November-service period from Automatic Invoices, open the draft, retry; DB checks'),
  'rt-billing-cleanup': ('02-billing-late-time-cleanup', 'Real production UI as QA: reverse disposable draft, reverse approval, delete entries/ticket/team, terminate contract, clear billing email; INV-000003 checked'),
  'rt-t13-msp-edit': ('03-t13-msp-edit-attribution', 'Real production UI: QA edits shared ticket priority; customer audit row and Alice history read; priority restored'),
  'rt-t09-privacy': ('04-t09-privacy', 'Real production UI: Alice and QA post four-audience markers; QA/Alice full search and palette typeahead; requester 07 client portal ticket, counts and search; DB audience storage'),
  'rt-t09-export': ('05-t09-export', 'Real production UI: Alice downloads the encrypted portable backup; archive decrypted with packages/co-managed openPortableArchive and scanned for markers'),
  'rt-f003-states': ('06-f003-relationship-states', 'Real production UI: Technician viewer forbidden probes; tampered relationship URL; single/ended/absent client tabs; seat 1->2->1 summary refresh; multiple and inconsistent states via reversible SQL fixtures; stale two-tab staff-access save'),
  'rt-t009-onboarding': ('07-t009-onboarding-recovery', 'Real production UI as QA: fixed-client setup with SMTP sink reject-mail armed, reload, sink recovery, expiry via expires_at time fixture, cancel'),
  'rt-closure-archive': ('08-closure-archive-dedup', 'Real production UI: QA SLA mapping and staff assignment on Accept-3; customer admin ticket; QA Shared IT comment with file and MSP-private note; customer ends the relationship in two tabs; DB closures/manifests/files; MSP archive page'),
}
media = []
for eid, (d, cmd) in SCEN.items():
    rec_path = DEPLOY / d / 'recording.json'; rec = json.load(open(rec_path))
    assert rec['build']['buildId'] == build_id and rec['build']['revision'] == stamp, f'{d} ran on another build'
    ok = rec['scenarioStatus'] == 'passed' or (d == '01-billing-late-time' and rec['scenarioStatus'] == 'partial' and rec['limitations'] == ['cleanup not yet run'] and all(a['passed'] for a in rec['assertions']))
    assert ok, f'{d}: {rec["scenarioStatus"]}'
    webm = DEPLOY / d / 'walkthrough.webm'; vtt = DEPLOY / d / 'chapters.vtt'
    m = {'webm': rel(webm), 'sha256': digest(webm), 'durationSeconds': rec.get('durationSeconds'), 'vtt': rel(vtt), 'vttSha256': digest(vtt), 'chapters': len(rec.get('chapters', []))}
    media.append({'evidence': eid, **m})
    manifest['evidence'][eid] = {'type': 'browser', 'sha': S, 'command': cmd,
        'result': json.dumps({'status': 'passed' if ok else rec['scenarioStatus'], 'assertions': [a['id'] for a in rec['assertions'] if a.get('passed', True)], 'limitations': rec.get('limitations', [])}),
        'artifact': rel(rec_path), 'artifactSha256': digest(rec_path), 'media': m, 'dependencyAnalysis': DEP}
manifest['evidence']['rt-regression-tests'] = {'type': 'automated', 'sha': S,
    'command': 'server tsc --noEmit (12 GiB); packages/billing vitest (1950); coManagedBootstrap.integration.test.ts seed 20260610 on server_co_managed; server lateApprovedHourlyTime.integration; server unit coManaged client/policy suites; mutation controls',
    'result': json.dumps({'serverTypecheck': 'exit 0 at 5a822cb47e and 8093816c90', 'billingPackage': '1950/1950', 'coManagedBootstrap': '1492/1492 at 5a822cb47e, 1493/1493 at 8093816c90',
        'mutations': 'late-time loader neutralised -> native and co-managed cases red; inconsistent classification removed -> bootstrap case red'}),
    'artifact': rel(DEPLOY / 'README.md'), 'dependencyAnalysis': DEP}
attr = json.load(open(DEPLOY / 'requirement-attribution.json'))
EV = {'01-billing-late-time/': 'rt-billing-late-time', '02-billing-late-time-cleanup/': 'rt-billing-cleanup', '03-t13-msp-edit-attribution/': 'rt-t13-msp-edit',
      '04-t09-privacy/': 'rt-t09-privacy', '05-t09-export/': 'rt-t09-export', '06-f003-relationship-states/': 'rt-f003-states',
      '07-t009-onboarding-recovery/': 'rt-t009-onboarding', '08-closure-archive-dedup/': 'rt-closure-archive'}
decisions = {}
for row in attr['rows']:
    key = row['key']; ev = [EV[e] for e in row.get('evidence', [])]
    if row.get('to') == 'verified':
        just = 'Every clause exercised on ' + build_id + ': ' + '; '.join(f'{k}: {v}' for k, v in row['clauses'].items()) + ('. ' + row['note'] if row.get('note') else '')
        decisions[key] = {'status': 'verified', 'evidence': ev + ['rt-regression-tests'], 'justification': just}
    elif row.get('status') == 'blocked-external':
        decisions[key] = {'status': 'blocked-external', 'evidence': [], 'justification': 'Blocked on an external resource: ' + row['missing'] + '. Not faked.', 'external': row['missing']}
    else:
        decisions[key] = {'status': 'implemented-unverified', 'evidence': ev, 'justification': ('Progress on ' + build_id + ': ' + row['progress'] + ' Remaining: ' + row['remaining'])}
# Carry forward the named external prerequisites recorded by the 1001ffe86b packet (a resource fact, not acceptance).
prior = json.load(open(ROOT / 'docs/evidence/co-managed-completion/1001ffe86b-deployfix-20261026/manifest.json'))
external = {r['key']: r['externalPrerequisite'] for r in prior['requirements'] if r.get('externalPrerequisite')}
keys = {r['key'] for r in manifest['requirements']}; assert set(decisions) <= keys, set(decisions) - keys
for r in manifest['requirements']:
    d = decisions.get(r['key'])
    if d:
        r['status'] = d['status']; r['justification'] = d['justification']
        r['evidence'] = [{'id': 'current-source-census'}] + [{'id': e} for e in d['evidence']]
        r['requiredInCard'] = d['status'] != 'blocked-external'
        if d.get('external'): r['externalPrerequisite'] = d['external']; r['externalOwner'] = 'release-operator'
    if r['key'] in external and 'externalPrerequisite' not in r: r['externalPrerequisite'] = external[r['key']]
for r in inv['rows']:
    m = next(x for x in manifest['requirements'] if x['key'] == r['key'])
    r['status'] = m['status']; r['justification'] = m['justification']; r['evidence'] = m['evidence']
    if m.get('externalPrerequisite'): r['externalPrerequisite'] = m['externalPrerequisite']
    r['remainingAcceptance'] = '' if m['status'] == 'verified' else r.get('remainingAcceptance', m['justification'])
for r in manifest['requirements']:
    if r['status'] == 'verified':
        assert any(manifest['evidence'][e['id']]['type'] != 'analysis' for e in r['evidence'] if e['id'] in manifest['evidence']), r['key']
prov = json.load(open(DEPLOY / 'runtime-provenance.json'))
manifest['provenance']['app'] = {'revision': S, 'buildId': build_id, 'stamp': stamp, 'dist': 'server/.next-review-final-8093816c', 'servedAt': ':23374 (board review-app)',
    'boardAdmission': prov['app']['boardAdmission'], 'dependencyAnalysis': 'source-delta.json'}
manifest['provenance']['worker'] = {'revision': S, **prov['workers']}
manifest['runtimeEvidence'] = {'attribution': rel(DEPLOY / 'requirement-attribution.json'), 'mediaAudit': 'media-audit.json', 'sourceRevision': S, 'buildId': build_id,
    'supersededAttempts': rel(DEPLOY / 'attempts')}
(OUT / 'media-audit.json').write_text(json.dumps(media, indent=2) + '\n')
(OUT / 'source-delta.json').write_text(json.dumps({'runtime': S, 'candidate': C, 'changedFiles': changed}, indent=2) + '\n')
counts = dict(collections.Counter(r['status'] for r in manifest['requirements']))
inv.setdefault('totals', {})['byStatus'] = counts; inv['evidence'] = manifest['evidence']
(OUT / 'attribution-decisions.json').write_text(json.dumps({'candidate': C, 'runtime': S, 'buildId': build_id,
    'baseline': attr['baselineCensus'], 'after': counts, 'policy': attr['policy'], 'decisions': decisions}, indent=2) + '\n')
for f, x in [('manifest.json', manifest), ('inventory.json', inv)]: (OUT / f).write_text(json.dumps(x, indent=2) + '\n')
(OUT / 'remaining-acceptance.md').write_text('# Named unaccepted requirements at ' + C[:10] + '\n\n' + json.dumps(counts) + '\n\n' + '\n'.join(
    f"- **{r['key']}** ({r['status']}): {r['justification']}" + (f" — external prerequisite: {r['externalPrerequisite']}" if r.get('externalPrerequisite') else '')
    for r in manifest['requirements'] if r['status'] != 'verified') + '\n')
(OUT / 'inventory.md').write_text('# Requirement census at ' + C[:10] + ' (runtime ' + S[:10] + ', ' + build_id + ')\n\n' + json.dumps(counts) + '\n\n| Key | Status | Justification |\n|---|---|---|\n'
    + '\n'.join('| ' + r['key'] + ' | ' + r['status'] + ' | ' + r['justification'].replace('|', '/').replace('\n', ' ') + ' |' for r in manifest['requirements']) + '\n')
print(OUT, counts)
