import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyFlakyPolicy, flakyPolicy, publishFlakyTests, resetFlakyPublication } from '../lib/flaky-policy.mjs';

// Four lanes share this module, so the warn-or-fail decision is pinned here
// once. See ee/docs/plans/2026-09-05-production-regression-prevention/flaky-retry-policy.md.
test('a retry-only pass warns on a pull request and fails every other event', () => {
  const tests = [{ testId: 'src/test/unit/a.test.ts > recovers' }, { testId: 'src/test/unit/b.test.ts > settles' }];
  assert.deepEqual(flakyPolicy({ tests, eventName: 'pull_request' }), {
    warnings: ['::warning::Flaky test passed only on retry: src/test/unit/a.test.ts > recovers',
      '::warning::Flaky test passed only on retry: src/test/unit/b.test.ts > settles'],
    failures: [],
  });
  // push, schedule, release and workflow_dispatch all fail the lane, and so does
  // an unset event: the strict path is the default, not the exception.
  for (const [eventName, reported] of [['push', 'push'], ['schedule', 'schedule'], ['release', 'release'],
    ['workflow_dispatch', 'workflow_dispatch'], [undefined, 'unknown'], ['', 'unknown']]) {
    assert.deepEqual(flakyPolicy({ tests: tests.slice(0, 1), eventName }), { warnings: [],
      failures: [`retry-only pass on ${reported} run: src/test/unit/a.test.ts > recovers`] });
  }
  // Nothing retried, nothing to say — on any event.
  for (const eventName of ['pull_request', 'push']) {
    assert.deepEqual(flakyPolicy({ tests: [], eventName }), { warnings: [], failures: [] });
    assert.deepEqual(flakyPolicy({ tests: null, eventName }), { warnings: [], failures: [] });
    assert.deepEqual(flakyPolicy({ tests: [{}, { testId: '' }, 7], eventName }), { warnings: [], failures: [] });
  }
  assert.deepEqual(flakyPolicy(), { warnings: [], failures: [] });
});

test('only a run that retried something fills the upload directory', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-flaky-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const documentPath = path.join(root, 'evidence/flaky-tests.json');
  const directory = path.join(root, 'upload');
  const uploaded = path.join(directory, 'flaky-tests.json');
  mkdirSync(path.dirname(documentPath), { recursive: true });
  const write = document => writeFileSync(documentPath, JSON.stringify(document, null, 2) + '\n');

  const document = { schemaVersion: 1, suite: 'integration', job: 'integration shard 1/1',
    tests: [{ testId: 'src/test/integration/a.test.ts > recovers', file: 'src/test/integration/a.test.ts',
      name: 'recovers', retryCount: 1 }] };
  write(document);
  const warnings = [];
  const applied = applyFlakyPolicy({ documentPath, directory, eventName: 'pull_request', log: line => warnings.push(line) });
  assert.deepEqual(applied.failures, []);
  assert.deepEqual(warnings, ['::warning::Flaky test passed only on retry: src/test/integration/a.test.ts > recovers']);
  assert.deepEqual(JSON.parse(readFileSync(uploaded, 'utf8')), document);

  // A rerun that retried nothing must not leave the previous attempt published.
  resetFlakyPublication(directory);
  write({ ...document, tests: [] });
  assert.deepEqual(publishFlakyTests({ documentPath, directory }), []);
  assert.equal(existsSync(directory), false);

  // A shard that died before the reporter ran leaves the initialized null, and
  // reporting a flake never fails the lane.
  writeFileSync(documentPath, 'null\n');
  assert.deepEqual(publishFlakyTests({ documentPath, directory }), []);
  writeFileSync(documentPath, 'not json');
  assert.deepEqual(publishFlakyTests({ documentPath, directory }), []);
  assert.deepEqual(publishFlakyTests({ documentPath: path.join(root, 'absent.json'), directory }), []);
  assert.equal(existsSync(directory), false);
  // Wiping an upload directory that was never created is not an error either.
  resetFlakyPublication(directory);
});
