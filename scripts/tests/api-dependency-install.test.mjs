import test from 'node:test';
import assert from 'node:assert/strict';
import { installApiTestDependencies } from '../install-api-test-dependencies.mjs';
const success = { code: 0, signal: null, stderr: '' };
const network = { code: 1, signal: null, stderr: 'npm error code ECONNRESET\nnpm error network aborted\n' };
for (const [name, results, count, waits] of [
  ['first success installs once', [success], 1, 0],
  ['transient reset recovers once', [network, success], 2, 1],
  ['terminal reset preserves failure', [network, network], 2, 1],
  ['lockfile failure is not retried', [{ code: 1, signal: null, stderr: 'npm error code EUSAGE' }], 1, 0],
  ['lifecycle failure is not retried', [{ code: 42, signal: null, stderr: 'npm error code 42\nscript ECONNRESET' }], 1, 0],
  ['nested network error followed by lifecycle failure is not retried', [{ code: 1, signal: null, stderr: 'npm error code ECONNRESET\nnpm error code ELIFECYCLE\n' }], 1, 0],
  ['terminated install is not retried', [{ code: null, signal: 'SIGTERM', stderr: network.stderr }], 1, 0],
]) test(name, async () => {
  let calls = 0, pauses = 0;
  const result = await installApiTestDependencies({ run: async args => {
    assert.deepEqual(args, ['ci', '--prefer-offline']); return results[calls++];
  }, wait: async milliseconds => { assert.equal(milliseconds, 2000); pauses++; } });
  assert.equal(calls, count); assert.equal(pauses, waits); assert.deepEqual(result, results.at(-1));
});
test('cancellation during retry delay never starts another install', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(installApiTestDependencies({ signal: controller.signal, run: async () => { calls++; return network; },
    wait: async (_ms, _value, { signal }) => { controller.abort(); assert.equal(signal.aborted, true); throw new Error('aborted'); } }));
  assert.equal(calls, 1);
});

test('CLI preserves real child exit status and signal', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = await mkdtemp(path.join(tmpdir(), 'api-install-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const npm = path.join(directory, 'npm');
  const cli = path.resolve('scripts/install-api-test-dependencies.mjs');
  for (const [script, expectedCode, expectedSignal] of [
    ['process.stderr.write("npm error code EUSAGE\\n"); process.exit(42);', 42, null],
    ['process.kill(process.pid, "SIGTERM");', null, 'SIGTERM'],
  ]) {
    await writeFile(npm, `#!${process.execPath}\n${script}\n`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [cli], { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, timeout: 5000 });
    assert.equal(result.status, expectedCode); assert.equal(result.signal, expectedSignal);
  }
});
