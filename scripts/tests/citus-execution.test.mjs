import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Citus CLI independently requires both complete suites and replaces stale green artifacts', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'citus-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  cpSync(new URL('../lib', import.meta.url), path.join(root, 'scripts/lib'), { recursive: true });
  cpSync(new URL('../verify-citus-execution.mjs', import.meta.url), path.join(root, 'scripts/verify-citus-execution.mjs'));
  const files = {
    'citus-runtime': [
      'ee/temporal-workflows/src/__tests__/integration/workflowInvocationPersistence.integration.test.ts',
      'server/src/test/integration/invoiceTicketImmutable.integration.test.ts',
    ],
    'temporal-database': [
      'ee/temporal-workflows/src/__tests__/e2e/tenant-creation-workflow.e2e.test.ts',
      'ee/temporal-workflows/src/db/__tests__/database-connection.integration.test.ts',
      'ee/temporal-workflows/src/activities/__tests__/user-activities-simple.test.ts',
      'ee/temporal-workflows/src/activities/__tests__/tenant-activities.test.ts',
      'ee/temporal-workflows/src/db/__tests__/product-upgrade-operations.integration.test.ts',
      'ee/temporal-workflows/src/db/__tests__/tenant-setup-idempotency.integration.test.ts',
    ],
  };
  write('.gitignore', 'test-results/\n');
  for (const file of Object.values(files).flat()) write(file, '// Gate fixture candidate\n');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Gate fixture', '-c', 'user.email=gate@example.test', 'commit', '--no-gpg-sign', '-qm', 'Fixture']);
  const revision = git(['rev-parse', 'HEAD']);
  const source = { revision, dirty: false, changes: [] };
  const evidence = { schemaVersion: 1, status: 'passed', selection: { mode: 'full', filters: [] }, source: { before: source, after: source } };
  const report = candidates => ({ success: true, numTotalTests: candidates.length,
    testResults: candidates.map(name => ({ name, status: 'passed', assertionResults: [{ title: 'persists', status: 'passed' }] })) });
  const seed = (lane, candidates = files[lane]) => {
    const directory = `test-results/citus-input/${lane}`;
    write(`${directory}/evidence.json`, evidence);
    write(`${directory}/collected.json`, candidates);
    write(`${directory}/collected-tests.json`, candidates.map(file => ({ file, name: 'persists' })));
    write(`${directory}/results.json`, report(candidates));
  };
  Object.keys(files).forEach(lane => seed(lane));
  const run = (env = {}) => {
    const child = spawnSync(process.execPath, ['scripts/verify-citus-execution.mjs'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GITHUB_SHA: revision, CITUS_JOB_RESULT: 'success', ...env },
    });
    const result = JSON.parse(readFileSync(path.join(root, 'test-results/citus-gate/aggregate.json'), 'utf8'));
    assert.equal(child.status, result.status === 'passed' ? 0 : 1, child.stderr);
    return result;
  };
  assert.equal(run().status, 'passed');
  for (const CITUS_JOB_RESULT of ['failure', 'cancelled', 'skipped', '']) assert.equal(run({ CITUS_JOB_RESULT }).status, 'failed');
  for (const lane of Object.keys(files)) {
    seed(lane, files[lane].slice(1));
    const missing = run();
    assert.equal(missing.status, 'failed');
    assert.ok(missing.failures.some(message => message.includes(`Uncollected candidate: ${files[lane][0]}`)));
    seed(lane);
    const directory = `test-results/citus-input/${lane}`;
    const skipped = report(files[lane]);
    skipped.testResults[0].assertionResults[0].status = 'pending';
    write(`${directory}/results.json`, skipped);
    assert.equal(run().status, 'failed');
    seed(lane);
    write(`${directory}/evidence.json`, { ...evidence, selection: { mode: 'filtered', filters: [] } });
    assert.equal(run().status, 'failed');
    seed(lane);
    assert.equal(run().status, 'passed');
    write(`${directory}/results.json`, '{broken');
    assert.equal(run().status, 'failed');
    rmSync(path.join(root, directory, 'results.json'));
    assert.equal(run().status, 'failed');
    seed(lane);
  }
  assert.equal(run({ GITHUB_SHA: 'b'.repeat(40) }).status, 'failed');
  write('uncommitted.md', 'dirty checkout');
  assert.equal(run().status, 'failed');
  rmSync(path.join(root, 'uncommitted.md'));
  assert.equal(run().status, 'passed');
});
