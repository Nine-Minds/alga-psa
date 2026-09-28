import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const reporter = fileURLToPath(new URL('../lib/vitest-flaky-reporter.mjs', import.meta.url));
const runners = ['../../server/node_modules/vitest/vitest.mjs', '../../node_modules/vitest/vitest.mjs'];

// A fail-then-pass only exists inside the runner: the JSON report records the
// final pass. The reporter is the sole record of the retry, so it is driven
// through a real vitest run rather than a simulated event stream.
for (const runner of runners) {
  test(`real ${runner} records a fail-then-pass and ignores stable results`, { timeout: 60000 }, (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'alga-flaky-reporter-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const output = path.join(root, 'evidence/flaky-tests.json');
    writeFileSync(path.join(root, 'vitest.config.mjs'), `export default ${JSON.stringify({ test: {
      globals: true, include: ['*.test.js'], maxWorkers: 1, fileParallelism: false,
      reporters: ['default', reporter], pool: 'forks',
    } })};`);
    const marker = path.join(root, 'first-attempt');
    writeFileSync(path.join(root, 'recovers.test.js'), `
      import { existsSync, writeFileSync } from 'node:fs';
      test('recovers after one retry', () => {
        if (!existsSync(${JSON.stringify(marker)})) {
          writeFileSync(${JSON.stringify(marker)}, 'attempted');
          throw new Error('deliberate first-attempt failure');
        }
        expect(true).toBe(true);
      });
      describe('stable suite', () => { test('always passes', () => expect(2 + 2).toBe(4)); });
    `);
    const run = (args = []) => spawnSync(process.execPath,
      [fileURLToPath(new URL(runner, import.meta.url)), 'run', ...args],
      { cwd: root, encoding: 'utf8', timeout: 45000, env: { ...process.env, FLAKY_TESTS_PATH: output,
        GITHUB_SHA: 'f'.repeat(40), GITHUB_RUN_ID: '4242', GITHUB_RUN_ATTEMPT: '2',
        SERVER_UNIT_SHARD_INDEX: '3', SERVER_UNIT_SHARD_TOTAL: '4' } });
    const document = () => JSON.parse(readFileSync(output, 'utf8'));

    const retried = run(['--retry=1']);
    assert.equal(retried.status, 0, retried.stdout + retried.stderr);
    const recorded = document();
    assert.deepEqual({ ...recorded, tests: undefined }, { schemaVersion: 1, suite: 'server-unit',
      job: 'server-unit shard 3/4', shard: { index: 3, total: 4 }, revision: 'f'.repeat(40),
      runId: '4242', runAttempt: 2, tests: undefined });
    assert.deepEqual(recorded.tests, [{ testId: 'recovers.test.js > recovers after one retry',
      file: 'recovers.test.js', name: 'recovers after one retry', retryCount: 1 }]);

    // The same suite without a retry leaves an empty document behind, never a
    // stale one from the previous run.
    const stable = run(['--retry=1']);
    assert.equal(stable.status, 0, stable.stdout + stable.stderr);
    assert.deepEqual(document().tests, []);

    // Without --retry the first failure stands; nothing is reported as flaky.
    rmSync(marker);
    const strict = run();
    assert.equal(strict.status, 1, strict.stdout + strict.stderr);
    assert.deepEqual(document().tests, []);
  });
}
