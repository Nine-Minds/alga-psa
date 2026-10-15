import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const reporter = fileURLToPath(new URL('../lib/vitest-progress-reporter.mjs', import.meta.url));
const runners = ['../../server/node_modules/vitest/vitest.mjs', '../../node_modules/vitest/vitest.mjs'];

for (const runner of runners) {
  test(`real ${runner} preserves results and interrupted import evidence`, { timeout: 30000 }, async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'alga-test-progress-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const output = path.join(root, 'progress.jsonl');
    const events = () => existsSync(output)
      ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    writeFileSync(path.join(root, 'vitest.config.mjs'), `export default ${JSON.stringify({ test: {
      globals: true, include: ['*.test.js'], maxWorkers: 1, fileParallelism: false,
      reporters: [reporter], pool: 'forks',
    } })};`);
    const run = () => {
      let log = '';
      const child = spawn(process.execPath, [fileURLToPath(new URL(runner, import.meta.url)), 'run'], {
        cwd: root, env: { ...process.env, TEST_PROGRESS_PATH: output },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      });
      child.stdout.on('data', (chunk) => { log += chunk; });
      child.stderr.on('data', (chunk) => { log += chunk; });
      const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
      t.after(kill);
      const watchdog = setTimeout(kill, 12000);
      const ended = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => { clearTimeout(watchdog); resolve({ code, signal, log }); });
      });
      return { ended, kill };
    };
    writeFileSync(path.join(root, 'result.test.js'), `
      test('persists', () => expect(2 + 2).toBe(4));
      test('detects regression', () => expect(2 + 2).toBe(5));
      test.skip('deferred', () => {});
    `);
    const result = await run().ended;
    assert.equal(result.code, 1, result.log);
    const completed = events();
    assert.deepEqual(completed.find((entry) => entry.event === 'run-started').files, ['result.test.js']);
    assert.equal(completed.find((entry) => entry.event === 'module-queued').file, 'result.test.js');
    assert.equal(completed.find((entry) => entry.event === 'module-finished').state, 'failed');
    assert.deepEqual(completed.filter((entry) => entry.event === 'test-finished').map((entry) => entry.state).sort(), ['failed', 'passed', 'skipped']);
    assert.equal(completed.filter((entry) => entry.event === 'test-ready').length, 3);
    assert.equal(completed.at(-1).event, 'run-finished');
    assert.deepEqual(completed.map((entry) => entry.sequence), completed.map((_, index) => index));
    const previousRun = completed[0].runId;

    // Block synchronously during module import, before Vitest's test timeout
    // exists. Kill only this deliberately stuck fixture and its worker group.
    writeFileSync(path.join(root, 'result.test.js'), 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);');
    const interrupted = run();
    for (let attempt = 0; attempt < 150; attempt++) {
      const current = events();
      if (current[0]?.runId !== previousRun && current.some((entry) => entry.event === 'module-queued')) break;
      await delay(50);
    }
    const partial = events();
    assert.notEqual(partial[0].runId, previousRun);
    assert.equal(partial.at(-1).event, 'module-queued');
    assert.equal(partial.at(-1).file, 'result.test.js');
    interrupted.kill();
    assert.equal((await interrupted.ended).signal, 'SIGKILL');
    assert.deepEqual(events(), partial, 'termination preserves progress without fabricating completion');
  });
}
