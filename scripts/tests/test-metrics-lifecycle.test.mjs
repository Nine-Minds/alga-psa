import test from 'node:test';
import assert from 'node:assert/strict';
import { testCounts } from '../record-test-metrics.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function buildIsolatedRow({ results, coverage, requestResults = true, context = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-report-'));
  try {
    const env = { PATH: process.env.PATH, TEST_METRICS_SUITE: 'required-tests', ...context };
    if (requestResults) env.TEST_METRICS_RESULTS = join(dir, 'results.json');
    if (results !== undefined) writeFileSync(env.TEST_METRICS_RESULTS, results);
    if (coverage) {
      env.TEST_METRICS_COVERAGE = join(dir, 'coverage.json');
      writeFileSync(env.TEST_METRICS_COVERAGE, JSON.stringify(coverage));
    }
    const moduleUrl = new URL('../record-test-metrics.mjs', import.meta.url).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { buildRow, HEADER } from ${JSON.stringify(moduleUrl)};
       const row = buildRow();
       console.log(JSON.stringify(Object.fromEntries(HEADER.map((key, index) => [key, row[index]]))));`],
    { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(output);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('missing and malformed required reports remain visible without invented zero counts', () => {
  for (const results of [undefined, '{broken']) {
    const row = buildIsolatedRow({ results });
    assert.equal(row.suite, 'required-tests');
    assert.equal(row.run_status, 'partial');
    assert.equal(row.passed, '');
    assert.equal(row.executed, '');
    assert.equal(row.pass_pct, '');
  }
});

test('coverage cannot conceal an explicitly requested missing test report', () => {
  const row = buildIsolatedRow({ coverage: { total: { lines: { pct: 80 } } } });
  assert.equal(row.run_status, 'partial');
  assert.equal(row.lines_pct, 80);
  assert.equal(row.pass_pct, '');
});

test('intentional coverage-only reporting preserves its legacy blank execution status', () => {
  const row = buildIsolatedRow({ requestResults: false, coverage: { total: { lines: { pct: 80 } } } });
  assert.equal(row.run_status, '');
  assert.equal(row.lines_pct, 80);
  assert.equal(row.executed, '');
});

test('versioned metrics distinguish CI event kinds without changing original counts', () => {
  for (const [event, branch, kind] of [
    ['pull_request', '3343/merge', 'pr'],
    ['push', 'main', 'main'],
    ['push', 'feature', 'branch'],
    ['schedule', 'main', 'nightly'],
    ['workflow_dispatch', 'main', 'manual'],
    ['repository_dispatch', 'main', 'other'],
  ]) {
    const row = buildIsolatedRow({
      results: JSON.stringify(report([{ status: 'passed', assertionResults: [assertion('passed')] }],
        { numPassedTests: 1, numTotalTests: 1, numPendingTests: 0, numFailedTestSuites: 0 })),
      context: { GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: branch },
    });
    assert.equal(row.schema_version, 2);
    assert.equal(row.event_name, event);
    assert.equal(row.run_kind, kind);
    assert.equal(row.passed, 1);
    assert.equal(row.pass_pct, 100);
    assert.equal(row.coverage_methodology, '');
  }
});

test('coverage-only rows identify their measured-source methodology', () => {
  const row = buildIsolatedRow({ requestResults: false, coverage: { total: { lines: { pct: 80 } } } });
  assert.equal(row.schema_version, 2);
  assert.equal(row.run_kind, 'local');
  assert.equal(row.coverage_methodology, 'v8-loaded-files/source-inventory-v1');
});
