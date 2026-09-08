import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedUpgradeBaseline, upgradeBrowserFiles } from '../lib/supported-upgrade-evidence.mjs';
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
    if (['workspace', 'temporal'].includes(requirement.job)) {
      verdict.suites = verdict.results.map(({ id, ...rest }) => ({ suite: id, ...rest }));
      delete verdict.results;
    }
    return [requirement.artifact, verdict];
  }));
  return { revision, changed: ['packages/billing/src/Invoice.ts'], jobs, artifacts };
}
const evaluate = input => evaluateProductionReadiness(JSON.parse(JSON.stringify(input)));

test('all required serialized workflow verdicts pass and preserve ten separate requirements', () => {
  const result = evaluate(fixture());
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  assert.equal(result.results.length, 10);
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
        if (members) members.splice(0); else verdict.counts.passed = 0;
      }
      if (damage === 'failed-member') {
        if (members) members[0].status = 'failed'; else verdict.status = 'failed';
      }
      if (damage === 'partial-member') {
        (members ? members[0] : verdict).counts.skipped = 1;
      }
      if (damage === 'duplicate-member') {
        if (members) members.push(structuredClone(members[0])); else verdict.counts.pending = 1;
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
  write('.gitignore', 'test-results/\n');
  for (const file of upgradeBrowserFiles) write(file, '// Runtime report fixture identity\n');
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
