import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

test('actual workspace runner rejects omitted files, skipped assertions, failures and empty collection', { timeout: 60000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-workspace-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/lib', 'server', 'sdk']) mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of [
    'scripts/run-additional-workspace-tests.mjs',
    'scripts/lib/test-discovery.mjs', 'scripts/lib/test-execution-evidence.mjs',
    'scripts/lib/test-revision.mjs', 'scripts/lib/vitest-progress-reporter.mjs',
  ]) cpSync(path.join(repository, file), path.join(root, file));
  symlinkSync(path.join(repository, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest-results/\n');
  const configure = (include) => writeFileSync(path.join(root, 'server/vitest.workspace-unit.config.ts'),
    `export default ${JSON.stringify({ test: { include, globals: true, environment: 'node', pool: 'forks', fileParallelism: false, maxWorkers: 1 } })};`);
  configure(['../sdk/**/*.test.ts']);
  const example = path.join(root, 'sdk/example.test.ts');
  writeFileSync(example, "test('saves the result', () => expect(2 + 2).toBe(4));\n");
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init');
  git('add', '.');
  git('-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Create isolated runner fixture');
  const run = () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-additional-workspace-tests.mjs'), 'workspace-unit'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, CI: '1' },
    });
    assert.equal(result.error, undefined, result.error?.message);
    const evidence = JSON.parse(readFileSync(path.join(root, 'test-results/workspace-unit/evidence.json'), 'utf8'));
    return { result, evidence };
  };
  let current = run();
  assert.equal(current.result.status, 0, current.result.stderr);
  assert.equal(current.evidence.status, 'passed');
  assert.equal(current.evidence.counts.passed, 1);
  assert.equal(current.evidence.expectedTests.length, 1);

  // A runner that still passes its selected file cannot hide a newly added test.
  configure(['../sdk/example.test.ts']);
  const omitted = path.join(root, 'sdk/omitted.test.ts');
  writeFileSync(omitted, "test('new behavior', () => expect(true).toBe(true));\n");
  current = run();
  assert.equal(current.result.status, 1);
  assert.ok(current.evidence.failures.some((message) => message.includes('No runner collects test: sdk/omitted.test.ts')));
  rmSync(omitted);

  writeFileSync(example, "test.skip('saves the result', () => expect(2 + 2).toBe(4));\n");
  current = run();
  assert.equal(current.result.status, 1);
  assert.equal(current.evidence.counts.skipped + current.evidence.counts.pending, 1);
  assert.equal(current.evidence.status, 'failed');

  writeFileSync(example, "test('saves the result', () => expect(2 + 2).toBe(5));\n");
  current = run();
  assert.equal(current.result.status, 1);
  assert.equal(current.evidence.counts.failed, 1);

  configure(['../sdk/missing.test.ts']);
  current = run();
  assert.equal(current.result.status, 1);
  assert.equal(current.evidence.status, 'failed');
  assert.ok(current.evidence.failures.some((message) => message.includes('collected no files')));
});
