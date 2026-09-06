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

test('partitions cover every file once and do not depend on collection order', () => {
  const partitions = [1, 2, 3].map(index => partitionTestFiles(files, index, 3));
  assert.deepEqual(partitions.flat().sort(), files);
  assert.deepEqual(partitionTestFiles([...files].reverse(), 1, 3), partitions[0]);
  const result = reconcile(shards());
  assert.equal(result.status, 'passed');
  assert.equal(result.counts.passed, 5);
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
});
