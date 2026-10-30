import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { patchFlightDebugSource, patchNextFlightDebug } = require('../lib/patch-next-flight-debug.cjs');
const nextRoot = path.dirname(require.resolve('next/package.json'));
const filename = path.join(nextRoot, 'dist/compiled/next-server/app-page-turbo.runtime.dev.js');
// npm postinstall may already have repaired the installed bundle. Always feed
// the original destroy policy to the transformer so a no-op mutation cannot
// pass merely because this checkout's node_modules was previously patched.
const original = fs.readFileSync(filename, 'utf8').replace(
  'destroy:function(asyncId){var retired=pendingOperations.get(asyncId);if(retired){retired.previous=null;retired.awaited=null}pendingOperations.delete(asyncId)}',
  'destroy:function(asyncId){pendingOperations.delete(asyncId)}',
);

function callbacks(source, pendingOperations) {
  const start = source.indexOf('async_hooks.createHook({init:');
  assert.notEqual(start, -1);
  const end = source.indexOf('}).enable()', start);
  assert.notEqual(end, -1);
  return vm.runInNewContext(`(${source.slice(start + 'async_hooks.createHook('.length, end + 1)})`, {
    pendingOperations,
    async_hooks: { executionAsyncId: () => 0 },
    resolveOwner: () => null,
    resolveRequest: () => null,
    parseStackTracePrivate: () => null,
    resolvePromiseOrAwaitNode: node => node,
    WeakRef,
    performance,
  });
}

test('destroyed async resources no longer pin an unbounded ancestry chain', () => {
  const source = patchFlightDebugSource(original, filename);
  const pending = new Map();
  const hook = callbacks(source, pending);
  for (let id = 1; id <= 2000; id++) {
    hook.init(id, 'PROMISE', id - 1, {});
    hook.destroy(id - 1);
  }
  assert.equal(pending.size, 1);
  let depth = 0;
  for (let node = pending.get(2000); node; node = node.awaited) {
    assert.ok(++depth <= 2, 'retired metadata retains earlier async ancestry');
  }
  assert.equal(depth, 2);
});

test('destroy preserves the retired frame and live child while releasing both ancestry links', () => {
  const pending = new Map();
  const hook = callbacks(patchFlightDebugSource(original, filename), pending);
  const stack = ['saved frame'];
  const retired = { tag: 1, stack, previous: {}, awaited: {}, end: 10 };
  const child = { awaited: retired };
  pending.set(1, retired);
  pending.set(2, child);
  hook.destroy(1);
  assert.equal(pending.has(1), false);
  assert.equal(pending.get(2), child);
  assert.equal(child.awaited, retired);
  assert.equal(retired.stack, stack);
  assert.equal(retired.tag, 1);
  assert.equal(retired.previous, null);
  assert.equal(retired.awaited, null);
  assert.doesNotThrow(() => hook.destroy(999));
});

test('patching is idempotent and fails closed when the target callback changes', () => {
  const patched = patchFlightDebugSource(original, filename);
  assert.equal(patchFlightDebugSource(patched, filename), patched);
  assert.throws(() => patchFlightDebugSource('unknown tracker', filename), /tracker changed/);
  assert.throws(() => patchFlightDebugSource(original + original, filename), /tracker changed/);
});

test('installation refuses a different Next version without changing files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-flight-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '16.4.0' }));
  assert.throws(() => patchNextFlightDebug(root), /requires Next 16.4.2/);
  assert.deepEqual(fs.readdirSync(root), ['package.json']);
});

test('real long-lived async work retains bounded ancestry after destroy (unpatched control grows)', t => {
  function run(control) {
    const source = patchFlightDebugSource(original, filename);
    const start = source.indexOf('async_hooks.createHook({init:');
    const end = source.indexOf('}).enable()', start);
    const hookSource = source.slice(start + 'async_hooks.createHook('.length, end + 1);
    const program = `
      const vm = require('node:vm'), async_hooks = require('node:async_hooks');
      const pendingOperations = new Map();
      const hook = vm.runInNewContext('(' + ${JSON.stringify(hookSource)} + ')', {
        pendingOperations, async_hooks, WeakRef, performance, emptyStack: [], lastRanAwait: null,
        resolveOwner: () => null, resolveRequest: () => null, parseStackTracePrivate: () => null,
        resolvePromiseOrAwaitNode: (node, end) => { node.tag = node.tag === 3 ? 1 : 2; node.end = end; return node; },
      });
      if (${control}) hook.destroy = id => pendingOperations.delete(id);
      const active = async_hooks.createHook(hook).enable();
      (async () => {
        for (let i = 0; i < 12000; i++) {
          await new Promise(resolve => setImmediate(resolve));
          await Promise.resolve(); await Promise.resolve();
          if (i % 1000 === 0) global.gc();
        }
        active.disable(); global.gc();
        const seen = new Set(), queue = [...pendingOperations.values()];
        while (queue.length) {
          const node = queue.pop(); if (!node || seen.has(node)) continue;
          seen.add(node); queue.push(node.previous, node.awaited);
        }
        console.log(JSON.stringify({ live: pendingOperations.size, ancestry: seen.size }));
      })().catch(error => { active.disable(); throw error; });
    `;
    const result = spawnSync(process.execPath, ['--expose-gc', '-e', program], { encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }
  const baseline = run(true);
  const repaired = run(false);
  t.diagnostic(JSON.stringify({ baseline, repaired }));
  assert.ok(baseline.ancestry > 20000, JSON.stringify({ baseline, repaired }));
  assert.ok(repaired.ancestry < baseline.ancestry / 5, JSON.stringify({ baseline, repaired }));
});

test('installer covers both bundlers and channel variants, preserves production, and is idempotent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-flight-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '16.4.2' }));
  const files = [];
  for (const base of ['app-page', 'use-cache-probe-worker']) {
    for (const variant of ['', '-turbo', '-experimental', '-turbo-experimental']) {
      files.push(`dist/compiled/next-server/${base}${variant}.runtime.dev.js`);
    }
  }
  for (const bundler of ['webpack', 'turbopack']) {
    for (const variant of ['', '-experimental']) {
      files.push(`dist/compiled/react-server-dom-${bundler}${variant}/cjs/react-server-dom-${bundler}-server.node.development.js`);
    }
  }
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(nextRoot, file), path.join(root, file));
  }
  fs.writeFileSync(path.join(root, 'dist/compiled/next-server/app-page-turbo.runtime.dev.js'), original);
  const production = path.join(root, 'dist/compiled/next-server/app-page.runtime.prod.js');
  fs.writeFileSync(production, 'production sentinel');
  assert.equal(patchNextFlightDebug(root), 12);
  const snapshots = files.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
  assert.equal(patchNextFlightDebug(root), 12);
  assert.deepEqual(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')), snapshots);
  assert.equal(fs.readFileSync(production, 'utf8'), 'production sentinel');
  for (const source of snapshots) assert.match(source, /retired\.previous\s*=\s*null/);
  fs.writeFileSync(path.join(root, files.at(-1)), 'changed callback');
  assert.throws(() => patchNextFlightDebug(root), /tracker changed/);
  assert.deepEqual(files.slice(0, -1).map(file => fs.readFileSync(path.join(root, file), 'utf8')), snapshots.slice(0, -1));
});
