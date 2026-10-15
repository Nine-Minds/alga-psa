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

test('required execution evidence can reject a superficially passing raw report', () => {
  const revision = 'a'.repeat(40);
  const raw = report([{ status: 'passed', assertionResults: [assertion('passed')] }],
    { numPassedTests: 1, numPendingTests: 0, numTotalTests: 1, numFailedTestSuites: 0 });
  for (const evidence of [null, {},
    { schemaVersion: 1, revision, status: 'failed', failures: ['Missing required file'] },
    { schemaVersion: 1, revision: 'b'.repeat(40), status: 'passed', failures: [] },
    { schemaVersion: 1, revision, status: 'passed', failures: ['Unexpected skip'] },
  ]) {
    const result = testCounts(raw, evidence, revision);
    assert.equal(result.runStatus, 'partial');
    assert.equal(result.passPct, '');
    assert.equal(result.passed, 1);
  }
  assert.equal(testCounts(raw, { schemaVersion: 1, revision, status: 'passed', failures: [],
    expectedFiles: ['server/example.test.ts'], expectedTests: [{ count: 1 }] }, revision).passPct, 100);
});

function buildIsolatedRow({ results, coverage, execution, requestResults = true, context = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-report-'));
  try {
    const env = { PATH: process.env.PATH, TEST_METRICS_SUITE: 'required-tests', ...context };
    if (requestResults) env.TEST_METRICS_RESULTS = join(dir, 'results.json');
    if (results !== undefined) writeFileSync(env.TEST_METRICS_RESULTS, results);
    if (execution !== undefined) {
      env.TEST_METRICS_EXECUTION = join(dir, 'execution.json');
      if (execution !== null) writeFileSync(env.TEST_METRICS_EXECUTION, JSON.stringify(execution));
    }
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

test('the recorder loads required execution evidence from its configured path', () => {
  const row = buildIsolatedRow({
    results: JSON.stringify(report([{ status: 'passed', assertionResults: [assertion('passed')] }],
      { numPassedTests: 1, numTotalTests: 1, numPendingTests: 0, numFailedTestSuites: 0 })),
    execution: null,
    context: { GITHUB_SHA: 'a'.repeat(40) },
  });
  assert.equal(row.run_status, 'partial');
  assert.equal(row.pass_pct, '');
  assert.equal(row.passed, 1);
  assert.equal(row.execution_gate_status, 'incomplete');
  assert.equal(row.expected_files, '');
  assert.equal(row.collected_tests, '');
});

test('versioned rows preserve declared collection and the exact tested revision', () => {
  const revision = 'c'.repeat(40);
  const row = buildIsolatedRow({
    results: JSON.stringify(report([{ status: 'passed', assertionResults: [assertion('passed')] }],
      { numPassedTests: 1, numTotalTests: 1, numPendingTests: 0, numFailedTestSuites: 0 })),
    execution: { schemaVersion: 1, revision, status: 'failed', failures: ['Missing second file'],
      expectedFiles: ['server/a.test.ts', 'server/b.test.ts'],
      expectedTests: [{ identity: ['server/a.test.ts', 'saves'], count: 1 }, { identity: ['server/b.test.ts', 'rejects'], count: 2 }] },
    context: { GITHUB_SHA: revision },
  });
  assert.equal(row.expected_files, 2);
  assert.equal(row.collected_tests, 3);
  assert.equal(row.executed, 1);
  assert.equal(row.execution_gate_status, 'failed');
  assert.equal(row.tested_sha, revision);
  assert.equal(row.pass_pct, '');
});

test('a passing flag without collection counts remains incomplete', () => {
  const revision = 'c'.repeat(40);
  const row = buildIsolatedRow({
    results: JSON.stringify(report([], { numPassedTests: 1, numTotalTests: 1, numFailedTestSuites: 0 })),
    execution: { schemaVersion: 1, revision, status: 'passed', failures: [] },
    context: { GITHUB_SHA: revision },
  });
  assert.equal(row.execution_gate_status, 'incomplete');
  assert.equal(row.pass_pct, '');
});
