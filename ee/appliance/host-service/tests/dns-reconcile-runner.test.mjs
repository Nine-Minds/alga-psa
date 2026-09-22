import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDnsReconciler } from '../dns-reconcile-runner.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alga-dns-reconcile-'));
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.kill = () => {};
  return child;
}

function harness(options = {}) {
  const dir = options.dir || tempDir();
  const scriptPath = options.scriptPath || path.join(dir, 'reconcile-k3s-dns.sh');
  if (!options.scriptMissing) fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\n', { mode: 0o755 });
  const activationFile = path.join(dir, 'dns-activation.json');
  const resultFile = path.join(dir, 'dns-reconcile.json');
  const spawnCalls = [];
  const children = [];
  let clock = 1_000_000;
  const spawnImpl = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    const child = fakeChild();
    children.push(child);
    return child;
  };
  const writeActivation = (value) => fs.writeFileSync(activationFile, `${JSON.stringify(value)}\n`);
  const reconciler = createDnsReconciler({
    scriptPath,
    kubeconfigPath: '/tmp/k3s.yaml',
    resultFile,
    logFile: path.join(dir, 'dns-reconcile.log'),
    activationFile,
    now: () => clock,
    sleep: async () => {
      clock += 10_000;
      if (options.onSleep) options.onSleep({ dir, activationFile, resultFile, writeActivation });
    },
    pollIntervalMs: 1_000,
    maxActivationWaitMs: options.maxActivationWaitMs || 5_000,
    spawnImpl,
    logger: { error: () => {} },
    ...options.reconciler
  });
  return {
    dir,
    reconciler,
    spawnCalls,
    children,
    resultFile,
    activationFile,
    readResult: () => JSON.parse(fs.readFileSync(resultFile, 'utf8')),
    writeActivation: (value) => fs.writeFileSync(activationFile, `${JSON.stringify(value)}\n`)
  };}

function resolveNext(child, code, stdout = '', stderr = '') {
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', stdout);
    if (stderr) child.stderr.emit('data', stderr);
    child.emit('exit', code, null);
  });
}

test('a submitted Job stays pending until the host reports activation active', async () => {
  const h = harness({
    onSleep: ({ writeActivation }) => {
      // The host helper republishes `active` only after rollouts are verified.
      writeActivation({ stage: 'active', fingerprint: 'f'.repeat(64), updatedAt: '2026-09-22T00:00:05.000Z' });
    }
  });
  const pending = h.reconciler.runOnce('startup');

  // The submission is already recorded as pending before the Job returns.
  assert.equal(h.readResult().ok, null);
  assert.equal(h.readResult().state, 'submitted');

  resolveNext(h.children[0], 0, 'DNS reconcile Job completed; host-owned activation continues.\n');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.state, 'active');
  assert.equal(h.spawnCalls.length, 1);
  assert.equal(h.spawnCalls[0].cmd, 'bash');
  assert.deepEqual(h.spawnCalls[0].args.slice(1, 3), ['--kubeconfig', '/tmp/k3s.yaml']);
  assert.equal(h.spawnCalls[0].args.includes('--no-wait'), false);
  assert.equal(h.readResult().ok, true);
  assert.match(fs.readFileSync(path.join(h.dir, 'dns-reconcile.log'), 'utf8'), /DNS reconcile trigger/);
});

test('a staging Job failure is recorded with the launcher error', async () => {
  const h = harness();
  const pending = h.reconciler.runOnce('periodic');
  resolveNext(h.children[0], 1, '', 'host systemd-run is not available\n');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /systemd-run is not available/);
  assert.equal(h.readResult().ok, false);
});

test('a host activation failure reaches the durable result', async () => {
  const h = harness({
    onSleep: ({ writeActivation }) => {
      writeActivation({ stage: 'failed', fingerprint: 'f'.repeat(64), updatedAt: '2026-09-22T00:00:05.000Z', error: 'Rollout of deployment/coredns did not complete.' });
    }
  });
  const pending = h.reconciler.runOnce('periodic');
  resolveNext(h.children[0], 0);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.match(result.error, /coredns/);
  assert.equal(h.readResult().activation.stage, 'failed');
});

test('a stale active record never counts as this submission completing', async () => {
  const h = harness();
  h.writeActivation({ stage: 'active', fingerprint: 'a'.repeat(64), updatedAt: '2026-09-21T00:00:00.000Z' });
  const pending = h.reconciler.runOnce('periodic');
  resolveNext(h.children[0], 0);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /Timed out/);
  assert.equal(h.readResult().state, 'failed');
});

test('an absent activation record times out instead of reporting success', async () => {
  const h = harness();
  const pending = h.reconciler.runOnce('periodic');
  resolveNext(h.children[0], 0);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /Timed out/);
});

test('overlapping ticks are single-flight', async () => {
  const h = harness();
  const first = h.reconciler.runOnce('startup');
  const second = await h.reconciler.runOnce('periodic');
  assert.equal(second.skipped, 'running');
  assert.equal(h.spawnCalls.length, 1);
  resolveNext(h.children[0], 0);
  h.writeActivation({ stage: 'active', fingerprint: 'f'.repeat(64), updatedAt: '2026-09-22T00:00:05.000Z' });
  await first;
});

test('a missing launcher is skipped without spawning', async () => {
  const h = harness({ scriptMissing: true });
  const result = await h.reconciler.runOnce('startup');
  assert.equal(result.skipped, 'script-missing');
  assert.equal(h.spawnCalls.length, 0);
});

test('activation is skipped while a setup workflow owns the host', async () => {
  const h = harness({ reconciler: { shouldSkip: () => true } });
  const result = await h.reconciler.runOnce('periodic');
  assert.equal(result.skipped, 'setup-in-progress');
  assert.equal(h.spawnCalls.length, 0);
});

test('disabled reconciler never spawns', async () => {
  const h = harness({ reconciler: { disabled: true } });
  const result = await h.reconciler.runOnce('startup');
  assert.equal(result.skipped, 'disabled');
  assert.equal(h.spawnCalls.length, 0);
});
