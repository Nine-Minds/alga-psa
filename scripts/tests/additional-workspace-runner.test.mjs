import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

for (const [suite, directory, include] of [
  ['workspace-unit', 'sdk', '../sdk'],
  ['server-colocated', 'server/src/lib', 'src/lib'],
  ['enterprise-unit', 'ee/server/src/__tests__/unit', 'src/__tests__/unit'],
]) test(`${suite} runner rejects omitted files, skipped assertions, failures and empty collection`, { timeout: 60000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-workspace-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['scripts/lib', 'server', directory]) mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of [
    'scripts/run-additional-workspace-tests.mjs',
    'scripts/lib/test-discovery.mjs', 'scripts/lib/test-execution-evidence.mjs',
    'scripts/lib/test-revision.mjs', 'scripts/lib/vitest-progress-reporter.mjs', 'scripts/lib/test-sharding.mjs',
  ]) cpSync(path.join(repository, file), path.join(root, file));
  symlinkSync(path.join(repository, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest-results/\n');
  const configure = (include) => writeFileSync(path.join(root, suite === 'enterprise-unit' ? 'ee/server/vitest.unit.config.ts' : `server/vitest.${suite}.config.ts`),
    `export default ${JSON.stringify({ test: { include, globals: true, environment: 'node', pool: 'forks', fileParallelism: false, maxWorkers: 1 } })};`);
  configure([`${include}/**/*.test.ts`]);
  const example = path.join(root, directory, 'example.test.ts');
  writeFileSync(example, "test('saves the result', () => expect(2 + 2).toBe(4));\n");
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init');
  git('add', '.');
  git('-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Create isolated runner fixture');
  const run = () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-additional-workspace-tests.mjs'), suite], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, CI: '1' },
    });
    assert.equal(result.error, undefined, result.error?.message);
    const evidence = JSON.parse(readFileSync(path.join(root, `test-results/${suite}/evidence.json`), 'utf8'));
    return { result, evidence };
  };
  let current = run();
  assert.equal(current.result.status, 0, current.result.stderr);
  assert.equal(current.evidence.status, 'passed');
  assert.equal(current.evidence.counts.passed, 1);
  assert.equal(current.evidence.expectedTests.length, 1);

  // A runner that still passes its selected file cannot hide a newly added test.
  configure([`${include}/example.test.ts`]);
  const omitted = path.join(root, directory, 'omitted.test.ts');
  writeFileSync(omitted, "test('new behavior', () => expect(true).toBe(true));\n");
  current = run();
  assert.equal(current.result.status, 1);
  assert.ok(current.evidence.failures.some((message) => message.includes(`No runner collects test: ${directory}/omitted.test.ts`)));
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

  configure([`${include}/missing.test.ts`]);
  current = run();
  assert.equal(current.result.status, 1);
  assert.equal(current.evidence.status, 'failed');
  assert.ok(current.evidence.failures.some((message) => message.includes('collected no files')));
});


test('enterprise aggregate requires all current shards and matching raw assertion evidence', { timeout: 60000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-enterprise-shards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts/lib', 'server', 'ee/server/src/__tests__/unit']) mkdirSync(path.join(root, directory), { recursive: true });
  for (const file of ['scripts/run-additional-workspace-tests.mjs', 'scripts/verify-enterprise-unit-shards.mjs',
    'scripts/lib/test-discovery.mjs', 'scripts/lib/test-execution-evidence.mjs', 'scripts/lib/test-revision.mjs',
    'scripts/lib/test-sharding.mjs', 'scripts/lib/vitest-progress-reporter.mjs']) {
    cpSync(path.join(repository, file), path.join(root, file));
  }
  symlinkSync(path.join(repository, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest-results/\n');
  writeFileSync(path.join(root, 'ee/server/vitest.unit.config.ts'), `export default ${JSON.stringify({
    test: { include: ['src/__tests__/unit/**/*.test.ts'], globals: true, environment: 'node',
      pool: 'forks', fileParallelism: false, maxWorkers: 1 },
  })};`);
  for (const [index, behavior] of ['creates', 'updates', 'deletes'].entries()) {
    writeFileSync(path.join(root, `ee/server/src/__tests__/unit/${behavior}.test.ts`),
      `test('${behavior} an item', () => expect(${index} + 1).toBe(${index + 1}));\n`);
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init'); git('add', '.');
  git('-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Create isolated shard fixture');
  for (let index = 1; index <= 3; index++) {
    const result = spawnSync(process.execPath, ['scripts/run-additional-workspace-tests.mjs', 'enterprise-unit'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, CI: '1', WORKSPACE_SHARD_INDEX: String(index), WORKSPACE_SHARD_TOTAL: '3' },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  }
  const reports = path.join(root, 'test-results/enterprise-unit');
  const backup = path.join(root, 'test-results/shard-backup');
  cpSync(reports, backup, { recursive: true });
  const restore = () => { rmSync(reports, { recursive: true }); cpSync(backup, reports, { recursive: true }); };
  const change = (index, file, mutate) => {
    const target = path.join(reports, `shard-${index}/${file}.json`);
    const data = JSON.parse(readFileSync(target, 'utf8'));
    mutate(data);
    writeFileSync(target, JSON.stringify(data));
  };
  const verify = (expected, jobResult = 'success') => {
    const result = spawnSync(process.execPath, ['scripts/verify-enterprise-unit-shards.mjs', reports], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, WORKSPACE_SHARD_TOTAL: '3', WORKSPACE_JOB_RESULT: jobResult },
    });
    assert.equal(result.status, expected, result.stderr || result.error?.message);
    return JSON.parse(readFileSync(path.join(reports, 'aggregate.json'), 'utf8'));
  };
  let aggregate = verify(0);
  assert.equal(aggregate.counts.passed, 3);
  assert.equal(aggregate.executedFiles.length, 3);
  for (const jobResult of ['failure', 'cancelled', 'skipped', 'missing']) verify(1, jobResult);

  rmSync(path.join(reports, 'shard-3'), { recursive: true });
  assert.ok(verify(1).failures.some(message => message.includes('Missing shard 3')));
  restore();
  change(3, 'evidence', data => { data.selection.shard.index = 2; });
  assert.ok(verify(1).failures.some(message => message.includes('Duplicate shard 2')));
  restore();
  change(2, 'evidence', data => { data.revision = 'stale-revision'; });
  assert.ok(verify(1).failures.some(message => message.includes('different suite, revision or selection')));
  restore();
  change(1, 'results', data => { data.testResults[0].assertionResults[0].status = 'pending'; });
  assert.ok(verify(1).failures.some(message => message.includes('pending:')));
  restore();
  change(1, 'evidence', data => { data.counts.passed = 100; });
  assert.ok(verify(1).failures.some(message => message.includes('count disagrees')));
  restore();
  // Even internally consistent passing raw reports cannot impersonate another partition.
  for (const file of ['collected', 'collected-tests', 'results']) {
    cpSync(path.join(reports, `shard-2/${file}.json`), path.join(reports, `shard-1/${file}.json`));
  }
  assert.ok(verify(1).failures.some(message => message.includes('disagrees with its raw report')));
  restore();
  verify(0);
});
