import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('unit aggregate CLI rejects incomplete runtime artifacts independently of producer success', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'unit-aggregate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof data === 'string' ? data : JSON.stringify(data));
  };
  cpSync(new URL('../lib', import.meta.url), path.join(root, 'scripts/lib'), { recursive: true });
  cpSync(new URL('../verify-server-unit-aggregate.mjs', import.meta.url), path.join(root, 'scripts/verify-server-unit-aggregate.mjs'));
  const files = ['server/src/test/unit/example.test.ts', 'packages/billing/example.test.ts',
    'shared/example.spec.ts', 'ee/packages/workflows/src/actions/example.test.ts'];
  for (const file of [...files, 'packages/billing/persistence.db.test.ts', 'server/src/test/integration/example.test.ts']) write(file, '// Fixture candidate\n');
  write('.gitignore', 'test-results/\n');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => {
    git(['add', '.']);
    git(['-c', 'user.name=Gate fixture', '-c', 'user.email=gate@example.test', 'commit', '--no-gpg-sign', '-qm', 'Fixture']);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q']); let revision = commit();
  const input = 'test-results/server-unit-input';
  const directory = `${input}/test-results/server-coverage`;
  const reportPath = `${input}/server/test-results.json`;
  const seed = (selected = files) => {
    const source = { revision, dirty: false, changes: [] };
    write(`${directory}/evidence.json`, { schemaVersion: 1, status: 'passed', selection: { mode: 'full', filters: [] }, source: { before: source, after: source } });
    write(`${directory}/collected.json`, selected);
    write(`${directory}/collected-tests.json`, selected.map(file => ({ file, name: 'behaves correctly' })));
    write(reportPath, { success: true, numTotalTests: selected.length, testResults: selected.map(name => ({ name, status: 'passed', assertionResults: [{ title: 'behaves correctly', status: 'passed' }] })) });
  };
  const run = (env = {}) => {
    const child = spawnSync(process.execPath, ['scripts/verify-server-unit-aggregate.mjs'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GITHUB_SHA: revision, SERVER_UNIT_JOB_RESULT: 'success', ...env },
    });
    const result = JSON.parse(readFileSync(path.join(root, 'test-results/server-unit-gate/aggregate.json'), 'utf8'));
    assert.equal(child.status, result.status === 'passed' ? 0 : 1, child.stderr);
    return result;
  };
  seed(); assert.equal(run().status, 'passed');
  for (const SERVER_UNIT_JOB_RESULT of ['failure', 'cancelled', 'skipped', '']) assert.equal(run({ SERVER_UNIT_JOB_RESULT }).status, 'failed');
  for (const file of files) {
    seed(files.filter(candidate => candidate !== file));
    assert.ok(run().failures.some(message => message.includes(`Uncollected candidate: ${file}`)));
  }
  seed();
  const report = JSON.parse(readFileSync(path.join(root, reportPath), 'utf8'));
  for (const status of ['pending', 'todo', 'failed', 'skipped']) {
    report.testResults[0].assertionResults[0].status = status;
    write(reportPath, report); assert.equal(run().status, 'failed');
  }
  seed(); assert.equal(run().status, 'passed');
  write(reportPath, '{broken'); assert.equal(run().status, 'failed');
  rmSync(path.join(root, reportPath)); assert.equal(run().status, 'failed');
  seed();
  assert.equal(run({ GITHUB_SHA: 'b'.repeat(40) }).status, 'failed');
  write('dirty.md', 'uncommitted'); assert.equal(run().status, 'failed');
  rmSync(path.join(root, 'dirty.md'));
  write('shared/new.test.ts', '// Newly required candidate\n'); revision = commit();
  // Even newly generated green reports cannot conceal the newly tracked file.
  seed(); assert.ok(run().failures.some(message => message.includes('Uncollected candidate: shared/new.test.ts')));
  seed([...files, 'shared/new.test.ts']); assert.equal(run().status, 'passed');
});
