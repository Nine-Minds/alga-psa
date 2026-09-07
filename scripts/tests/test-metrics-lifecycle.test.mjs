import test from 'node:test';
import assert from 'node:assert/strict';
import { testCounts } from '../record-test-metrics.mjs';

const assertion = status => ({ status });
function report(testResults, counts = {}) {
  return { numPassedTests: 100, numFailedTests: 0, numPendingTests: 2,
    numTotalTests: 102, numFailedTestSuites: 1, testResults, ...counts };
}

test('a failed suite bootstrap cannot publish 100% from successful sibling tests', () => {
  const result = testCounts(report([
    { status: 'passed', assertionResults: Array.from({ length: 100 }, () => assertion('passed')) },
    { status: 'failed', assertionResults: [assertion('skipped'), assertion('skipped')] },
  ]));
  assert.equal(result.passed, 100);
  assert.equal(result.skipped, 2);
  assert.equal(result.runStatus, 'partial');
  assert.equal(result.passPct, '');
});

test('teardown failure invalidates the percentage even when every assertion passed', () => {
  const result = testCounts(report([
    { status: 'failed', assertionResults: [assertion('passed')] },
  ], { numPassedTests: 1, numPendingTests: 0, numTotalTests: 1 }));
  assert.equal(result.runStatus, 'partial');
  assert.equal(result.passPct, '');
});

test('an assertion failure remains a completed run with a non-green percentage', () => {
  const result = testCounts(report([
    { status: 'failed', assertionResults: [assertion('passed'), assertion('failed')] },
  ], { numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, numTotalTests: 2 }));
  assert.equal(result.runStatus, 'complete');
  assert.equal(result.passPct, 50);
});

test('a fully passing suite keeps legacy counts and percentage', () => {
  const result = testCounts(report([
    { status: 'passed', assertionResults: [assertion('passed')] },
  ], { numPassedTests: 1, numPendingTests: 0, numTotalTests: 1, numFailedTestSuites: 0 }));
  assert.equal(result.runStatus, 'complete');
  assert.equal(result.passPct, 100);
});
