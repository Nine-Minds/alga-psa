import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_HEADER, browserRows } from '../record-browser-metrics.mjs';
const revision = 'a'.repeat(40);
const context = { revision, edition: 'enterprise', timestamp: '2026-09-07T00:00:00Z', runUrl: 'https://example.test/run' };
const objects = rows => rows.map(row => Object.fromEntries(BROWSER_HEADER.map((key, i) => [key, row[i]])));

test('run totals are separate from journey retries and do not double count', () => {
  const rows = objects(browserRows({ schemaVersion: 2, suite: 'production-browser', revision, status: 'failed',
    configuration: { edition: 'enterprise' },
    collected: 1, executed: 1, artifactManifest: null, journeys: [{
      identity: ['e2e-tests/tests/invoice.spec.ts', 'ee', 'enterprise', ['invoice', 'settles once']],
      required: true, observed: true, outcome: 'flaky', firstAttempt: 'failed', retryCount: 1,
    }] }, context));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].row_kind, 'run');
  assert.equal(rows[0].collected, 1);
  assert.equal(rows[0].artifact_manifest, '');
  assert.equal(rows[1].collected, '');
  assert.equal(rows[1].executed, '');
  assert.equal(rows[1].outcome, 'flaky');
  assert.equal(rows[1].first_attempt, 'failed');
  assert.equal(rows[1].retry_count, 1);
  assert.equal(rows[1].lane_status, 'failed');
});

test('empty passing flags and wrong-edition reports cannot publish a passed lane', () => {
  for (const metrics of [
    { schemaVersion: 2, suite: 'production-browser', revision, status: 'passed', collected: 0, executed: 0,
      configuration: { edition: 'enterprise' }, journeys: [] },
    { schemaVersion: 2, suite: 'production-browser', revision, status: 'passed',
      configuration: { edition: 'community' }, journeys: [] },
  ]) assert.equal(objects(browserRows(metrics, context))[0].lane_status, 'incomplete');
});

test('absent or stale browser evidence yields a visible incomplete run with unknown counts', () => {
  for (const metrics of [null, {}, { schemaVersion: 2, suite: 'production-browser', revision: 'b'.repeat(40), status: 'passed', journeys: [] }]) {
    const rows = objects(browserRows(metrics, context));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lane_status, 'incomplete');
    assert.equal(rows[0].collected, '');
    assert.equal(rows[0].tested_sha, revision);
  }
});

test('browser run and journey rows separate PR, main and nightly without moving legacy columns', () => {
  assert.deepEqual(BROWSER_HEADER.slice(0, 18), ['timestamp_utc', 'schema_version', 'row_kind', 'tested_sha', 'edition',
    'lane_status', 'run_url', 'collected', 'executed', 'project', 'file', 'journey', 'required',
    'observed', 'outcome', 'first_attempt', 'retry_count', 'artifact_manifest']);
  const metrics = { schemaVersion: 2, suite: 'production-browser', revision, status: 'passed',
    configuration: { edition: 'enterprise' }, collected: 1, executed: 1, journeys: [{
      identity: ['e2e-tests/tests/invoice.spec.ts', 'ee', 'enterprise', ['invoice']],
      required: true, observed: true, outcome: 'expected', firstAttempt: 'passed', retryCount: 0,
    }] };
  for (const [event, branch, kind] of [
    ['pull_request', '42/merge', 'pr'], ['push', 'main', 'main'], ['schedule', 'main', 'nightly'],
    ['workflow_dispatch', 'main', 'manual'], ['push', 'feature', 'branch'], ['', '', 'local'],
  ]) {
    const rows = objects(browserRows(metrics, { ...context, env: { GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: branch } }));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.run_kind, kind);
      assert.equal(row.event_name, event);
      assert.equal(row.lane_status, 'passed');
    }
  }
});

test('missing browser evidence remains incomplete in its original CI trend', () => {
  const [row] = objects(browserRows(null, { ...context,
    env: { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF_NAME: 'main' } }));
  assert.equal(row.lane_status, 'incomplete');
  assert.equal(row.collected, '');
  assert.equal(row.run_kind, 'nightly');
  assert.equal(row.event_name, 'schedule');
});

const identifiedMetrics = () => ({ schemaVersion: 2, suite: 'production-browser', revision, status: 'passed',
  configuration: { edition: 'enterprise', authentication: 'real-credentials', serverLifecycle: 'externally-started-production-build' },
  collected: 2, executed: 2, journeys: ['project-a', 'project-b'].map(id => ({
    identity: ['e2e-tests/tests/invoice.spec.ts', id, 'same display name', ['same journey']],
    required: true, observed: true, outcome: 'expected', firstAttempt: 'passed', retryCount: 0,
  })) });

test('additive columns preserve project identity, rerun identity and runtime configuration', () => {
  assert.deepEqual(BROWSER_HEADER.slice(0, 20), ['timestamp_utc', 'schema_version', 'row_kind', 'tested_sha', 'edition',
    'lane_status', 'run_url', 'collected', 'executed', 'project', 'file', 'journey', 'required',
    'observed', 'outcome', 'first_attempt', 'retry_count', 'artifact_manifest', 'run_kind', 'event_name']);
  for (const attempt of ['1', '2']) {
    const rows = objects(browserRows(identifiedMetrics(), { ...context, env: { GITHUB_RUN_ID: '34294404179', GITHUB_RUN_ATTEMPT: attempt } }));
    assert.deepEqual(rows.map(row => row.project_id), ['', 'project-a', 'project-b']);
    for (const row of rows) {
      assert.equal(row.run_id, '34294404179');
      assert.equal(row.run_attempt, Number(attempt));
      assert.equal(row.authentication, 'real-credentials');
      assert.equal(row.server_lifecycle, 'externally-started-production-build');
    }
  }
});

test('missing or malformed optional metadata remains unknown without changing execution result', () => {
  for (const metadata of [undefined, {}, 42, ['not metadata']]) {
    const metrics = identifiedMetrics();
    metrics.configuration.authentication = metadata;
    metrics.configuration.serverLifecycle = metadata;
    const rows = objects(browserRows(metrics, { ...context, env: { GITHUB_RUN_ID: 'invalid', GITHUB_RUN_ATTEMPT: '0' } }));
    for (const row of rows) {
      assert.equal(row.run_id, ''); assert.equal(row.run_attempt, '');
      assert.equal(row.authentication, ''); assert.equal(row.server_lifecycle, '');
      assert.equal(row.lane_status, 'passed');
    }
  }
});

test('invalid artifact provenance cannot become a passed row or discard known execution configuration', () => {
  for (const manifest of [{}, 'tag-only', { revision, artifact: 'mutable:latest', secret: 'must-not-export' }]) {
    const metrics = identifiedMetrics();
    metrics.artifactManifest = manifest;
    const rows = objects(browserRows(metrics, { ...context, env: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' } }));
    assert.equal(rows[0].lane_status, 'incomplete');
    assert.equal(rows[0].artifact_manifest, '');
    assert.equal(rows[0].authentication, 'real-credentials');
    assert.equal(rows[0].collected, 2);
    assert.equal(JSON.stringify(rows).includes('must-not-export'), false);
  }
});

test('validated archive provenance is retained and sanitized, and cannot move to another rerun', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { gzipSync } = await import('node:zlib');
  const { recordDockerArchiveBuild } = await import('../record-docker-archive-build.mjs');
  const { browserArtifactServices, createBrowserArchiveReceipt, buildBrowserArtifactManifest } = await import('../lib/browser-artifact-manifest.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'browser-row-artifact-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const expected = { revision, edition: 'enterprise', runId: '123', runAttempt: 2 };
  const components = [];
  for (const service of browserArtifactServices(expected.edition)) {
    const archive = join(dir, `${service}.tar.gz`);
    await writeFile(archive, gzipSync(Buffer.alloc(1024)));
    const id = `sha256:${'1'.repeat(64)}`, reported = `sha256:${'2'.repeat(64)}`;
    const record = await recordDockerArchiveBuild({ ...expected, attempt: 2, service, image: 'candidate:latest',
      dockerfile: 'Dockerfile.build', platform: 'linux/amd64', configImageId: id, buildReportedDigest: reported,
      metadata: { 'containerimage.config.digest': id, 'containerimage.digest': reported } }, archive, join(dir, `${service}.json`));
    const receipt = await createBrowserArchiveReceipt(record, archive, expected);
    components.push({ record, receipt, inspection: [{ Id: id, Os: 'linux', Architecture: 'amd64',
      Config: { Labels: { 'org.opencontainers.image.revision': revision } } }] });
  }
  const { browserTestMetrics } = await import('../lib/browser-test-metrics.mjs');
  const manifest = buildBrowserArtifactManifest({ ...expected, components });
  manifest.components[0].inspection[0].Config.Env = ['SECRET=must-not-export'];
  const report = results => ({ config: { rootDir: '/repo/e2e-tests/tests', metadata: {
    edition: 'enterprise', authentication: 'real-credentials', serverLifecycle: 'externally-started-production-build',
  } }, errors: [], suites: [{ specs: [{ file: 'invoice.spec.ts', title: 'invoice', tests: [{
    projectId: 'ee', projectName: 'enterprise', expectedStatus: 'passed', status: 'expected', results,
  }] }] }], stats: { expected: 1, flaky: 0, unexpected: 0, skipped: 0 } });
  const produce = overrides => browserTestMetrics({ root: '/repo', revision, collected: report([]),
    report: report([{ status: 'passed', retry: 0 }]), evidence: { revision, status: 'passed', workingTreeDirty: false,
      source: { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } } },
    artifactManifest: manifest, runId: '123', runAttempt: 2, ...overrides });
  const metrics = produce();
  assert.equal(metrics.status, 'passed');
  assert.equal(JSON.stringify(metrics.artifactManifest).includes('must-not-export'), false);
  for (const overrides of [{ runAttempt: 3 }, { artifactManifest: { ...manifest, revision: 'b'.repeat(40) } }]) {
    const rejected = produce(overrides);
    assert.equal(rejected.status, 'incomplete');
    assert.equal(rejected.artifactManifest, null);
    assert.equal(objects(browserRows(rejected, { ...context, env: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' } }))[0].lane_status, 'incomplete');
  }
  const rows = objects(browserRows(metrics, { ...context, env: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' } }));
  assert.equal(rows[0].lane_status, 'passed');
  assert.equal(JSON.parse(rows[0].artifact_manifest).components.length, 9);
  assert.equal(rows[0].artifact_manifest.includes('must-not-export'), false);
  const [stale] = objects(browserRows(metrics, { ...context, env: { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '3' } }));
  assert.equal(stale.lane_status, 'incomplete');
  assert.equal(stale.artifact_manifest, '');
});

test('browser header migration writes only U1 through Y1 before appending and preserves history', async t => {
  const { appendRows } = await import('../record-test-metrics.mjs');
  const history = ['historical timestamp', 2, 'run', revision, 'enterprise', 'failed'];
  const sheet = [BROWSER_HEADER.slice(0, 20), [...history]];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const decoded = decodeURIComponent(url), body = options.body && JSON.parse(options.body);
    calls.push({ url: decoded, method: options.method, body });
    if (options.method === 'GET') {
      assert.match(decoded, /browser_readiness!1:1$/);
      return { ok: true, status: 200, json: async () => ({ values: [sheet[0]] }) };
    }
    if (options.method === 'PUT') {
      assert.match(decoded, /browser_readiness!U1\?valueInputOption=RAW$/);
      assert.deepEqual(body.values, [BROWSER_HEADER.slice(20)]);
      assert.equal(body.values[0].length, 5);
      sheet[0].splice(20, 5, ...body.values[0]);
    } else {
      assert.equal(options.method, 'POST');
      assert.match(decoded, /:append\?/);
      sheet.push(...body.values);
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  const rows = browserRows(identifiedMetrics(), context);
  await appendRows('synthetic-token', 'test-sheet', 'browser_readiness', BROWSER_HEADER, rows);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'PUT', 'POST']);
  assert.deepEqual(sheet[0], BROWSER_HEADER);
  assert.deepEqual(sheet[1], history);
  assert.deepEqual(sheet.slice(2), rows);
});
