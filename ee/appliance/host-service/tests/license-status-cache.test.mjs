import test from 'node:test';
import assert from 'node:assert/strict';
import { createLicenseStatusCache } from '../manage-engine.mjs';

const live = (n) => ({ source: 'live', liveError: null, status: 'active', n });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('concurrent callers share one license read and later callers reuse it within the TTL', async () => {
  let reads = 0;
  let clock = 0;
  const cache = createLicenseStatusCache({ read: async () => live(++reads), ttlMs: 1000, now: () => clock });
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  clock = 999;
  assert.equal((await cache.get()).n, 1);
  clock = 1000;
  assert.equal((await cache.get()).n, 2);
});

test('a degraded read (app unreachable, seed fallback) expires on the short TTL', async () => {
  let reads = 0;
  let clock = 0;
  const cache = createLicenseStatusCache({
    read: async () => ({ source: 'seed-fallback', liveError: 'app_unreachable', n: ++reads }),
    ttlMs: 60_000,
    degradedTtlMs: 100,
    now: () => clock
  });
  await cache.get();
  clock = 150;
  await cache.get();
  assert.equal(reads, 2);
});

test('invalidate during an in-flight read: that result is not cached and new callers read fresh', async () => {
  const pending = [];
  const cache = createLicenseStatusCache({ read: () => { const d = deferred(); pending.push(d); return d.promise; } });
  const before = cache.get();
  cache.invalidate(); // e.g. a license was just applied
  const after = cache.get();
  await new Promise((resolve) => setImmediate(resolve)); // reads start on a microtask
  assert.equal(pending.length, 2, 'a caller after invalidate must not join the stale read');
  pending[0].resolve(live('stale'));
  pending[1].resolve(live('fresh'));
  assert.equal((await before).n, 'stale');
  assert.equal((await after).n, 'fresh');
  assert.equal((await cache.get()).n, 'fresh');
  assert.equal(pending.length, 2);
});
