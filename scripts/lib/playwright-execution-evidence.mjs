import path from 'node:path';
import { normalizeTestFile } from './test-execution-evidence.mjs';

/** Keep project and nested title identity when Playwright merges JSON suites. */
export function playwrightTests(report, root) {
  if (!report || !Array.isArray(report.suites) || !report.config?.rootDir) {
    throw new Error('Missing or invalid Playwright report');
  }
  if (!Array.isArray(report.errors) || report.errors.length) {
    throw new Error('Playwright reported collection or runtime errors');
  }
  const entries = [];
  function visit(suite, titles) {
    for (const spec of suite.specs || []) {
      if (!spec.title || !Array.isArray(spec.tests) || !spec.tests.length) {
        throw new Error('Playwright spec has no named test cases');
      }
      const file = normalizeTestFile(path.resolve(report.config.rootDir, spec.file), root);
      for (const test of spec.tests) {
        if (typeof test.projectId !== 'string' || typeof test.projectName !== 'string') {
          throw new Error('Playwright test has no project identity');
        }
        entries.push({ file, projectId: test.projectId, projectName: test.projectName,
          titles: [...titles, spec.title], expectedStatus: test.expectedStatus,
          status: test.status, results: test.results });
      }
    }
    for (const child of suite.suites || []) visit(child, [...titles, child.title]);
  }
  // Top-level suite titles are file paths, not describe titles.
  for (const suite of report.suites) visit(suite, []);
  return entries;
}

export function reconcilePlaywrightExecution({ collected, report, root, revision, exitCode }) {
  const failures = [];
  const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, interrupted: 0, missing: 0 };
  let expected = [];
  let executed = [];
  try { expected = playwrightTests(collected, root); } catch (error) { failures.push(`Collection: ${error.message}`); }
  try { executed = playwrightTests(report, root); } catch (error) { failures.push(`Execution: ${error.message}`); }
  if (!expected.length) failures.push('Required browser collection is empty');
  if (exitCode !== 0) failures.push(`Browser runner exited with ${exitCode ?? 'no exit code'}`);
  const key = entry => JSON.stringify([entry.file, entry.projectId, entry.projectName, entry.titles]);
  const inventory = entries => {
    const map = new Map();
    for (const entry of entries) map.set(key(entry), (map.get(key(entry)) || 0) + 1);
    return map;
  };
  const expectedIds = inventory(expected);
  const actualIds = inventory(executed);
  for (const [identity, count] of expectedIds) {
    const actual = actualIds.get(identity) || 0;
    if (actual !== count) failures.push(`Collected/executed browser count differs: ${identity}`);
    counts.missing += Math.max(0, count - actual);
  }
  for (const identity of actualIds.keys()) {
    if (!expectedIds.has(identity)) failures.push(`Unexpected browser test: ${identity}`);
  }
  for (const entry of expected) {
    if (entry.expectedStatus !== 'passed') failures.push(`Required browser case is disabled or expects failure: ${key(entry)}`);
  }
  for (const entry of executed) {
    const results = Array.isArray(entry.results) ? entry.results : [];
    const statuses = results.map(result => result.status);
    if (entry.expectedStatus !== 'passed') failures.push(`Required browser case did not expect a pass: ${key(entry)}`);
    if (entry.status === 'flaky' || (statuses.includes('passed') && results.some(result => result.retry > 0))) {
      counts.flaky++;
    } else if (entry.status === 'skipped' || statuses.includes('skipped')) {
      counts.skipped++;
    } else if (statuses.includes('interrupted')) {
      counts.interrupted++;
    } else if (entry.status === 'expected' && results.length === 1 && results[0].status === 'passed'
      && results[0].retry === 0 && !(results[0].errors || []).length && !results[0].error
      && entry.expectedStatus === 'passed') {
      counts.passed++;
      continue;
    } else {
      counts.failed++;
    }
    failures.push(`Required browser case did not pass on its first attempt: ${key(entry)} (${entry.status})`);
  }
  const stats = report?.stats;
  if (!stats || [stats.expected, stats.unexpected, stats.skipped, stats.flaky].some(n => !Number.isInteger(n) || n < 0)
    || stats.expected + stats.unexpected + stats.skipped + stats.flaky !== executed.length) {
    failures.push('Browser report totals differ from the executed inventory');
  }
  if (stats?.flaky > 0 || stats?.unexpected > 0 || stats?.skipped > 0) {
    failures.push('Browser report contains failed, flaky or skipped cases');
  }
  return {
    schemaVersion: 1, suite: 'production-browser', revision,
    status: failures.length ? 'failed' : 'passed',
    expectedTests: [...expectedIds].map(([identity, count]) => ({ identity: JSON.parse(identity), count })),
    executedTests: [...actualIds].map(([identity, count]) => ({ identity: JSON.parse(identity), count })),
    counts, failures,
  };
}
