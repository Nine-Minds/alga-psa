import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { verifyFreshInstallExecution } from '../verify-fresh-install-execution.mjs';

function fixture(t) {
  const input = mkdtempSync(path.join(tmpdir(), 'fresh-install-gate-'));
  t.after(() => rmSync(input, { recursive: true, force: true }));
  const root = '/repo', revision = 'a'.repeat(40);
  const api = 'server/src/test/e2e/api/clients.e2e.test.ts', browser = 'e2e-tests/tests/invoices.spec.ts';
  const evidence = { schemaVersion: 1, status: 'passed', source: {
    before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] },
  }, selection: { mode: 'full', filters: [] } };
  const write = (directory, name, value) => { mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, name), JSON.stringify(value)); };
  for (const edition of ['community', 'enterprise']) {
    const apiDir = path.join(input, `fresh-install-api-${edition}`);
    write(apiDir, 'evidence.json', evidence); write(apiDir, 'collected.json', [api]);
    write(apiDir, 'collected-tests.json', [{ file: api, name: 'persists' }]);
    write(apiDir, 'results.json', { success: true, numTotalTests: 1, testResults: [{ name: api, status: 'passed', assertionResults: [{ title: 'persists', status: 'passed' }] }] });
    const browserDir = path.join(input, `fresh-install-playwright-${edition}`, 'nested', 'execution-evidence');
    const report = { config: { rootDir: root, metadata: { edition } }, errors: [], stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
      suites: [{ specs: [{ file: browser, title: 'persists', tests: [{ projectId: edition, projectName: edition, expectedStatus: 'passed', status: 'expected', results: [{ retry: 0, status: 'passed' }] }] }] }] };
    write(browserDir, 'evidence.json', evidence); write(browserDir, 'collected.json', report); write(browserDir, 'results.json', report);
  }
  return { root, revision, input, candidates: [api, browser], shouldRun: true,
    jobResults: Object.fromEntries(['changes', 'production-browser', 'browser-collection', 'build-images'].map(name => [name, { result: 'success' }])) };
}

test('fresh-install aggregate requires both editions and detects missing artifacts and newly uncollected tests', t => {
  const input = fixture(t);
  let result = verifyFreshInstallExecution(input);
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  assert.equal(result.results.length, 4);
  input.candidates.push('e2e-tests/tests/new.spec.ts');
  assert.equal(verifyFreshInstallExecution(input).status, 'failed');
  input.candidates.pop();
  input.jobResults['build-images'].result = 'cancelled';
  assert.equal(verifyFreshInstallExecution(input).status, 'failed');
  input.jobResults['build-images'].result = 'success';
  rmSync(path.join(input.input, 'fresh-install-api-enterprise/results.json'));
  assert.equal(verifyFreshInstallExecution(input).status, 'failed');
});

test('documentation selection is explicit and still requires successful selection and browser no-op jobs', t => {
  const input = fixture(t);
  input.shouldRun = false;
  input.jobResults['browser-collection'].result = 'skipped';
  input.jobResults['build-images'].result = 'skipped';
  assert.equal(verifyFreshInstallExecution(input).status, 'not-applicable');
  input.jobResults['production-browser'].result = 'skipped';
  assert.equal(verifyFreshInstallExecution(input).status, 'failed');
  input.shouldRun = undefined;
  assert.equal(verifyFreshInstallExecution(input).status, 'failed');
});
