import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { verifyFreshInstallExecution } from '../verify-fresh-install-execution.mjs';

import { gzipSync } from 'node:zlib';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
import { browserArtifactServices, createBrowserArchiveReceipt, buildBrowserArtifactManifest } from '../lib/browser-artifact-manifest.mjs';
const revision = 'a'.repeat(40), runId = '123', runAttempt = 2;
const policy = JSON.parse(readFileSync(new URL('../browser-provider-requirements.json', import.meta.url), 'utf8'));
const manifests = {};
const archiveDir = mkdtempSync(path.join(tmpdir(), 'fresh-install-archives-'));
try {
  for (const edition of ['community', 'enterprise']) {
    const context = { revision, edition, runId, runAttempt }, components = [];
    for (const service of browserArtifactServices(edition)) {
      const archive = path.join(archiveDir, `${service}.tar.gz`);
      writeFileSync(archive, gzipSync(Buffer.alloc(1024)));
      const id = `sha256:${'1'.repeat(64)}`, digest = `sha256:${'2'.repeat(64)}`;
      const record = await recordDockerArchiveBuild({ ...context, attempt: runAttempt, service, image: 'candidate:latest',
        dockerfile: 'Dockerfile.build', platform: 'linux/amd64', configImageId: id, buildReportedDigest: digest,
        metadata: { 'containerimage.config.digest': id, 'containerimage.digest': digest } }, archive, path.join(archiveDir, `${service}.json`));
      const receipt = await createBrowserArchiveReceipt(record, archive, context);
      components.push({ record, receipt, inspection: [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': revision } } }] });
    }
    manifests[edition] = buildBrowserArtifactManifest({ ...context, components });
  }
} finally { rmSync(archiveDir, { recursive: true, force: true }); }

const landedJourneys = ['inbound-email', 'invoice-designer-persistence', 'invoice-generation', 'invoice-ticket-ownership', 'login', 'microsoft-calendar', 'microsoft-mailbox', 'microsoft-oauth-rejection', 'microsoft-webhook-validation', 'msp-access-redirects', 'portal-discovery', 'portal-identity', 'portal-ticket-roundtrip', 'qbo-export', 'server-rendered-locale', 'stripe-payment', 'tenant-identity', 'time-approval-invoice', 'usage-invoice-preview', 'xero-export'];

function fixture(t) {
  const input = mkdtempSync(path.join(tmpdir(), 'fresh-install-gate-'));
  t.after(() => rmSync(input, { recursive: true, force: true }));
  const root = '/repo', revision = 'a'.repeat(40);
  const api = 'server/src/test/e2e/api/clients.e2e.test.ts';
  const browsers = landedJourneys
    .map(name => `e2e-tests/tests/${name}.spec.ts`);
  const evidence = { schemaVersion: 1, revision, workingTreeDirty: false, status: 'passed', source: {
    before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] },
  }, selection: { mode: 'full', filters: [] } };
  const write = (directory, name, value) => { mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, name), JSON.stringify(value)); };
  for (const edition of ['community', 'enterprise']) {
    const apiDir = path.join(input, `fresh-install-api-${edition}`);
    write(apiDir, 'evidence.json', evidence); write(apiDir, 'collected.json', [api]);
    write(apiDir, 'collected-tests.json', [{ file: api, name: 'persists' }]);
    write(apiDir, 'results.json', { success: true, numTotalTests: 1, testResults: [{ name: api, status: 'passed', assertionResults: [{ title: 'persists', status: 'passed' }] }] });
    const browserDir = path.join(input, `fresh-install-playwright-${edition}`, 'alga-psa', 'alga-psa', 'e2e-tests', 'execution-evidence');
    const report = { config: { rootDir: root, metadata: { edition } }, errors: [], stats: { expected: browsers.length, unexpected: 0, skipped: 0, flaky: 0 },
      suites: [{ specs: browsers.map(file => ({ file, title: 'persists', tests: [{ projectId: edition, projectName: edition, expectedStatus: 'passed', status: 'expected', results: [{ retry: 0, status: 'passed' }] }] })) }] };
    for (const requirement of policy.editions[edition].requirements) {
      const [file, projectId, projectName, titles] = requirement.identity;
      const requests = Object.fromEntries(requirement.providers.map(({ provider }) => [provider, {
        supported: true, complete: true, generation: 1, capacity: 1000, dropped: 0, inFlight: 0,
        requests: [provider === 'smtp-sink'
          ? { sequence: 1, protocol: 'smtp', command: 'DATA', status: 250, aborted: false }
          : { sequence: 1, method: 'GET', path: '/fixture', status: 200, aborted: false }],
      }]));
      const attachment = { name: 'emulator-evidence', contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ providers: requirement.providers.map(p => p.provider), requests })).toString('base64') };
      report.suites[0].specs.push({ file, title: titles.at(-1), tests: [{ projectId, projectName,
        expectedStatus: 'passed', status: 'expected', results: [{ retry: 0, status: 'passed', attachments: [attachment] }] }] });
    }
    report.stats.expected = report.suites[0].specs.length;
    write(path.join(input, `fresh-install-playwright-${edition}`, '_temp'), 'browser-artifact-manifest.json', manifests[edition]);
    write(browserDir, 'evidence.json', evidence); write(browserDir, 'collected.json', report); write(browserDir, 'results.json', report);
  }
  return { root, revision, runId, runAttempt, input, candidates: [api, ...browsers], shouldRun: true,
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
      const directory = path.join(input.input, `fresh-install-playwright-${edition}`, 'alga-psa', 'alga-psa', 'e2e-tests', 'execution-evidence');
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
    const directory = path.join(input.input, `fresh-install-playwright-${edition}`, 'alga-psa', 'alga-psa', 'e2e-tests', 'execution-evidence');
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

for (const damage of ['missing-journal', 'wrong-provider', 'manifest', 'run', 'missing-policy-journey', 'retry']) {
  test(`provider gate rejects ${damage} despite green recorded evidence`, t => {
    const input = fixture(t);
    const directory = path.join(input.input, 'fresh-install-playwright-enterprise/alga-psa/alga-psa/e2e-tests/execution-evidence');
    const target = path.join(directory, 'results.json');
    const report = JSON.parse(readFileSync(target, 'utf8'));
    const spec = report.suites[0].specs.find(s => s.tests[0].results[0].attachments);
    if (damage === 'missing-journal') spec.tests[0].results[0].attachments = [];
    if (damage === 'wrong-provider') spec.tests[0].results[0].attachments[0].body = Buffer.from(JSON.stringify({ providers: ['invented'], requests: {} })).toString('base64');
    if (damage === 'manifest') writeFileSync(path.join(input.input, 'fresh-install-playwright-enterprise/_temp/browser-artifact-manifest.json'), '{}');
    if (damage === 'run') input.runId = '999';
    if (damage === 'missing-policy-journey') {
      report.suites[0].specs = report.suites[0].specs.filter(s => s !== spec);
      writeFileSync(path.join(directory, 'collected.json'), JSON.stringify(report));
    }
    if (damage === 'retry') {
      spec.tests[0].status = 'flaky';
      spec.tests[0].results.unshift({ retry: 0, status: 'failed' });
      spec.tests[0].results[1].retry = 1;
    }
    writeFileSync(target, JSON.stringify(report));
    assert.equal(verifyFreshInstallExecution(input).status, 'failed');
  });
}

for (const damage of ['diagnostics-only', 'missing-canonical', 'ambiguous-canonical']) test(`canonical browser bundle selection: ${damage}`, t => {
  const input = fixture(t);
  const artifact = path.join(input.input, 'fresh-install-playwright-community');
  const canonical = path.join(artifact, 'alga-psa/alga-psa/e2e-tests/execution-evidence');
  const decoy = path.join(artifact, damage === 'ambiguous-canonical' ? 'other/e2e-tests/execution-evidence' : 'alga-psa/alga-psa/e2e-tests/harness-results/passing');
  mkdirSync(decoy, { recursive: true });
  for (const name of ['evidence.json', 'collected.json', 'results.json']) writeFileSync(path.join(decoy, name), readFileSync(path.join(canonical, name)));
  if (damage === 'missing-canonical') rmSync(canonical, { recursive: true });
  const result = verifyFreshInstallExecution(input);
  assert.equal(result.status, damage === 'diagnostics-only' ? 'passed' : 'failed', result.failures.join('\n'));
});

for (const damage of ['diagnostics-only', 'missing-canonical', 'ambiguous-canonical']) test(`canonical manifest selection: ${damage}`, t => {
  const input = fixture(t);
  const artifact = path.join(input.input, 'fresh-install-playwright-community');
  const canonical = path.join(artifact, '_temp/browser-artifact-manifest.json');
  const decoy = path.join(artifact, damage === 'ambiguous-canonical' ? 'other/_temp' : 'diagnostics');
  mkdirSync(decoy, { recursive: true });
  writeFileSync(path.join(decoy, 'browser-artifact-manifest.json'), readFileSync(canonical));
  if (damage === 'missing-canonical') rmSync(canonical);
  const result = verifyFreshInstallExecution(input);
  assert.equal(result.status, damage === 'diagnostics-only' ? 'passed' : 'failed', result.failures.join('\n'));
});
