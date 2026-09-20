import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

// Drives the real shard runner, merge script, `vitest --merge-reports` and both
// verifiers over an isolated fixture repository, the same sequence the
// server-unit and server-unit-complete CI jobs execute.
test('server unit shards partition, reunite and verify as one full-selection bundle', { timeout: 180000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-server-unit-shards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['scripts/lib', 'server/src/test/unit']) mkdirSync(path.join(root, directory), { recursive: true });
  for (const file of [
    'scripts/run-server-unit-shard.mjs', 'scripts/merge-server-unit-shards.mjs',
    'scripts/verify-server-unit-execution.mjs', 'scripts/verify-server-unit-aggregate.mjs',
    'scripts/lib/test-execution-evidence.mjs', 'scripts/lib/test-sharding.mjs', 'scripts/lib/test-revision.mjs',
    'scripts/lib/vitest-progress-reporter.mjs', 'scripts/lib/test-discovery.mjs',
    'scripts/lib/candidate-execution-artifacts.mjs', 'scripts/lib/candidate-execution-gate.mjs',
    'scripts/lib/node-test-execution.mjs', 'scripts/lib/playwright-execution-evidence.mjs',
    'server/vitest.server-unit-shard.config.ts',
  ]) cpSync(path.join(repository, file), path.join(root, file));
  symlinkSync(path.join(repository, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest-results/\ncoverage/\nserver/test-results.json\n');
  writeFileSync(path.join(root, 'server/vitest.config.ts'), `export default ${JSON.stringify({ test: {
    include: ['src/test/unit/**/*.test.ts'], globals: true, environment: 'node', pool: 'forks',
    fileParallelism: false, maxWorkers: 1, isolate: true, poolOptions: { forks: { singleFork: true } },
    coverage: { provider: 'v8', enabled: false, reporter: ['text-summary'], include: ['src/**/*.ts'] },
  } })};`);
  writeFileSync(path.join(root, 'server/src/lib.ts'), 'export const double = (value: number) => value * 2;\n');
  for (const [index, behavior] of ['creates', 'updates', 'deletes'].entries()) {
    writeFileSync(path.join(root, `server/src/test/unit/${behavior}.test.ts`),
      `import { double } from '../../lib';\ntest('${behavior} an item', () => expect(double(${index})).toBe(${index * 2}));\n`);
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init'); git('add', '.');
  git('-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Create isolated shard fixture');
  const revision = git('rev-parse', 'HEAD');
  const env = { ...process.env, CI: '1', GITHUB_SHA: revision, SKIP_DB_TESTS: '1', DB_USER_ADMIN: '', DB_PASSWORD_ADMIN: '',
    SERVER_UNIT_SHARD_TOTAL: '2', SERVER_UNIT_WORKERS: '2' };
  const node = (args, extra = {}, timeout = 60000) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout, env: { ...env, ...extra } });
  const shards = path.join(root, 'test-results/server-unit-shards');
  const readJson = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

  for (const index of [1, 2]) {
    const result = node(['scripts/run-server-unit-shard.mjs'], { SERVER_UNIT_SHARD_INDEX: String(index) });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const evidence = readJson('test-results/server-coverage/evidence.json');
    assert.equal(evidence.status, 'passed');
    assert.deepEqual(evidence.selection.shard, { index, total: 2 });
    assert.equal(evidence.selection.allFiles.length, 3);
    assert.equal(evidence.expectedFiles.length, index === 1 ? 2 : 1);
    assert.ok(existsSync(path.join(root, 'test-results/server-coverage/blob.json')));
    cpSync(path.join(root, 'test-results/server-coverage'), path.join(shards, `server-unit-shard-${index}`), { recursive: true });
  }
  // A dirty checkout must be refused before any file is collected.
  writeFileSync(path.join(root, 'stray.txt'), 'stray');
  const dirty = node(['scripts/run-server-unit-shard.mjs'], { SERVER_UNIT_SHARD_INDEX: '1' });
  assert.equal(dirty.status, 1);
  assert.ok(readJson('test-results/server-coverage/evidence.json').failures.some(message => message.includes('dirty before collection')));
  rmSync(path.join(root, 'stray.txt'));

  const merge = (extra = {}) => node(['scripts/merge-server-unit-shards.mjs'], { SERVER_UNIT_JOB_RESULT: 'success', ...extra });
  let merged = merge();
  assert.equal(merged.status, 0, merged.stdout + merged.stderr);
  const aggregate = readJson('test-results/server-coverage/shard-aggregate.json');
  assert.equal(aggregate.status, 'passed');
  assert.equal(aggregate.counts.passed, 3);
  assert.deepEqual(readdirSync(path.join(root, 'test-results/server-unit-blobs')).sort(), ['blob-1.json', 'blob-2.json']);
  assert.equal(readJson('test-results/server-coverage/collected.json').length, 3);
  assert.equal(readJson('test-results/server-coverage/collected-tests.json').length, 3);
  assert.equal(readJson('test-results/server-coverage/source-before.json').revision, revision);

  const vitest = path.join(root, 'server/node_modules/vitest/vitest.mjs');
  const replay = spawnSync(process.execPath, [vitest, 'run', '--merge-reports', '../test-results/server-unit-blobs',
    '--coverage.enabled=true', '--coverage.reporter=json-summary', '--reporter=json', '--outputFile.json=./test-results.json'],
  { cwd: path.join(root, 'server'), encoding: 'utf8', timeout: 60000, env });
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  const report = readJson('server/test-results.json');
  assert.equal(report.numTotalTests, 3);
  assert.equal(readJson('server/coverage/coverage-summary.json').total.lines.covered > 0, true);

  const verified = node(['scripts/verify-server-unit-execution.mjs'], { SERVER_UNIT_RUN_OUTCOME: 'success' });
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const evidence = readJson('test-results/server-coverage/evidence.json');
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.counts.passed, 3);
  assert.deepEqual(evidence.selection, { mode: 'full', filters: [] });

  const gate = node(['scripts/verify-server-unit-aggregate.mjs'], { SERVER_UNIT_JOB_RESULT: 'success', SERVER_UNIT_INPUT_DIR: '.' });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.equal(readJson('test-results/server-unit-gate/aggregate.json').status, 'passed');

  // The reunion refuses missing, duplicated, failed and tampered partitions.
  const backup = path.join(root, 'test-results/shard-backup');
  cpSync(shards, backup, { recursive: true });
  const restore = () => { rmSync(shards, { recursive: true }); cpSync(backup, shards, { recursive: true }); };
  const change = (index, file, mutate) => {
    const target = path.join(shards, `server-unit-shard-${index}/${file}.json`);
    const data = JSON.parse(readFileSync(target, 'utf8'));
    mutate(data);
    writeFileSync(target, JSON.stringify(data));
  };
  const failures = (extra = {}) => {
    merged = merge(extra);
    assert.equal(merged.status, 1);
    return readJson('test-results/server-coverage/shard-aggregate.json').failures;
  };
  for (const jobResult of ['failure', 'cancelled', 'skipped']) assert.ok(failures({ SERVER_UNIT_JOB_RESULT: jobResult }).some(message => message.includes(jobResult)));
  rmSync(path.join(shards, 'server-unit-shard-2'), { recursive: true });
  assert.ok(failures().some(message => message.includes('Missing shard 2')));
  restore();
  change(2, 'evidence', data => { data.selection.shard.index = 1; });
  assert.ok(failures().some(message => message.includes('Duplicate shard 1')));
  restore();
  change(1, 'results', data => { data.testResults[0].assertionResults[0].status = 'pending'; });
  assert.ok(failures().some(message => message.includes('pending:')));
  restore();
  change(1, 'evidence', data => { data.counts.passed = 100; });
  assert.ok(failures().some(message => message.includes('count disagrees')));
  restore();
  // Even internally consistent passing raw reports cannot impersonate another partition.
  for (const file of ['collected', 'collected-tests', 'results']) {
    cpSync(path.join(shards, `server-unit-shard-2/${file}.json`), path.join(shards, `server-unit-shard-1/${file}.json`));
  }
  assert.ok(failures().some(message => message.includes('disagrees with its raw report')));
  restore();
  rmSync(path.join(shards, 'server-unit-shard-1/blob.json'));
  assert.ok(failures().some(message => message.includes('no blob report')));
});
