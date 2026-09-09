import test from 'node:test';
import assert from 'node:assert/strict';
import { browserTestMetrics } from '../lib/browser-test-metrics.mjs';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const revision = 'a'.repeat(40);
function report(results = [{ status: 'passed', retry: 0 }], status = 'expected') {
  return { config: { rootDir: '/repo/e2e-tests/tests', metadata: { edition: 'enterprise', authentication: 'real-credentials' } },
    errors: [], suites: [{ specs: [{ file: 'invoice.spec.ts', title: 'invoice settles once', tests: [{
      projectId: 'ee', projectName: 'enterprise', expectedStatus: 'passed', status, results,
    }] }] }], stats: { expected: status === 'expected' ? 1 : 0, flaky: status === 'flaky' ? 1 : 0, unexpected: 0, skipped: 0 } };
}
const cleanEvidence = () => ({ revision, status: 'passed', workingTreeDirty: false,
  source: { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } } });
const check = (overrides = {}) => browserTestMetrics({ root: '/repo', revision,
  collected: report([]), report: report(), evidence: cleanEvidence(), ...overrides });

test('journey reporting retains identity, edition and first attempt without inventing artifact identity', () => {
  const result = check();
  assert.equal(result.status, 'passed');
  assert.equal(result.configuration.edition, 'enterprise');
  assert.equal(result.artifactManifest, null);
  assert.equal(result.collected, 1);
  assert.equal(result.executed, 1);
  assert.deepEqual(result.journeys[0].identity, ['e2e-tests/tests/invoice.spec.ts', 'ee', 'enterprise', ['invoice settles once']]);
  assert.equal(result.journeys[0].firstAttempt, 'passed');
});

test('retry-only passes remain failed and raw error secrets are not copied', () => {
  const result = check({ report: report([{ status: 'failed', retry: 0, error: { message: 'synthetic-secret' } },
    { status: 'passed', retry: 1 }], 'flaky') });
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.flaky, 1);
  assert.equal(result.journeys[0].firstAttempt, 'failed');
  assert.equal(result.journeys[0].retryCount, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});

test('missing execution preserves the expected journey as incomplete', () => {
  const result = check({ report: null });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.collected, 1);
  assert.equal(result.executed, 0);
  assert.equal(result.journeys[0].outcome, 'missing');
});

test('a mismatched candidate or failed outer gate cannot become passed', () => {
  for (const evidence of [{ revision: 'b'.repeat(40), status: 'passed' }, { revision, status: 'failed' }]) {
    assert.equal(check({ evidence }).status, 'failed');
  }
});

test('the actual browser runner emits incomplete metrics when execution cannot start', t => {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const root = mkdtempSync(path.join(tmpdir(), 'browser-metrics-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'e2e-tests'), { recursive: true });
  mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
  for (const file of ['e2e-tests/run.mjs', 'scripts/verify-docker-archive-build.mjs', ...['browser-test-metrics', 'browser-artifact-manifest', 'test-discovery', 'test-revision',
    'test-execution-evidence', 'playwright-execution-evidence'].map(name => `scripts/lib/${name}.mjs`)]) {
    cpSync(path.join(repository, file), path.join(root, file));
  }
  const result = spawnSync(process.execPath, ['e2e-tests/run.mjs', '--unsupported-filter'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const metrics = JSON.parse(readFileSync(path.join(root, 'e2e-tests/execution-evidence/metrics.json'), 'utf8'));
  assert.equal(metrics.schemaVersion, 2);
  assert.equal(metrics.status, 'incomplete');
  assert.equal(metrics.collected, 0);
  assert.equal(metrics.executed, 0);
  assert.equal(metrics.revision, null);
});

test('configured missing or invalid artifact provenance cannot publish complete metrics', () => {
  for (const artifactManifest of [null, {}, { revision, image: 'latest' }]) {
    const result = check({ artifactManifest, artifactManifestRequired: true });
    assert.equal(result.status, 'incomplete');
    assert.equal(result.artifactManifest, null);
    assert.equal(result.collected, 1);
    assert.equal(result.executed, 1);
    assert.equal(result.journeys[0].firstAttempt, 'passed');
    assert.ok(result.failures.includes('Missing or invalid CI test artifact identity'));
  }
});

test('dirty, missing and changed source evidence cannot produce passed readiness metrics', () => {
  for (const mutate of [
    evidence => { evidence.workingTreeDirty = true; },
    evidence => { delete evidence.source; },
    evidence => { evidence.source.before.dirty = true; },
    evidence => { evidence.source.after.changes = [{ file: 'changed.ts' }]; },
    evidence => { evidence.source.after.revision = 'b'.repeat(40); },
  ]) {
    const evidence = cleanEvidence(); mutate(evidence);
    assert.equal(check({ evidence }).status, 'failed');
  }
});

test('provider observations bind real-format attachments to verified archives without exporting payloads', async t => {
  const { writeFile } = await import('node:fs/promises');
  const { gzipSync } = await import('node:zlib');
  const { recordDockerArchiveBuild } = await import('../record-docker-archive-build.mjs');
  const { browserArtifactServices, createBrowserArchiveReceipt, buildBrowserArtifactManifest } = await import('../lib/browser-artifact-manifest.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'provider-metrics-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const context = { revision, edition: 'enterprise', runId: '123', runAttempt: 2 };
  const components = [];
  for (const service of browserArtifactServices('enterprise')) {
    const archive = path.join(dir, `${service}.tar.gz`);
    await writeFile(archive, gzipSync(Buffer.alloc(1024)));
    const id = `sha256:${'1'.repeat(64)}`, digest = `sha256:${'2'.repeat(64)}`;
    const record = await recordDockerArchiveBuild({ ...context, attempt: 2, service, image: 'candidate:latest', dockerfile: 'Dockerfile.build', platform: 'linux/amd64', configImageId: id, buildReportedDigest: digest,
      metadata: { 'containerimage.config.digest': id, 'containerimage.digest': digest } }, archive, path.join(dir, `${service}.json`));
    const receipt = await createBrowserArchiveReceipt(record, archive, context);
    components.push({ record, receipt, inspection: [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': revision } } }] });
  }
  const manifest = buildBrowserArtifactManifest({ ...context, components });
  const data = () => ({ controlOrigin: 'http://sensitive-host:9500', providers: ['xero'], operations: [{ body: 'secret-value' }], requests: {
    xero: { supported: true, complete: true, generation: 1, capacity: 1000, dropped: 0, inFlight: 0,
      requests: [{ sequence: 1, method: 'GET', path: '/sensitive-path', status: 200, aborted: false, body: 'secret-value' }] },
  } });
  const attachment = value => ({ name: 'emulator-evidence', contentType: 'application/json', body: Buffer.from(JSON.stringify(value)).toString('base64') });
  const execute = (attachments, overrides = {}) => check({ artifactManifest: manifest, runId: '123', runAttempt: 2,
    report: report([{ status: 'passed', retry: 0, attachments }]), ...overrides });
  const result = execute([attachment(data())]);
  const observation = result.journeys[0].attempts[0].providerObservations;
  assert.equal(result.status, 'passed');
  assert.equal(observation.status, 'observed');
  assert.equal(observation.revision, revision);
  assert.equal(observation.runAttempt, 2);
  assert.equal(observation.retry, 0);
  const { createHash } = await import('node:crypto');
  assert.equal(observation.artifactManifestSha256, createHash('sha256').update(JSON.stringify(manifest)).digest('hex'));
  assert.equal(execute([attachment(data())], { report: report([{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1, attachments: [attachment(data())] }], 'flaky') }).journeys[0].attempts[1].providerObservations.retry, 1);
  assert.deepEqual(observation.providers, [{ provider: 'xero', mode: 'emulator', supported: true, complete: true, requestCount: 1, dropped: 0, inFlight: 0 }]);
  for (const secret of ['sensitive-host', 'sensitive-path', 'secret-value']) assert.ok(!JSON.stringify(result).includes(secret));
  for (const mutate of [
    d => { d.providers = ['invented']; },
    d => { d.providers.push('xero'); },
    d => { d.requests.xero.complete = false; },
    d => { d.requests.xero.dropped = -1; },
    d => { d.requests.xero.requests[0].status = '200'; },
    d => { d.requests.xero.requests[0].status = null; },
    d => { d.requests.xero.requests[0].aborted = true; },
    d => { d.requests.xero.requests.push(d.requests.xero.requests[0]); },
    d => { delete d.requests.xero; },
  ]) {
    const malformed = data(); mutate(malformed);
    assert.equal(execute([attachment(malformed)]).journeys[0].attempts[0].providerObservations.reason, 'malformed-observations');
  }
  for (const attachments of [[{ name: 'emulator-evidence', contentType: 'application/json', path: '/do-not-read' }],
    [{ ...attachment(data()), body: 'not-base64!' }]]) {
    assert.equal(execute(attachments).journeys[0].attempts[0].providerObservations.status, 'unavailable');
  }
  assert.equal(execute([]).journeys[0].attempts[0].providerObservations.reason, 'missing-observations');
  assert.equal(execute([attachment(data()), attachment(data())]).journeys[0].attempts[0].providerObservations.reason, 'duplicate-observations');
  for (const override of [{ artifactManifest: null }, { runAttempt: 3 }, { evidence: { ...cleanEvidence(), workingTreeDirty: true } }, { revision: 'b'.repeat(40) }]) {
    assert.equal(execute([attachment(data())], override).journeys[0].attempts[0].providerObservations.reason, 'unverified-candidate-context');
  }
  const aborted = data(); aborted.requests.xero.requests[0].status = null; aborted.requests.xero.requests[0].aborted = true;
  assert.equal(execute([attachment(aborted)]).journeys[0].attempts[0].providerObservations.status, 'observed');
  const unsupported = data(); unsupported.providers = ['smtp-sink'];
  unsupported.requests = { 'smtp-sink': { supported: false, complete: false, generation: 0, capacity: 1000, dropped: 0, inFlight: 0, requests: [] } };
  assert.deepEqual(execute([attachment(unsupported)]).journeys[0].attempts[0].providerObservations.providers,
    [{ provider: 'smtp-sink', mode: 'emulator', supported: false, complete: false, requestCount: 0, dropped: 0, inFlight: 0 }]);
});
