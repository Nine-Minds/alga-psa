import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileExecution } from '../lib/test-execution-evidence.mjs';

const root = '/repo';
function evidence(change = {}) {
  return reconcileExecution({
    root, suite: 'db', revision: 'fixture', exitCode: 0,
    collected: [{ file: '/repo/tests/a.test.ts' }],
    report: { success: true, numTotalTests: 1, testResults: [{ name: '/repo/tests/a.test.ts', status: 'passed', assertionResults: [{ fullName: 'persists', status: 'passed' }] }] },
    ...change,
  });
}
test('complete executed collection passes with normalized identities', () => {
  const result = evidence();
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.expectedFiles, ['tests/a.test.ts']);
  assert.equal(result.counts.passed, 1);
});
test('missing, empty, cancelled and unsuccessful runs cannot be green', () => {
  for (const change of [
    { collected: [] }, { report: null }, { exitCode: null }, { exitCode: 1 },
    { collected: [{ file: '/repo/tests/moved.test.ts' }] },
    { report: { success: true, numTotalTests: 0, testResults: [] } },
  ]) assert.equal(evidence(change).status, 'failed');
});
test('intentional skipped/todo assertions remain distinct from interrupted assertions', () => {
  const report = { success: true, numTotalTests: 3, testResults: [{ name: '/repo/tests/a.test.ts', status: 'passed', assertionResults: [
    { status: 'passed' }, { status: 'skipped' }, { status: 'todo' },
  ] }] };
  assert.equal(evidence({ report }).status, 'passed');
  report.testResults[0].assertionResults[1].status = 'pending';
  assert.equal(evidence({ report }).status, 'failed');
  report.testResults[0].assertionResults = [{ status: 'skipped' }];
  report.numTotalTests = 1;
  assert.equal(evidence({ report }).status, 'failed');
});
test('collection errors and inconsistent reports are rejected even with successful exit status', () => {
  for (const override of [{ success: false }, { numTotalTests: 2 }, { numRuntimeErrorTestSuites: 1 }]) {
    const report = { success: true, numTotalTests: 1, testResults: [{ name: '/repo/tests/a.test.ts', status: 'passed', assertionResults: [{ status: 'passed' }] }], ...override };
    assert.equal(evidence({ report }).status, 'failed');
  }
});
