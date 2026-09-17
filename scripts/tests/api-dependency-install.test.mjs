import test from 'node:test';
import assert from 'node:assert/strict';
import { installApiTestDependencies } from '../install-api-test-dependencies.mjs';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
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

const ffmpegDownload = { code: 1, signal: null, stderr: [
  'npm error code 1',
  'npm error path /home/runner/work/alga-psa/alga-psa/node_modules/ffmpeg-static',
  'npm error command failed',
  'npm error command sh -c node install.js',
  'npm error Error: Failed to download ffmpeg b6.1.1.',
  "npm error   url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.LICENSE',",
  'npm error   statusCode: 500',
  'npm error }',
].join('\n') };
for (const [name, first, enabled, expectedCalls] of [
  ['observed GitHub download failure recovers with explicit opt-in', ffmpegDownload, true, 2],
  ['API default does not retry ffmpeg lifecycle failure', ffmpegDownload, false, 1],
  ...[401, 404].map(status => [`HTTP ${status} is not retried`, { ...ffmpegDownload, stderr: ffmpegDownload.stderr.replace('statusCode: 500', `statusCode: ${status}`) }, true, 1]),
  ['unrelated install script is not retried', { ...ffmpegDownload, stderr: ffmpegDownload.stderr.replace('node_modules/ffmpeg-static', 'node_modules/other') }, true, 1],
  ['other download origin is not retried', { ...ffmpegDownload, stderr: ffmpegDownload.stderr.replace('https://github.com/', 'https://example.com/') }, true, 1],
  ['conflicting lifecycle code is not retried', { ...ffmpegDownload, stderr: `${ffmpegDownload.stderr}\nnpm error code ELIFECYCLE` }, true, 1],
  ['signal is preserved without retry', { ...ffmpegDownload, code: null, signal: 'SIGTERM' }, true, 1],
]) test(name, async () => {
  let calls = 0, pauses = 0;
  const result = await installApiTestDependencies({ ffmpegDownloadRetry: enabled,
    run: async args => { assert.deepEqual(args, ['ci', '--prefer-offline']); return calls++ === 0 ? first : success; },
    wait: async ms => { assert.equal(ms, 2000); pauses++; } });
  assert.equal(calls, expectedCalls); assert.equal(pauses, expectedCalls - 1);
  assert.deepEqual(result, expectedCalls === 2 ? success : first);
});
test('repeated ffmpeg download failure preserves terminal result after two attempts', async () => {
  let calls = 0;
  const result = await installApiTestDependencies({ ffmpegDownloadRetry: true,
    run: async () => { calls++; return ffmpegDownload; }, wait: async () => {} });
  assert.equal(calls, 2); assert.deepEqual(result, ffmpegDownload);
});

for (const [workflow, jobId] of [
  ['node-tests.yml', 'browser-discovery'],
  ['temporal-readiness.yml', 'engine-tests'],
]) test(`${jobId} install step recovers from a transient README download failure and preserves terminal failures`, t => {
  const root = path.resolve(import.meta.dirname, '../..');
  const job = parse(readFileSync(path.join(root, '.github/workflows', workflow), 'utf8')).jobs[jobId];
  const step = job.steps.find(step => step.run === 'npm ci' || step.run === 'node scripts/install-api-test-dependencies.mjs');
  assert.ok(step, 'root dependency installation step must exist');
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-install-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const callsFile = path.join(directory, 'calls.json');
  // Replay the npm diagnostic from CI without relying on another GitHub outage.
  const readmeFailure = ffmpegDownload.stderr.replace('linux-x64.LICENSE', 'linux-x64.README');
  for (const [name, diagnostics, failureCount, expectedStatus, expectedCalls] of [
    ['transient download', readmeFailure, 1, 0, 2],
    ['persistent download', readmeFailure, 3, 1, 2],
    ['unrelated lifecycle', 'npm error code 42\nnpm error command failed\n', 3, 42, 1],
  ]) {
    writeFileSync(callsFile, '[]');
    writeFileSync(path.join(directory, 'npm'), `#!${process.execPath}
const fs = require('node:fs');
const file = ${JSON.stringify(callsFile)};
const calls = JSON.parse(fs.readFileSync(file, 'utf8'));
calls.push(process.argv.slice(2));
fs.writeFileSync(file, JSON.stringify(calls));
if (calls.length <= ${failureCount}) {
  process.stderr.write(${JSON.stringify(diagnostics)});
  process.exit(${expectedStatus || 1});
}
`, { mode: 0o700 });
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      cwd: root,
      env: { ...process.env, FFMPEG_STATIC_DOWNLOAD_RETRY: '', ...job.env, ...step.env, PATH: `${directory}:${process.env.PATH}` },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}`);
    const calls = JSON.parse(readFileSync(callsFile, 'utf8'));
    assert.equal(calls.length, expectedCalls, name);
    for (const args of calls) assert.deepEqual(args, ['ci', '--prefer-offline']);
    assert.ok(result.stderr.includes(diagnostics), 'original npm failure remains visible');
  }
});
