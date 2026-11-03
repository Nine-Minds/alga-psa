import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { isLateConsoleLogTeardown } from '../lib/vitest-unhandled-errors.mjs';

const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
const serverConfig = fileURLToPath(new URL('../../server/vitest.config.ts', import.meta.url));

// A file's last log is still being acknowledged (the slow reporter stands in
// for a loaded CI orchestrator) when a timer logs again. The worker drains only
// the first delivery, so the second one is in flight when the fork closes. Unit
// shards 1, 3 and 4 went red this way with every test green.
function fixture(t, { wireServerHandler, extraTest = '' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-vitest-late-log-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'slow-reporter.mjs'), `
    export default class SlowConsoleAcknowledgement {
      async onUserConsoleLog() { await new Promise((resolve) => setTimeout(resolve, 300)); }
    }
  `);
  writeFileSync(path.join(root, 'late-log.test.js'), `
    test('passes', () => { expect(2 + 2).toBe(4); });
    afterAll(() => {
      console.log('last log of the file');
      setTimeout(() => console.error('log emitted while the worker drains its rpc channel'), 50);
    });
  `);
  if (extraTest) writeFileSync(path.join(root, 'extra.test.js'), extraTest);
  writeFileSync(path.join(root, 'vitest.config.mts'), `
    ${wireServerHandler ? `import serverConfig from ${JSON.stringify(serverConfig)};` : ''}
    export default { test: {
      globals: true, include: ['*.test.js'], isolate: true, pool: 'forks', silent: 'passed-only',
      reporters: ['default', './slow-reporter.mjs'],
      ${wireServerHandler ? 'onUnhandledError: serverConfig.test.onUnhandledError,' : ''}
    } };
  `);
  const result = spawnSync(process.execPath, [vitest, 'run'], {
    cwd: root, env: { ...process.env, CI: '1' }, encoding: 'utf8', timeout: 60000,
  });
  // CI runners get colored vitest output even when piped; assertions read plain text.
  return { status: result.status, output: stripVTControlCharacters(result.stdout + result.stderr) };
}

test('a log emitted while a fork drains its rpc channel fails an all-green run without the handler', { timeout: 90000 }, (t) => {
  const { status, output } = fixture(t, { wireServerHandler: false });
  assert.equal(status, 1, output);
  assert.match(output, /Closing rpc while "onUserConsoleLog" was pending/);
  assert.match(output, /Tests\s+1 passed/);
});

test('the server vitest config does not fail an all-green run on a late console log', { timeout: 90000 }, (t) => {
  const { status, output } = fixture(t, { wireServerHandler: true });
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /EnvironmentTeardownError/);
});

test('the server vitest config still fails a run on any other unhandled error', { timeout: 90000 }, (t) => {
  const { status, output } = fixture(t, {
    wireServerHandler: true,
    extraTest: `
      test('leaks a rejection', () => { Promise.reject(new Error('real unhandled rejection')); expect(1).toBe(1); });
    `,
  });
  assert.equal(status, 1, output);
  assert.match(output, /real unhandled rejection/);
});

test('only the console-log delivery is recognised as a late teardown rejection', () => {
  const teardown = (method) => Object.assign(new Error(`[vitest-worker]: Closing rpc while "${method}" was pending`), {
    name: 'EnvironmentTeardownError',
  });
  assert.equal(isLateConsoleLogTeardown(teardown('onUserConsoleLog')), true);
  assert.equal(isLateConsoleLogTeardown(teardown('onTaskUpdate')), false);
  assert.equal(isLateConsoleLogTeardown(new Error('[vitest-worker]: Closing rpc while "onUserConsoleLog" was pending')), false);
  assert.equal(isLateConsoleLogTeardown(undefined), false);
});
