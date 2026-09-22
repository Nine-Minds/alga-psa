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
  const spawnCalls = [];
  const children = [];
  const spawnImpl = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    const child = fakeChild();
    children.push(child);
    return child;
  };
  const reconciler = createDnsReconciler({
    scriptPath,
    kubeconfigPath: '/tmp/k3s.yaml',
    resultFile: path.join(dir, 'dns-reconcile.json'),
    logFile: path.join(dir, 'dns-reconcile.log'),
    spawnImpl,
    logger: { error: () => {} },
    ...options.reconciler
  });
  return { dir, reconciler, spawnCalls, children };
}

function resolveNext(child, code, stdout = '', stderr = '') {
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', stdout);
    if (stderr) child.stderr.emit('data', stderr);
    child.emit('exit', code, null);
  });
}

test('a successful reconcile records ok and appends the log', async () => {
  const h = harness();
  const pending = h.reconciler.runOnce('startup');
  resolveNext(h.children[0], 0, 'DNS reconciliation completed.\n');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(h.spawnCalls.length, 1);
  assert.equal(h.spawnCalls[0].cmd, 'bash');
  assert.deepEqual(h.spawnCalls[0].args.slice(1, 3), ['--kubeconfig', '/tmp/k3s.yaml']);
  const persisted = JSON.parse(fs.readFileSync(path.join(h.dir, 'dns-reconcile.json'), 'utf8'));
  assert.equal(persisted.ok, true);
  assert.match(fs.readFileSync(path.join(h.dir, 'dns-reconcile.log'), 'utf8'), /DNS reconciliation completed/);
});

test('a failed reconcile records the error for status', async () => {
  const h = harness();
  const pending = h.reconciler.runOnce('periodic');
  resolveNext(h.children[0], 1, '', 'no usable upstream');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /no usable upstream/);
  const persisted = JSON.parse(fs.readFileSync(path.join(h.dir, 'dns-reconcile.json'), 'utf8'));
  assert.equal(persisted.ok, false);
});

test('overlapping ticks are single-flight', async () => {
  const h = harness();
  const first = h.reconciler.runOnce('startup');
  const second = await h.reconciler.runOnce('periodic');
  assert.equal(second.skipped, 'running');
  assert.equal(h.spawnCalls.length, 1);
  resolveNext(h.children[0], 0);
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
