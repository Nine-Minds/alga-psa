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
    'scripts/lib/vitest-progress-reporter.mjs', 'scripts/lib/vitest-flaky-reporter.mjs',
    'scripts/lib/flaky-policy.mjs', 'scripts/lib/test-discovery.mjs',
    'scripts/lib/candidate-execution-artifacts.mjs', 'scripts/lib/candidate-execution-gate.mjs',
    'scripts/lib/node-test-execution.mjs', 'scripts/lib/playwright-execution-evidence.mjs',
    'scripts/lib/jsdom-test-globs.mjs',
    'server/vitest.server-unit-shard.config.ts',
  ]) cpSync(path.join(repository, file), path.join(root, file));
  symlinkSync(path.join(repository, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  // The shard config splits its partition into a jsdom and a node project; the
  // config below resolves tinyglobby from the repository root to do it.
  symlinkSync(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\ntest-results/\ncoverage/\nserver/test-results.json\n');
  // Mirrors the real server config's shape: the jsdom/node projects have to be
  // here too, because `vitest --merge-reports` replays a blob against the
  // project names the producing run used and silently reports zero tests when
  // the replaying config has none of them.
  writeFileSync(path.join(root, 'server/vitest.config.ts'), [
    "import { globSync } from 'tinyglobby';",
    "import { environmentProjects, partitionByEnvironment } from '../scripts/lib/jsdom-test-globs.mjs';",
    "const include = ['src/test/unit/**/*.test.ts'];",
    "const exclude = ['**/node_modules/**'];",
    "const files = globSync(include, { dot: true, cwd: __dirname, ignore: exclude, expandDirectories: false });",
    `export default { test: { ...${JSON.stringify({
      globals: true, environment: 'node', pool: 'forks',
      fileParallelism: false, maxWorkers: 1, isolate: true, poolOptions: { forks: { singleFork: true } },
      coverage: { provider: 'v8', enabled: false, reporter: ['text-summary'], include: ['src/**/*.ts'] },
    })}, include, exclude,`,
    '  projects: environmentProjects(partitionByEnvironment(files, __dirname)) } };',
  ].join('\n'));
  writeFileSync(path.join(root, 'server/src/lib.ts'), 'export const double = (value: number) => value * 2;\n');
  for (const [index, behavior] of ['creates', 'updates', 'deletes'].entries()) {
    writeFileSync(path.join(root, `server/src/test/unit/${behavior}.test.ts`),
      `import { double } from '../../lib';\ntest('${behavior} an item', () => expect(double(${index})).toBe(${index * 2}));\n`);
  }
  // Fails its first attempt only. The marker lives in gitignored test-results/
  // so the deliberate flake cannot dirty the fixture checkout. Sorted, this
  // file falls to shard 1.
  const marker = JSON.stringify(path.join(root, 'test-results/flaky-marker'));
  writeFileSync(path.join(root, 'server/src/test/unit/recovers.test.ts'), [
    "import { existsSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import { double } from '../../lib';",
    "test('recovers on retry', () => {",
    `  if (!existsSync(${marker})) {`,
    `    mkdirSync(path.dirname(${marker}), { recursive: true });`,
    `    writeFileSync(${marker}, 'attempted');`,
    "    throw new Error('deliberate first-attempt failure');",
    '  }',
    '  expect(double(2)).toBe(4);',
    '});',
  ].join('\n') + '\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init'); git('add', '.');
  git('-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Create isolated shard fixture');
  const revision = git('rev-parse', 'HEAD');
  // The flaky policy reads the event, so it is pinned rather than inherited from
  // whatever run is executing this test.
  const env = { ...process.env, CI: '1', GITHUB_SHA: revision, GITHUB_RUN_ID: '', GITHUB_RUN_ATTEMPT: '',
    GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feature/flakes', GITHUB_REF_NAME: '',
    SKIP_DB_TESTS: '1', DB_USER_ADMIN: '', DB_PASSWORD_ADMIN: '',
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
    assert.equal(evidence.selection.allFiles.length, 4);
    assert.equal(evidence.expectedFiles.length, 2);
    assert.ok(existsSync(path.join(root, 'test-results/server-coverage/blob.json')));
    // On a pull request the retried file leaves the shard green with a warning
    // naming it; flaky-tests.json is the only record its first attempt failed.
    const flaky = readJson('test-results/server-coverage/flaky-tests.json');
    assert.deepEqual({ ...flaky, tests: undefined }, { schemaVersion: 1, suite: 'server-unit',
      job: `server-unit shard ${index}/2`, shard: { index, total: 2 }, revision, runId: null, runAttempt: null,
      eventName: 'pull_request', branch: 'feature/flakes', tests: undefined });
    assert.equal(/::warning::Flaky test passed only on retry: src\/test\/unit\/recovers\.test\.ts > recovers on retry/
      .test(result.stderr), index === 1, result.stderr);
    assert.deepEqual(flaky.tests, index === 1
      ? [{ testId: 'src/test/unit/recovers.test.ts > recovers on retry', file: 'src/test/unit/recovers.test.ts',
        name: 'recovers on retry', retryCount: 1 }]
      : []);
    // Only the shard that retried publishes the upload copy the weekly report
    // downloads, and shard 2 must not inherit shard 1's.
    const uploaded = path.join(root, 'test-results/server-unit-flaky/flaky-tests.json');
    assert.equal(existsSync(uploaded), index === 1);
    if (index === 1) assert.deepEqual(JSON.parse(readFileSync(uploaded, 'utf8')), flaky);
    cpSync(path.join(root, 'test-results/server-coverage'), path.join(shards, `server-unit-shard-${index}`), { recursive: true });
  }
  // The same retry-only pass on a push to main fails the shard's own execution
  // verification instead of warning (PRD.md:99, flaky-retry-policy.md).
  rmSync(path.join(root, 'test-results/flaky-marker'));
  const onPush = node(['scripts/run-server-unit-shard.mjs'],
    { SERVER_UNIT_SHARD_INDEX: '1', GITHUB_EVENT_NAME: 'push', GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main' });
  assert.equal(onPush.status, 1, onPush.stdout + onPush.stderr);
  const pushed = readJson('test-results/server-coverage/evidence.json');
  assert.equal(pushed.status, 'failed');
  assert.deepEqual(pushed.failures, ['retry-only pass on push run: src/test/unit/recovers.test.ts > recovers on retry']);
  const pushedFlaky = readJson('test-results/server-coverage/flaky-tests.json');
  assert.deepEqual([pushedFlaky.eventName, pushedFlaky.branch], ['push', 'main']);
  assert.equal(existsSync(path.join(root, 'test-results/server-unit-flaky/flaky-tests.json')), true);

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
  assert.equal(aggregate.counts.passed, 4);
  assert.deepEqual(readdirSync(path.join(root, 'test-results/server-unit-blobs')).sort(), ['blob-1.json', 'blob-2.json']);
  assert.equal(readJson('test-results/server-coverage/collected.json').length, 4);
  assert.equal(readJson('test-results/server-coverage/collected-tests.json').length, 4);
  assert.equal(readJson('test-results/server-coverage/source-before.json').revision, revision);

  const vitest = path.join(root, 'server/node_modules/vitest/vitest.mjs');
  const replay = spawnSync(process.execPath, [vitest, 'run', '--merge-reports', '../test-results/server-unit-blobs',
    '--coverage.enabled=true', '--coverage.reporter=json-summary', '--reporter=json', '--outputFile.json=./test-results.json'],
  { cwd: path.join(root, 'server'), encoding: 'utf8', timeout: 60000, env });
  assert.equal(replay.status, 0, replay.stdout + replay.stderr);
  const report = readJson('server/test-results.json');
  assert.equal(report.numTotalTests, 4);
  assert.equal(readJson('server/coverage/coverage-summary.json').total.lines.covered > 0, true);

  const verified = node(['scripts/verify-server-unit-execution.mjs'], { SERVER_UNIT_RUN_OUTCOME: 'success' });
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const evidence = readJson('test-results/server-coverage/evidence.json');
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.counts.passed, 4);
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
