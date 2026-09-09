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
