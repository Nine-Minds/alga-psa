import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));

// Each fixture file records its pid and the window it ran in, so a run reports
// both whether files shared a process and whether they overlapped.
function fixture(t, prefix, config) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'vitest.config.mjs'), config);
  for (const name of ['first', 'second', 'third']) {
    writeFileSync(path.join(root, `${name}.test.js`), `
      import { writeFileSync } from 'node:fs';
      test('records its own runtime', async () => {
        const start = Date.now();
        await new Promise((resolve) => setTimeout(resolve, 400));
        writeFileSync(${JSON.stringify(path.join(root, name + '.run'))}, JSON.stringify({ pid: process.pid, start, end: Date.now() }));
        expect(2 + 2).toBe(4);
      });
    `);
  }
  return (overrides, env = {}) => {
    for (const file of readdirSync(root).filter((name) => name.endsWith('.run'))) rmSync(path.join(root, file));
    const result = spawnSync(process.execPath, [vitest, 'run', ...overrides], {
      cwd: root, env: { ...process.env, CI: '1', ...env }, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const runs = readdirSync(root).filter((file) => file.endsWith('.run'))
      .map((file) => JSON.parse(readFileSync(path.join(root, file), 'utf8')));
    assert.equal(runs.length, 3, `every file must run: ${result.stdout}`);
    const sorted = [...runs].sort((a, b) => a.start - b.start);
    const overlapped = sorted.some((run, index) => index > 0 && run.start < sorted[index - 1].end);
    return { processes: new Set(runs.map((run) => run.pid)).size, overlapped };
  };
}

test('isolate: true gives each file a fresh worker', { timeout: 60000 }, (t) => {
  const run = fixture(t, 'alga-unit-isolation-', `export default ${JSON.stringify({ test: {
    globals: true, include: ['*.test.js'], fileParallelism: false, maxWorkers: 1, isolate: true, pool: 'forks',
  } })};`);
  assert.deepEqual(run([]), { processes: 3, overlapped: false });
});

// server/vitest.config.ts declares jsdom/node projects (extends: true). A
// maxWorkers set in config reaches the projects and a CLI --maxWorkers cannot
// lift it, so the config caps lanes at one worker unless VITEST_RECYCLE_FORKS=1
// hands the worker count to the CLI (the unit shard runner's --maxWorkers=4).
// Pin both halves: DB lanes must never parallelize, unit shards must.
test('under projects VITEST_RECYCLE_FORKS decides whether CLI parallelism applies', { timeout: 60000 }, (t) => {
  const run = fixture(t, 'alga-unit-isolation-projects-', `
    const recycleForks = process.env.VITEST_RECYCLE_FORKS === '1';
    export default { test: {
      globals: true, include: ['*.test.js'], isolate: true, pool: 'forks', fileParallelism: false,
      ...(recycleForks ? {} : { maxWorkers: 1 }),
      projects: [
        { extends: true, test: { name: 'jsdom', exclude: ['second.test.js', 'third.test.js'] } },
        { extends: true, test: { name: 'node', exclude: ['first.test.js'] } },
      ],
    } };
  `);
  const parallel = ['--fileParallelism=true', '--maxWorkers=3'];
  assert.deepEqual(run(parallel), { processes: 3, overlapped: false },
    'without VITEST_RECYCLE_FORKS the config cap must keep files serial');
  assert.deepEqual(run(['--maxWorkers=1'], { VITEST_RECYCLE_FORKS: '1' }), { processes: 3, overlapped: false });
  assert.equal(run(parallel, { VITEST_RECYCLE_FORKS: '1' }).overlapped, true,
    'VITEST_RECYCLE_FORKS must let the CLI worker count reach project workers');
});
