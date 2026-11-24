import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionTestFiles, reconcileTestShards } from '../lib/test-sharding.mjs';

const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts', 'e.test.ts'];
function shards() {
  return [1, 2, 3].map(index => {
    const assigned = partitionTestFiles(files, index, 3);
    return { suite: 'infrastructure', revision: 'abc', status: 'passed', failures: [],
      source: { before: { revision: 'abc' }, after: { revision: 'abc' } },
      expectedFiles: assigned, executedFiles: assigned,
      counts: { passed: assigned.length, failed: 0, skipped: 0, todo: 0, pending: 0 },
      selection: { mode: 'full', allFiles: files, shard: { index, total: 3 } } };
  });
}
const reconcile = entries => reconcileTestShards({ shards: entries, suite: 'infrastructure', revision: 'abc', mode: 'full', total: 3 });

test('malformed uploaded inventories return failed evidence with unknown counts instead of throwing', () => {
  for (const invalid of [null, {}, 'a.test.ts']) {
    const result = reconcile(invalid);
    assert.equal(result.status, 'failed');
    assert.equal(result.counts, null);
    assert.ok(result.failures.length);
  }
  for (const mutate of [
    entries => { entries[0] = null; },
    entries => { entries[0].selection.allFiles = 'a.test.ts'; },
    entries => { entries[0].selection.allFiles = ['a.test.ts', null]; },
    entries => { entries[0].expectedFiles = {}; },
    entries => { entries[0].executedFiles = {}; },
    entries => { entries[0].executedFiles = ['a.test.ts', 12]; },
    entries => { delete entries[0].selection; },
  ]) {
    const entries = shards(); mutate(entries);
    const result = reconcile(entries);
    assert.equal(result.status, 'failed');
    assert.equal(result.counts, null);
    assert.ok(result.failures.length);
  }
});

test('partitions cover every file once and do not depend on collection order', () => {
  const partitions = [1, 2, 3].map(index => partitionTestFiles(files, index, 3));
  assert.deepEqual(partitions.flat().sort(), files);
  assert.deepEqual(partitionTestFiles([...files].reverse(), 1, 3), partitions[0]);
  const result = reconcile(shards());
  assert.equal(result.status, 'passed');
  assert.equal(result.counts.passed, 5);
});
test('weighted partitions balance by duration, cover every file once and ignore collection order', () => {
  // Heaviest first onto the lightest shard: a(40) -> 1, b(30) -> 2, c(20) -> 3,
  // d(10) -> 3, e(10) -> 2, so 40 / 40 / 30 where the modulo split gives
  // a+d / b+e / c = 50 / 40 / 20.
  const weights = { 'a.test.ts': 40, 'b.test.ts': 30, 'c.test.ts': 20, 'd.test.ts': 10, 'e.test.ts': 10 };
  const partitions = [1, 2, 3].map(index => partitionTestFiles(files, index, 3, weights));
  assert.deepEqual(partitions, [['a.test.ts'], ['b.test.ts', 'e.test.ts'], ['c.test.ts', 'd.test.ts']]);
  assert.deepEqual(partitions.flat().sort(), files);
  assert.deepEqual(partitionTestFiles([...files].reverse(), 2, 3, weights), partitions[1]);
  // Unknown files weigh the median of the known ones, so a new file never
  // skews a shard; equal weights then fall by name onto the lowest shard, which
  // is plain round-robin.
  assert.deepEqual([1, 2, 3].map(index => partitionTestFiles(files, index, 3, { 'a.test.ts': 40, 'b.test.ts': 40 })),
    [['a.test.ts', 'd.test.ts'], ['b.test.ts', 'e.test.ts'], ['c.test.ts']]);
  // Equal weights everywhere degrade to round-robin by name: still every file once.
  assert.deepEqual([1, 2, 3].map(index => partitionTestFiles(files, index, 3, {})).flat().sort(), files);
  for (const invalid of [{ 'a.test.ts': -1 }, { 'a.test.ts': 'fast' }, { 'a.test.ts': Number.NaN }, ['a.test.ts'], 7]) {
    assert.throws(() => partitionTestFiles(files, 1, 3, invalid));
  }
  // The reunion must verify against the same weights, or the balanced shards read as misassigned.
  const weighted = [1, 2, 3].map(index => {
    const assigned = partitionTestFiles(files, index, 3, weights);
    return { ...shards()[index - 1], expectedFiles: assigned, executedFiles: assigned,
      counts: { passed: assigned.length, failed: 0, skipped: 0, todo: 0, pending: 0 } };
  });
  assert.equal(reconcileTestShards({ shards: weighted, suite: 'infrastructure', revision: 'abc', mode: 'full', total: 3, weights }).status, 'passed');
  assert.equal(reconcile(weighted).status, 'failed');
});

test('invalid, duplicate and empty partitions fail before test execution', () => {
  for (const [entries, index, total] of [[[], 1, 1], [files, 0, 3], [files, 4, 3], [files, 1, 0], [files, 1.5, 3], [files, 6, 6], [['a', 'a'], 1, 1]]) {
    assert.throws(() => partitionTestFiles(entries, index, total));
  }
});
test('missing, failed, duplicate, stale and incorrectly assigned shards reject readiness', () => {
  for (const mutate of [
    entries => entries.pop(),
    entries => { entries[0].status = 'failed'; },
    entries => { entries[0].revision = 'older'; },
    entries => { entries[0].source.after.revision = 'newer'; },
    entries => { entries[0].selection.mode = 'tier1'; },
    entries => { entries[0].selection.shard.total = 2; },
    entries => { entries[1] = structuredClone(entries[0]); },
    entries => { entries[0].selection.allFiles = ['a.test.ts']; },
    entries => { entries[0].executedFiles = [files[1]]; },
    entries => { entries[0].counts.skipped = 1; },
    entries => { entries[0].counts.passed = 0; },
    entries => { entries[0].failures.push('runtime error'); },
  ]) {
    const entries = shards(); mutate(entries);
    assert.equal(reconcile(entries).status, 'failed');
  }
  assert.equal(reconcile([]).status, 'failed');
  for (const jobResult of ['failure', 'cancelled', 'skipped', '']) {
    assert.equal(reconcileTestShards({ shards: shards(), suite: 'infrastructure', revision: 'abc', mode: 'full', total: 3, jobResult }).status, 'failed');
  }
});
