import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedUpgradeBaseline, upgradeBrowserFiles } from '../lib/supported-upgrade-evidence.mjs';
import { teamsDevelopmentFiles, teamsDevelopmentJourneys } from '../lib/teams-development-evidence.mjs';
import { readinessRequirements, evaluateProductionReadiness } from '../lib/production-readiness.mjs';

// Formats emitted by candidate-execution, workspace-execution, test-sharding
// and node-workflow verifiers. Their raw-report reconciliation is tested in
// their own behavioral suites; this boundary consumes their serialized output.
function fixture() {
  const revision = 'a'.repeat(40);
  const jobs = Object.fromEntries(readinessRequirements.map(({ job }) => [job, { result: 'success' }]));
  jobs.selection = { result: 'success' };
  const artifacts = Object.fromEntries(readinessRequirements.map(requirement => {
    const member = id => ({ id, status: 'passed', failures: [],
      ...(id === 'browser-discovery' ? { executionVerified: false } : { counts: { passed: 2, failed: 0, skipped: 0, todo: 0, pending: 0 } }) });
    const verdict = { schemaVersion: 1, revision, status: 'passed', failures: [],
      ...(requirement.scope ? { scope: requirement.scope } : { suite: requirement.suite }),
      ...(requirement.members ? { results: requirement.members.map(member) } : { counts: member('single').counts }) };
    if (requirement.collectionOnly) Object.assign(verdict, { executionVerified: false,
      candidates: ['fixture.test.js'], unmatched: [], runners: [{ runner: 'fixture' }] });
    if (['workspace', 'temporal'].includes(requirement.job)) {
      verdict.suites = verdict.results.map(({ id, ...rest }) => ({ suite: id, ...rest }));
      delete verdict.results;
    }
    return [requirement.artifact, verdict];
  }));
  return { revision, changed: ['packages/billing/src/Invoice.ts'], jobs, artifacts };
}
const evaluate = input => evaluateProductionReadiness(JSON.parse(JSON.stringify(input)));

test('all required serialized workflow verdicts pass and preserve fourteen separate requirements', () => {
  const result = evaluate(fixture());
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  assert.equal(result.results.length, 14);
});

for (const outcome of ['failure', 'cancelled', 'skipped', undefined]) {
  test(`every workflow must finish successfully: ${outcome}`, () => {
    for (const job of Object.keys(fixture().jobs)) {
      const input = fixture(); input.jobs[job].result = outcome;
      assert.equal(evaluate(input).status, 'failed', job);
    }
  });
}

for (const damage of ['absent', 'stale', 'wrong-scope', 'malformed', 'empty', 'failed-member', 'partial-member', 'duplicate-member']) {
  test(`rejects ${damage} execution evidence independently of successful workflow outcomes`, () => {
    for (const requirement of readinessRequirements) {
      const input = fixture(), verdict = input.artifacts[requirement.artifact];
      const members = verdict.results ?? verdict.suites;
      if (damage === 'absent') delete input.artifacts[requirement.artifact];
      if (damage === 'stale') verdict.revision = 'b'.repeat(40);
      if (damage === 'wrong-scope') { verdict.scope = 'other'; verdict.suite = 'other'; }
      if (damage === 'malformed') verdict.failures = null;
      if (damage === 'empty') {
        if (requirement.collectionOnly) verdict.candidates = [];
        else if (members) members.splice(0); else verdict.counts.passed = 0;
      }
      if (damage === 'failed-member') {
        if (members) members[0].status = 'failed'; else verdict.status = 'failed';
      }
      if (damage === 'partial-member') {
        if (requirement.collectionOnly) verdict.unmatched = ['new.test.js'];
        else (members ? members[0] : verdict).counts.skipped = 1;
      }
      if (damage === 'duplicate-member') {
        if (requirement.collectionOnly) verdict.executionVerified = true;
        else if (members) members.push(structuredClone(members[0])); else verdict.counts.pending = 1;
      }
      assert.equal(evaluate(input).status, 'failed', requirement.artifact);
    }
  });
}

test('not-applicable requires independent documentation-only selection and an explicit reason', () => {
  for (const requirement of readinessRequirements) {
    const input = fixture(), verdict = input.artifacts[requirement.artifact];
    verdict.status = 'not-applicable'; verdict.reason = 'Documentation-only diff';
    assert.equal(evaluate(input).status, 'failed');
    input.changed = ['docs/testing.md'];
    assert.equal(evaluate(input).status, requirement.conditional ? 'passed' : 'failed');
    if (requirement.conditional) {
      delete verdict.reason;
      assert.equal(evaluate(input).status, 'failed');
      verdict.reason = 'Documentation-only diff'; input.changed = null;
      assert.equal(evaluate(input).status, 'failed');
    }
  }
});

test('collection cannot impersonate browser execution and missing edition is rejected', () => {
  const input = fixture();
  input.artifacts['node-workflow-gate'].results[2].executionVerified = true;
  assert.equal(evaluate(input).status, 'failed');
  const missing = fixture();
  missing.artifacts['fresh-install-execution-gate'].results.pop();
  assert.equal(evaluate(missing).status, 'failed');
});

test('expensive workflow omission requires both a successful selector and independently verified docs-only changes', () => {
  const input = fixture(); input.changed = ['docs/testing.md'];
  for (const job of ['temporal', 'citus']) input.jobs[job].result = 'skipped';
  delete input.artifacts['temporal-execution-gate']; delete input.artifacts['citus-aggregate'];
  assert.equal(evaluate(input).status, 'passed');
  input.jobs.selection.result = 'failure'; assert.equal(evaluate(input).status, 'failed');
  input.jobs.selection.result = 'success'; input.changed = null;
  assert.equal(evaluate(input).status, 'failed');
});

test('CLI reads candidate artifacts, fails on missing JSON, and rejects a dirty consumer checkout', async t => {
  const { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'production-readiness-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  cpSync(new URL('../lib', import.meta.url), path.join(root, 'scripts/lib'), { recursive: true });
  cpSync(new URL('../verify-production-readiness.mjs', import.meta.url), path.join(root, 'scripts/verify-production-readiness.mjs'));
  // This fixture exercises full enforcement; quarantine behavior is covered separately.
  write('scripts/lib/quarantine.json', { schemaVersion: 1, entries: [] });
  write('.gitignore', 'test-results/\n');
  for (const file of [...upgradeBrowserFiles, ...teamsDevelopmentFiles]) write(file, '// Runtime report fixture identity\n');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Readiness fixture', '-c', 'user.email=readiness@example.test', 'commit', '--no-gpg-sign', '-qm', 'Fixture']);
  const revision = git(['rev-parse', 'HEAD']);
  const input = fixture();
  const filenames = [];
  for (const requirement of readinessRequirements) {
    const name = requirement.artifact + (requirement.revisionSuffix ? `-${revision}` : '');
    const file = `test-results/readiness-input/${name}/aggregate.json`;
    write(file, { ...input.artifacts[requirement.artifact], revision });
    filenames.push(file);
  }
  const upgradeDirectory = 'test-results/readiness-input/supported-upgrade-execution';
  const cleanSource = { revision, dirty: false };
  const rawBrowser = { config: { rootDir: root, metadata: { sourceRevision: revision } }, errors: [],
    stats: { expected: 3, unexpected: 0, skipped: 0, flaky: 0 },
    suites: upgradeBrowserFiles.map(file => ({ specs: [{ file, title: file, tests: [{ projectId: 'ee', projectName: 'ee',
      expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] }] }] })) };
  write(`${upgradeDirectory}/schema.json`, { schemaVersion: 1, phase: 'schema-and-retention', status: 'passed',
    baseline: { commit: supportedUpgradeBaseline }, source: cleanSource, sourceAfter: cleanSource,
    database: 'upgrade_ci', migrations: { baseline: 1028, upgrade: ['new.cjs'], batch: 2 } });
  write(`${upgradeDirectory}/collected.json`, rawBrowser);
  write(`${upgradeDirectory}/results.json`, rawBrowser);
  write(`${upgradeDirectory}/runner.json`, { exitCode: 0, database: 'upgrade_ci', applicationRevision: revision });
  write(`${upgradeDirectory}/evidence.json`, { status: 'passed', revision, source: { before: cleanSource, after: cleanSource } });
  const citusDirectory = 'test-results/readiness-input/supported-citus-upgrade-execution';
  for (const name of ['schema', 'collected', 'results', 'runner', 'evidence']) {
    write(`${citusDirectory}/${name}.json`, JSON.parse(readFileSync(path.join(root, `${upgradeDirectory}/${name}.json`), 'utf8')));
  }
  const citusSchema = JSON.parse(readFileSync(path.join(root, `${citusDirectory}/schema.json`), 'utf8'));
  const distribution = ['tenants', 'users', 'clients', 'tickets', 'contracts'].map(table_name => ({ table_name, partmethod: 'h', distribution_column: 'tenant' }));
  distribution.push(...['usage_tracking', 'time_entries'].map(table_name => ({ table_name, partmethod: null, distribution_column: null })));
  citusSchema.backend = 'citus';
  citusSchema.distribution = { baseline: distribution, upgraded: structuredClone(distribution) };
  write(`${citusDirectory}/schema.json`, citusSchema);
  const teamsDirectory = 'test-results/readiness-input/teams-development-execution';
  const teamsReport = structuredClone(rawBrowser);
  teamsReport.stats.expected = 1;
  teamsReport.suites = [teamsReport.suites[0]];
  teamsReport.suites[0].specs[0].file = teamsDevelopmentFiles[0];
  teamsReport.suites[0].specs[0].title = teamsDevelopmentJourneys[0];
  Object.assign(teamsReport.suites[0].specs[0].tests[0], {
    projectId: 'enterprise-chromium', projectName: 'enterprise-chromium',
  });
  Object.assign(teamsReport.config.metadata, { releaseValidation: false, requiredServerNodeEnv: 'development', integrationSurface: 'teams' });
  for (const name of ['collected', 'results']) write(`${teamsDirectory}/${name}.json`, teamsReport);
  write(`${teamsDirectory}/runner.json`, { exitCode: 0 });
  const teamsEvidence = { status: 'passed', revision, releaseValidation: false, source: { before: cleanSource, after: cleanSource } };
  write(`${teamsDirectory}/evidence.json`, teamsEvidence);
  const callbackDirectory = 'test-results/readiness-input/microsoft-callback-execution';
  const callbackReport = { schemaVersion: 1, scope: 'microsoft-nextauth-callback-development',
    status: 'passed', stage: 'completed', releaseValidation: false,
    sourceRevision: revision, sourceRevisionOrigin: 'git', sourceRevisionAfter: revision,
    fixtureCleanup: 'removed', processCleanup: 'stopped',
    configuration: { edition: 'enterprise', serverLifecycle: 'next-development', provider: 'microsoft',
      authority: 'synthetic-loopback', applicationAuthentication: 'nextauth' },
    execution: { status: 'passed', accepted: { stateAccepted: true, nonceRequested: false },
      rejected: { stateAccepted: false, nonceRequested: false }, tokenRequests: 1, jwksRequests: 0 } };
  const callbackSource = { ...cleanSource, changes: [] };
  const callbackRunner = { exitCode: 0, source: { before: callbackSource, after: callbackSource } };
  write(`${callbackDirectory}/microsoft-callback-report.json`, callbackReport);
  write(`${callbackDirectory}/microsoft-callback-runner.json`, callbackRunner);
  write(`${callbackDirectory}/microsoft-callback-evidence.json`, { status: 'passed' });
  const run = () => {
    const child = spawnSync(process.execPath, ['scripts/verify-production-readiness.mjs'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GITHUB_SHA: revision, TIER1_BASE_SHA: '', READINESS_JOBS: JSON.stringify(input.jobs) },
    });
    const output = JSON.parse(readFileSync(path.join(root, 'test-results/production-readiness/aggregate.json'), 'utf8'));
    assert.equal(child.status, output.status === 'passed' ? 0 : 1, child.stderr);
    return output;
  };
  { const result = run(); assert.equal(result.status, 'passed', result.failures.join('\n')); }
  const containerReport = { ...callbackReport, sourceRevisionOrigin: 'environment', sourceRevisionAfter: null };
  const containerRunner = { ...callbackRunner, runtimeBinding: { imageRevision: revision,
    imageId: `sha256:${'1'.repeat(64)}`, containerImageId: `sha256:${'1'.repeat(64)}`,
    mountedSourceRevision: revision, mountsReadOnly: true } };
  write(`${callbackDirectory}/microsoft-callback-report.json`, containerReport);
  write(`${callbackDirectory}/microsoft-callback-runner.json`, containerRunner);
  assert.equal(run().status, 'passed');
  for (const corrupt of [
    ({ report }) => { report.execution.rejected.stateAccepted = true; },
    ({ report }) => { report.execution.tokenRequests = 2; },
    ({ report }) => { report.fixtureCleanup = 'retained'; },
    ({ report }) => { report.configuration.serverLifecycle = 'next-production'; },
    ({ report }) => { report.sourceRevision = 'b'.repeat(40); },
    ({ runner }) => { runner.exitCode = 1; },
    ({ runner }) => { delete runner.exitCode; },
    ({ runner }) => { runner.source.after.dirty = true; },
    ({ runner }) => { runner.runtimeBinding.mountsReadOnly = false; },
    ({ runner }) => { runner.runtimeBinding.containerImageId = `sha256:${'2'.repeat(64)}`; },
    ({ runner }) => { delete runner.runtimeBinding; },
  ]) {
    const inputs = structuredClone({ report: containerReport, runner: containerRunner });
    corrupt(inputs);
    write(`${callbackDirectory}/microsoft-callback-report.json`, inputs.report);
    write(`${callbackDirectory}/microsoft-callback-runner.json`, inputs.runner);
    const result = run();
    assert.equal(result.results.find(({ id }) => id === 'microsoft-callback-execution').status, 'failed');
  }
  write(`${callbackDirectory}/microsoft-callback-report.json`, callbackReport);
  write(`${callbackDirectory}/microsoft-callback-runner.json`, callbackRunner);
  // Missing raw inputs cannot be replaced by the still-green recorded evidence.
  rmSync(path.join(root, `${callbackDirectory}/microsoft-callback-report.json`));
  assert.equal(run().status, 'failed');
  write(`${callbackDirectory}/microsoft-callback-report.json`, callbackReport);
  assert.equal(run().status, 'passed');
  const unrelatedTeams = structuredClone(teamsReport);
  unrelatedTeams.suites[0].specs[0].title = 'unrelated passing callback';
  for (const name of ['collected', 'results']) write(`${teamsDirectory}/${name}.json`, unrelatedTeams);
  assert.equal(run().status, 'failed');
  for (const name of ['collected', 'results']) write(`${teamsDirectory}/${name}.json`, teamsReport);
  write(`${teamsDirectory}/evidence.json`, { ...teamsEvidence, releaseValidation: true });
  assert.equal(run().status, 'failed');
  write(`${teamsDirectory}/evidence.json`, teamsEvidence);
  write(`${teamsDirectory}/results.json`, { ...teamsReport, suites: [] });
  assert.equal(run().status, 'failed');
  write(`${teamsDirectory}/results.json`, teamsReport);
  write(`${citusDirectory}/schema.json`, { ...citusSchema, backend: 'postgres' });
  assert.equal(run().status, 'failed');
  write(`${citusDirectory}/schema.json`, citusSchema);
  // A green recorded verdict cannot conceal a missing raw upgrade journey.
  const partial = structuredClone(rawBrowser); partial.suites.pop();
  write(`${upgradeDirectory}/results.json`, partial);
  assert.equal(run().status, 'failed');
  write(`${upgradeDirectory}/results.json`, rawBrowser);
  { const result = run(); assert.equal(result.status, 'passed', result.failures.join('\n')); }
  const original = readFileSync(path.join(root, filenames[0]), 'utf8');
  rmSync(path.join(root, filenames[0])); assert.equal(run().status, 'failed');
  write(filenames[0], '{truncated'); assert.equal(run().status, 'failed');
  write(filenames[0], original); assert.equal(run().status, 'passed');
  write('uncommitted.md', 'Uncommitted consumer change');
  assert.match(run().failures.join('\n'), /dirty/);
});

// F009: a quarantine keeps a mandatory outcome visible without vetoing
// readiness. Each way it could instead become a silent hole must fail loudly.
const QUARANTINABLE = 'teams-development-execution';
const entry = (overrides = {}) => ({ schemaVersion: 1, entries: [{ artifact: QUARANTINABLE,
  owner: 'integration-owners', reason: 'Tracked development-server limitation', expires: '2026-10-21', ...overrides }] });
const withQuarantine = (input, quarantine, now = '2026-09-09') => evaluate({ ...input, quarantine, now });
const resultFor = (result, id) => result.results.find(candidate => candidate.id === id);

test('a valid quarantine reports a failing requirement without failing readiness', () => {
  const input = fixture();
  input.artifacts[QUARANTINABLE].status = 'failed';
  input.artifacts[QUARANTINABLE].failures = ['ChunkLoadError: Loading chunk app/msp/layout failed'];
  assert.equal(evaluate(input).status, 'failed', 'unquarantined failure must still veto readiness');
  const result = withQuarantine(input, entry());
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  const reported = resultFor(result, QUARANTINABLE);
  assert.equal(reported.status, 'quarantined-failing');
  assert.equal(reported.quarantine.owner, 'integration-owners');
  assert.ok(reported.failures.length, 'the underlying problems stay visible');
});

test('a quarantined requirement that passes is reported as ready to un-quarantine', () => {
  const result = withQuarantine(fixture(), entry());
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  assert.equal(resultFor(result, QUARANTINABLE).status, 'quarantined-passing');
});

test('an expired quarantine fails readiness instead of silently continuing', () => {
  const input = fixture();
  input.artifacts[QUARANTINABLE].status = 'failed';
  for (const now of ['2026-10-21', '2026-10-22']) {
    const result = withQuarantine(input, entry(), now);
    assert.equal(result.status, 'failed', `expiry must not survive ${now}`);
    assert.match(result.failures.join('\n'), /Quarantine expired/);
  }
});

for (const [label, overrides] of [['owner', { owner: '  ' }], ['reason', { reason: '' }],
  ['expiry', { expires: 'soon' }], ['impossible expiry', { expires: '2026-02-30' }]]) {
  test(`a quarantine entry missing a valid ${label} fails readiness`, () => {
    const input = fixture();
    input.artifacts[QUARANTINABLE].status = 'failed';
    const result = withQuarantine(input, entry(overrides));
    assert.equal(result.status, 'failed');
    assert.equal(resultFor(result, QUARANTINABLE).status, 'failed', 'the requirement stays mandatory');
  });
}

test('a P0 customer journey can never be quarantined', () => {
  const p0 = readinessRequirements.filter(requirement => requirement.p0Journey);
  assert.ok(p0.length, 'the P0 journey floor must be marked');
  for (const requirement of p0) {
    const input = fixture();
    input.artifacts[requirement.artifact].status = 'failed';
    const result = withQuarantine(input, entry({ artifact: requirement.artifact }));
    assert.equal(result.status, 'failed', requirement.artifact);
    assert.match(result.failures.join('\n'), /P0 journey cannot be quarantined/);
  }
});

test('stale, duplicate and unsupported quarantine registries fail readiness', () => {
  const input = fixture();
  assert.match(withQuarantine(input, entry({ artifact: 'retired-suite' })).failures.join('\n'), /unknown requirement/);
  const duplicated = entry(); duplicated.entries.push({ ...duplicated.entries[0] });
  assert.match(withQuarantine(input, duplicated).failures.join('\n'), /Duplicate quarantine entry/);
  for (const registry of [{ schemaVersion: 2, entries: [] }, { schemaVersion: 1 }, { entries: [] }]) {
    assert.equal(withQuarantine(input, registry).status, 'failed', JSON.stringify(registry));
  }
  // An absent registry means nothing is quarantined, not that everything is.
  const unquarantined = evaluate({ ...input, now: '2026-09-09' });
  assert.equal(resultFor(unquarantined, QUARANTINABLE).status, 'passed');
});

test('the committed quarantine registry is valid and every entry is still in date', async () => {
  const { readFileSync } = await import('node:fs');
  const registry = JSON.parse(readFileSync(new URL('../lib/quarantine.json', import.meta.url), 'utf8'));
  const { resolveQuarantine } = await import('../lib/quarantine.mjs');
  const resolved = resolveQuarantine({ registry, requirements: readinessRequirements,
    now: new Date().toISOString().slice(0, 10) });
  assert.deepEqual(resolved.failures, [], 'committed quarantine entries must be owned, justified and unexpired');
});
