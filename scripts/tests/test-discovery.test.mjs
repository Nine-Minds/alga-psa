import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDiscovery } from '../lib/test-discovery.mjs';

function inspect(overrides = {}) {
  return reconcileDiscovery({
    root: '/repo', today: '2026-09-06',
    candidates: ['tests/paid.test.ts'],
    collections: [{ runner: 'billing', status: 'passed', files: [{ file: '/repo/tests/paid.test.ts' }] }],
    ...overrides,
  });
}

test('inventory identifies uncollected additions and moves independently of a successful runner', () => {
  assert.equal(inspect().status, 'passed');
  const added = inspect({ candidates: ['tests/paid.test.ts', 'outside/tenant.test.ts'] });
  assert.equal(added.status, 'failed');
  assert.deepEqual(added.unmatched, ['outside/tenant.test.ts']);
  const moved = inspect({ candidates: ['moved/paid.test.ts'] });
  assert.equal(moved.status, 'failed');
  assert.deepEqual(moved.unmatched, ['moved/paid.test.ts']);
  assert.ok(moved.failures.some((failure) => failure.includes('outside candidate inventory')));
});

test('empty, missing, failed and duplicate runner collections cannot satisfy discovery', () => {
  for (const override of [
    { candidates: [] }, { collections: [] },
    { collections: [{ runner: 'billing', status: 'passed', files: [] }] },
    { collections: [{ runner: 'billing', status: 'failed', files: ['tests/paid.test.ts'] }] },
    { collections: [{ runner: 'billing', status: 'passed', files: ['tests/paid.test.ts', 'tests/paid.test.ts'] }] },
  ]) assert.equal(inspect(override).status, 'failed');
});

test('manual exclusions are explicit, owned, dated and tied to existing uncollected tests', () => {
  const exclusion = { file: 'visual/manual.test.ts', owner: 'test-maintainer', issue: 'https://example.invalid/issue/1', reason: 'Requires physical display for manual verification', expires: '2026-09-20' };
  const withExclusion = (entry) => inspect({ candidates: ['tests/paid.test.ts', exclusion.file], exclusions: [entry] });
  const result = withExclusion(exclusion);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.tests[1], { file: exclusion.file, runners: [], exclusion });
  for (const patch of [{ expires: '2026-09-06' }, { expires: '2026-02-30' }, { expires: '' }, { owner: '' }, { reason: '' }, { issue: '' }, { file: 'removed.test.ts' }]) {
    assert.equal(withExclusion({ ...exclusion, ...patch }).status, 'failed');
  }
  assert.equal(inspect({ exclusions: [{ ...exclusion, file: 'tests/paid.test.ts' }] }).status, 'failed');
});

test('identities outside the workspace cannot be counted as discovered tests', () => {
  for (const file of ['../outside.test.ts', '/outside.test.ts', '/repo']) {
    assert.throws(() => inspect({ candidates: [file] }), /outside the repository/);
  }
});
