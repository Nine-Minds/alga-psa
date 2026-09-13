import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyBrowserProviderReadiness } from '../lib/browser-provider-readiness.mjs';
const revision = 'a'.repeat(40);
function report(results = [{ status: 'passed', retry: 0 }], status = 'expected') {
  return { config: { rootDir: '/repo/e2e-tests/tests', metadata: { edition: 'enterprise', authentication: 'real-credentials' } },
    errors: [], suites: [{ specs: [{ file: 'invoice.spec.ts', title: 'invoice settles once', tests: [{
      projectId: 'ee', projectName: 'enterprise', expectedStatus: 'passed', status, results,
    }] }] }], stats: { expected: status === 'expected' ? 1 : 0, flaky: status === 'flaky' ? 1 : 0, unexpected: 0, skipped: 0 } };
}
const cleanEvidence = () => ({ revision, status: 'passed', workingTreeDirty: false,
  source: { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } } });

test('consumer provider requirements reconcile actual archive-bound reports and reject corruption', async t => {
  const { writeFile } = await import('node:fs/promises');
  const { gzipSync } = await import('node:zlib');
  const { recordDockerArchiveBuild } = await import('../record-docker-archive-build.mjs');
  const { browserArtifactServices, createBrowserArchiveReceipt, buildBrowserArtifactManifest } = await import('../lib/browser-artifact-manifest.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'provider-readiness-'));
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

  const identity = ['e2e-tests/tests/invoice.spec.ts', 'ee', 'enterprise', ['invoice settles once']];
  const requirements = [{ identity, providers: [{ provider: 'xero', mode: 'emulator' }] }];
  const data = { providers: ['xero'], requests: { xero: { supported: true, complete: true,
    generation: 1, capacity: 10, dropped: 0, inFlight: 0,
    requests: [{ sequence: 1, method: 'GET', path: '/private-token', status: 200, aborted: false }] } } };
  const attachment = value => ({ name: 'emulator-evidence', contentType: 'application/json', body: Buffer.from(JSON.stringify(value)).toString('base64') });
  const input = () => ({ collected: report([]), report: report([{ status: 'passed', retry: 0, attachments: [attachment(data)] }]),
    evidence: cleanEvidence(), root: '/repo', revision, artifactManifest: manifest, runId: '123', runAttempt: 2, requirements });
  const good = verifyBrowserProviderReadiness(input());
  assert.equal(good.status, 'passed', good.failures.join(','));
  assert.equal(good.observations[0].providers[0].requestCount, 1);
  assert.equal(JSON.stringify(good).includes('private-token'), false);
  for (const mutate of [
    x => { x.requirements = []; },
    x => { x.requirements = null; },
    x => { x.requirements.push(structuredClone(x.requirements[0])); },
    x => { x.requirements[0].identity[3] = []; },
    x => { x.requirements[0].providers = []; },
    x => { x.requirements[0].providers.push({ provider: 'xero', mode: 'emulator' }); },
    x => { x.requirements[0].providers[0].mode = 'live'; },
    x => { x.requirements[0].providers[0].provider = 'qbo'; },
    x => { x.requirements[0].identity[1] = 'other-project'; },
    x => { x.artifactManifest = null; },
    x => { x.runAttempt = 3; },
    x => { x.evidence.source.after.dirty = true; },
    x => { x.report.suites = []; },
    x => { x.report.suites[0].specs.push(structuredClone(x.report.suites[0].specs[0])); },
    x => { x.report = report([{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1, attachments: [attachment(data)] }], 'flaky'); },
    x => { x.report.suites[0].specs[0].tests[0].results[0].attachments = []; },
  ]) {
    const value = structuredClone(input()); mutate(value);
    assert.equal(verifyBrowserProviderReadiness(value).status, 'failed');
  }
  const additional = structuredClone(data);
  additional.providers.push('qbo'); additional.requests.qbo = structuredClone(data.requests.xero);
  const extra = input(); extra.report = report([{ status: 'passed', retry: 0, attachments: [attachment(additional)] }]);
  assert.ok(verifyBrowserProviderReadiness(extra).failures.includes('unexpected-observed-provider-journey'));
  additional.requests.qbo.requests = [];
  extra.report = report([{ status: 'passed', retry: 0, attachments: [attachment(additional)] }]);
  assert.equal(verifyBrowserProviderReadiness(extra).status, 'passed');
  for (const mutate of [
    d => { d.requests.xero.supported = false; d.requests.xero.complete = false; },
    d => { d.requests.xero.dropped = 1; d.requests.xero.complete = false; },
    d => { d.requests.xero.requests = []; },
    d => { d.requests.xero.requests[0].status = null; },
  ]) {
    const d = structuredClone(data); mutate(d);
    const value = input(); value.report = report([{ status: 'passed', retry: 0, attachments: [attachment(d)] }]);
    assert.equal(verifyBrowserProviderReadiness(value).status, 'failed');
  }
});
