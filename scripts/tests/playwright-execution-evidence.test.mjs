import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePlaywrightExecution, playwrightTests } from '../lib/playwright-execution-evidence.mjs';

function report() {
  return {
    config: { rootDir: '/repo/e2e-tests/tests' }, errors: [],
    suites: [{ title: 'invoice.spec.ts', file: 'invoice.spec.ts', specs: [], suites: [{
      title: 'invoice', specs: [{ title: 'retains balance', file: 'invoice.spec.ts', tests: [{
        projectId: 'ce', projectName: 'community', expectedStatus: 'passed', status: 'expected',
        results: [{ status: 'passed', retry: 0, errors: [] }],
      }] }],
    }] }],
    stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
  };
}
function check(change = {}) {
  return reconcilePlaywrightExecution({ root: '/repo', revision: 'fixture', exitCode: 0, collected: report(), report: report(), ...change });
}
function one(data) { return data.suites[0].suites[0].specs[0].tests[0]; }

test('browser identities preserve nested titles, project and repeated cases', () => {
  const data = report();
  const spec = data.suites[0].suites[0].specs[0];
  spec.tests.push(structuredClone(one(data)), { ...structuredClone(one(data)), projectId: 'ee', projectName: 'enterprise' });
  data.stats.expected = 3;
  const result = check({ collected: data, report: data });
  assert.equal(result.status, 'passed');
  assert.equal(result.counts.passed, 3);
  assert.deepEqual(result.expectedTests[0], { identity: ['e2e-tests/tests/invoice.spec.ts', 'ce', 'community', ['invoice', 'retains balance']], count: 2 });
});

test('missing and changed browser cases cannot hide behind a successful exit', () => {
  for (const mutate of [
    data => { data.suites = []; data.stats.expected = 0; },
    data => { one(data).projectId = 'other-edition'; },
    data => { data.suites[0].suites[0].title = 'changed context'; },
    data => { data.suites[0].suites[0].specs[0].title = 'different test'; },
    data => { one(data).results = []; },
    data => { data.suites[0].suites[0].specs[0].tests.push(structuredClone(one(data))); data.stats.expected = 2; },
  ]) {
    const data = report(); mutate(data);
    assert.equal(check({ report: data }).status, 'failed');
  }
});

test('failed, timed-out, skipped, expected-failure and interrupted cases cannot satisfy the gate', () => {
  for (const status of ['failed', 'timedOut', 'skipped', 'interrupted', 'unknown']) {
    const data = report();
    one(data).results[0].status = status;
    assert.equal(check({ report: data }).status, 'failed');
  }
  const data = report();
  one(data).expectedStatus = 'failed';
  one(data).results[0].status = 'failed';
  assert.equal(check({ collected: data, report: data }).status, 'failed');
  one(data).expectedStatus = 'skipped';
  assert.equal(check({ collected: data }).status, 'failed');
});

test('retry-only passes remain flaky even when runner exit or outcome is misleading', () => {
  const data = report();
  one(data).results = [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }];
  for (const outcome of ['flaky', 'expected']) {
    one(data).status = outcome;
    const result = check({ report: data });
    assert.equal(result.status, 'failed');
    assert.equal(result.counts.flaky, 1);
  }
});

test('absent, empty, cancelled and malformed browser reports fail explicitly', () => {
  for (const change of [{ collected: null }, { report: null }, { exitCode: null }, { exitCode: 1 }]) {
    assert.equal(check(change).status, 'failed');
  }
  for (const mutate of [
    data => { data.suites = []; data.stats.expected = 0; },
    data => { data.errors = [{ message: 'beforeAll failed' }]; },
    data => { data.stats.expected = 2; },
    data => { data.stats.flaky = 1; },
    data => { delete one(data).projectId; },
    data => { one(data).results[0].error = { message: 'unhandled error' }; },
    data => { data.suites[0].suites[0].specs[0].file = '../../../outside.spec.ts'; },
  ]) {
    const data = report(); mutate(data);
    assert.equal(check({ report: data }).status, 'failed');
  }
  assert.throws(() => playwrightTests(null, '/repo'), /invalid Playwright report/);
});
