import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { verifyFreshInstallExecution } from '../verify-fresh-install-execution.mjs';

const landedJourneys = ['inbound-email', 'invoice-designer-persistence', 'invoice-generation', 'invoice-ticket-ownership', 'login', 'microsoft-calendar', 'microsoft-mailbox', 'microsoft-oauth-rejection', 'msp-access-redirects', 'portal-discovery', 'portal-identity', 'portal-ticket-roundtrip', 'qbo-export', 'server-rendered-locale', 'stripe-payment', 'tenant-identity', 'time-approval-invoice', 'usage-invoice-preview', 'xero-export'];

function fixture(t) {
  const input = mkdtempSync(path.join(tmpdir(), 'fresh-install-gate-'));
  t.after(() => rmSync(input, { recursive: true, force: true }));
  const root = '/repo', revision = 'a'.repeat(40);
  const api = 'server/src/test/e2e/api/clients.e2e.test.ts';
  const browsers = landedJourneys
    .map(name => `e2e-tests/tests/${name}.spec.ts`);
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
    const report = { config: { rootDir: root, metadata: { edition } }, errors: [], stats: { expected: browsers.length, unexpected: 0, skipped: 0, flaky: 0 },
      suites: [{ specs: browsers.map(file => ({ file, title: 'persists', tests: [{ projectId: edition, projectName: edition, expectedStatus: 'passed', status: 'expected', results: [{ retry: 0, status: 'passed' }] }] })) }] };
    write(browserDir, 'evidence.json', evidence); write(browserDir, 'collected.json', report); write(browserDir, 'results.json', report);
  }
  return { root, revision, input, candidates: [api, ...browsers], shouldRun: true,
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

test('critical browser journeys cannot disappear from both checkout inventory and green reports', t => {
  for (const name of landedJourneys) {
    const input = fixture(t);
    const file = `e2e-tests/tests/${name}.spec.ts`;
    input.candidates = input.candidates.filter(candidate => candidate !== file);
    for (const edition of ['community', 'enterprise']) {
      const directory = path.join(input.input, `fresh-install-playwright-${edition}`, 'nested', 'execution-evidence');
      for (const artifact of ['collected.json', 'results.json']) {
        const target = path.join(directory, artifact);
        const report = JSON.parse(readFileSync(target, 'utf8'));
        report.suites[0].specs = report.suites[0].specs.filter(spec => spec.file !== file);
        report.stats.expected--;
        writeFileSync(target, JSON.stringify(report));
      }
    }
    const result = verifyFreshInstallExecution(input);
    assert.equal(result.status, 'failed', `deleted journey ${name}`);
    for (const edition of ['community', 'enterprise']) {
      assert.ok(result.failures.some(message => message.includes(`playwright-${edition}: Uncollected candidate: ${file}`)));
    }
  }
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

test('newly executed browser journeys must join the permanent floor before they can pass', t => {
  const input = fixture(t);
  const file = 'e2e-tests/tests/new-required-journey.spec.ts';
  input.candidates.push(file);
  for (const edition of ['community', 'enterprise']) {
    const directory = path.join(input.input, `fresh-install-playwright-${edition}`, 'nested', 'execution-evidence');
    for (const artifact of ['collected.json', 'results.json']) {
      const target = path.join(directory, artifact);
      const report = JSON.parse(readFileSync(target, 'utf8'));
      report.suites[0].specs.push({ ...structuredClone(report.suites[0].specs[0]), file });
      report.stats.expected++;
      writeFileSync(target, JSON.stringify(report));
    }
  }
  const result = verifyFreshInstallExecution(input);
  assert.equal(result.status, 'failed');
  assert.ok(result.failures.some(message => message.includes(`Unregistered mandatory browser journey: ${file}`)));
});
