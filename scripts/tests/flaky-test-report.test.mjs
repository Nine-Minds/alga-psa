import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aggregateFlakyTests, renderFlakyTestReport } from '../lib/flaky-test-report.mjs';
import { collectFlakyArtifacts, FlakyCollectionError, readFlakyDocumentZip, runFlakyTestCollection } from '../collect-flaky-tests.mjs';

const generatedAt = '2026-09-28T12:00:00.000Z';
const days = count => new Date(Date.parse(generatedAt) - count * 86_400_000).toISOString();

const browserDocument = (tests = [{ testId: 'e2e-tests/tests/invoice.spec.ts > invoice > retains balance [community]',
  file: 'e2e-tests/tests/invoice.spec.ts', name: 'invoice > retains balance', project: 'community', retryCount: 1 }]) => ({
  schemaVersion: 1, suite: 'production-browser', job: 'production-browser (community)', edition: 'community',
  revision: 'a'.repeat(40), runId: '100', runAttempt: 1, tests,
});
const unitDocument = (tests = [{ testId: 'src/test/unit/billing.test.ts > invoices > totals',
  file: 'src/test/unit/billing.test.ts', name: 'invoices > totals', retryCount: 1 }]) => ({
  schemaVersion: 1, suite: 'server-unit', job: 'server-unit shard 2/4', shard: { index: 2, total: 4 },
  revision: 'a'.repeat(40), runId: '100', runAttempt: 1, tests,
});
const artifact = (over = {}) => ({ artifactName: 'flaky-tests-browser-community', runId: '100', runAttempt: 1,
  createdAt: days(1), document: browserDocument(), ...over });

test('aggregates browser and unit flakes, most frequent first', () => {
  const report = aggregateFlakyTests([
    artifact({ runId: '100', createdAt: days(6) }),
    artifact({ runId: '101', createdAt: days(2) }),
    artifact({ artifactName: 'flaky-tests-browser-enterprise', runId: '101', createdAt: days(2),
      document: { ...browserDocument(), job: 'production-browser (enterprise)', edition: 'enterprise' } }),
    artifact({ artifactName: 'flaky-tests-unit-shard-2', runId: '101', createdAt: days(3), document: unitDocument() }),
    artifact({ artifactName: 'flaky-tests-unit-shard-1', runId: '101', createdAt: days(3), document: unitDocument([]) }),
  ], { generatedAt });
  assert.deepEqual(report.summary, { artifactsAccepted: 5, artifactsRejected: 0, runsObserved: 2,
    flakyTests: 2, occurrences: 4, truncated: false });
  assert.deepEqual(report.tests.map(row => [row.suite, row.occurrences, row.lastSeen]),
    [['production-browser', 3, days(2)], ['server-unit', 1, days(3)]]);
  assert.deepEqual(report.tests[0].jobs, ['production-browser (community)', 'production-browser (enterprise)']);
  assert.deepEqual(report.tests[0].runIds, ['100', '101']);
  assert.deepEqual(report.tests[0].artifactNames, ['flaky-tests-browser-community', 'flaky-tests-browser-enterprise']);
  assert.equal(report.tests[0].firstSeen, days(6));
  assert.deepEqual(report.tests[1].jobs, ['server-unit shard 2/4']);
  assert.equal(report.sources.length, 5);

  const markdown = renderFlakyTestReport(report);
  assert.match(markdown, /## Flaky tests \(last 7 days\)/);
  assert.match(markdown, /2 flaky tests across 5 artifacts from 2 runs \(0 artifacts rejected\)\./);
  assert.match(markdown, /\| Test \| Suite \| Job \| Count \| Last seen \|/);
  assert.match(markdown, /\| e2e-tests\/tests\/invoice\.spec\.ts > invoice > retains balance \[community\] \| production-browser \| production-browser \(community\), production-browser \(enterprise\) \| 3 \| /);
  assert.equal(markdown.split('\n').filter(line => line.startsWith('| ')).length, 4);
});

test('clean runs still report, with their empty documents counted', () => {
  const report = aggregateFlakyTests([artifact({ document: browserDocument([]) }),
    artifact({ artifactName: 'flaky-tests-unit-shard-4', document: unitDocument([]) })], { generatedAt });
  assert.deepEqual(report.tests, []);
  assert.deepEqual(report.rejected, []);
  assert.equal(report.summary.artifactsAccepted, 2);
  assert.match(renderFlakyTestReport(report), /No retry-only pass was recorded in this window\./);
});

test('malformed, foreign and stale artifacts are rejected with local codes only', () => {
  const cases = [
    ['unexpected-artifact-name', { artifactName: 'server-unit-shard-1' }],
    ['invalid-run-id', { runId: 'main' }],
    ['invalid-created-at', { createdAt: 'last tuesday' }],
    ['outside-window', { createdAt: days(8) }],
    ['outside-window', { createdAt: days(-1) }],
    // A shard that died before the reporter ran leaves the initialized null.
    ['unreadable-document', { document: null }],
    ['unsupported-schema-version', { document: { ...browserDocument(), schemaVersion: 2 } }],
    ['unknown-suite', { document: { ...browserDocument(), suite: 'production-browser-next' } }],
    ['invalid-job', { document: { ...browserDocument(), job: '' } }],
    ['invalid-test-list', { document: { ...browserDocument(), tests: 'many' } }],
    ['invalid-test-list', { document: browserDocument(Array.from({ length: 501 }, (_, index) => ({
      testId: `spec-${index}`, file: 'a.spec.ts', name: `case ${index}` }))) }],
    ['invalid-test-entry', { document: browserDocument([{ testId: 'x', file: 'a.spec.ts' }]) }],
    ['invalid-test-identity', { document: browserDocument([{ testId: 'x'.repeat(513), file: 'a.spec.ts', name: 'x' }]) }],
    ['invalid-test-identity', { document: browserDocument([
      { testId: 'x', file: 'a.spec.ts', name: 'x' }, { testId: 'x', file: 'a.spec.ts', name: 'x' }]) }],
    ['invalid-retry-count', { document: browserDocument([{ testId: 'x', file: 'a.spec.ts', name: 'x', retryCount: -1 }]) }],
  ];
  for (const [code, over] of cases) {
    const report = aggregateFlakyTests([artifact(over)], { generatedAt });
    assert.deepEqual(report.tests, [], code);
    assert.deepEqual(report.rejected.map(entry => entry.code), [code]);
    assert.equal(report.summary.artifactsAccepted, 0);
  }
  assert.throws(() => aggregateFlakyTests([], { generatedAt: 'never' }), /Invalid report timestamp/);
  assert.equal(aggregateFlakyTests(null, { generatedAt }).summary.flakyTests, 0);
});

function zip(entries) {
  const result = spawnSync('python3', ['-c', 'import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED) as z:\n for name,value in json.load(sys.stdin): z.writestr(name,value)\nsys.stdout.buffer.write(b.getvalue())'],
    { input: JSON.stringify(entries), maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}
const zipped = document => zip([['flaky-tests.json', JSON.stringify(document)]]);

test('only the fixed member of a bounded archive is read', async () => {
  assert.deepEqual(await readFlakyDocumentZip(zipped(unitDocument())), unitDocument());
  // No archive path is honoured, no unbounded member is decompressed, and a
  // duplicated or absent member never yields a document.
  for (const entries of [
    [['../../flaky-tests.json', '{}']],
    [['evidence/flaky-tests.json', '{}']],
    [['flaky-tests.json', '{}'], ['flaky-tests.json', '{}']],
    [['flaky-tests.json', ' '.repeat(1024 * 1024 + 1)]],
  ]) await assert.rejects(readFlakyDocumentZip(zip(entries)));
  await assert.rejects(readFlakyDocumentZip(Buffer.from('not a zip archive')));
});

function github({ runs, artifacts, archives }) {
  const calls = [];
  const request = async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.method, 'GET');
    if (url.hostname === 'api.github.com') assert.equal(options.headers.authorization, 'Bearer github-secret');
    const json = data => new Response(JSON.stringify(data), { status: 200 });
    if (url.pathname.endsWith(`/actions/workflows/production-regression.yml/runs`)) {
      assert.equal(url.searchParams.get('created'), `>=2026-09-21`);
      return json({ total_count: runs.length, workflow_runs: runs });
    }
    const inventory = /\/actions\/runs\/(\d+)\/artifacts$/.exec(url.pathname);
    if (inventory) {
      const list = artifacts[inventory[1]];
      if (!list) return new Response('nope', { status: 500 });
      return json({ total_count: list.length, artifacts: list });
    }
    const download = /\/actions\/artifacts\/(\d+)\/zip$/.exec(url.pathname);
    if (download) {
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { location: `https://objects.githubusercontent.com/${download[1]}` } });
    }
    assert.equal(url.hostname, 'objects.githubusercontent.com');
    assert.equal(options.headers.authorization, undefined);
    return new Response(archives[url.pathname.slice(1)], { status: 200 });
  };
  return { request, calls };
}

test('the collector reads only flaky artifacts of recent regression runs', async () => {
  const archives = { 1: zipped(browserDocument()), 2: zipped(unitDocument()), 9: zipped(browserDocument()) };
  const entry = (id, name) => ({ id, name, expired: false, size_in_bytes: archives[id]?.length ?? 64, created_at: days(1) });
  const { request, calls } = github({
    runs: [{ id: 100, run_attempt: 1, created_at: days(1) }, { id: 101, run_attempt: 2, created_at: days(2) }],
    artifacts: {
      100: [entry(1, 'flaky-tests-browser-community'), entry(2, 'flaky-tests-unit-shard-2'),
        { ...entry(3, 'server-unit-shard-2'), size_in_bytes: 10 },
        { ...entry(4, 'flaky-tests-browser-enterprise'), expired: true },
        { ...entry(5, 'flaky-tests-unit-shard-3'), size_in_bytes: 0 }],
      101: [],
    },
    archives,
  });
  const collected = await collectFlakyArtifacts({ repository: 'Nine-Minds/alga-psa', githubToken: 'github-secret',
    request, now: Date.parse(generatedAt) });
  assert.deepEqual(collected.artifacts.map(item => [item.artifactName, item.runId, item.document.suite]),
    [['flaky-tests-browser-community', '100', 'production-browser'], ['flaky-tests-unit-shard-2', '100', 'server-unit']]);
  assert.deepEqual(collected.diagnostics, [{ scope: 'artifact', runId: '100', code: 'artifact-expired' },
    { scope: 'artifact', runId: '100', code: 'artifact-unreadable' }]);
  assert.equal(collected.runsInspected, 2);
  // The non-flaky artifact is never downloaded.
  assert.equal(calls.filter(url => url.pathname.includes('/artifacts/3/')).length, 0);
  assert.equal(aggregateFlakyTests(collected.artifacts, { generatedAt }).summary.flakyTests, 2);
});

test('an unreachable artifact inventory degrades that run only', async () => {
  const archives = { 1: zipped(browserDocument()) };
  const { request } = github({
    runs: [{ id: 100, run_attempt: 1, created_at: days(1) }, { id: 102, run_attempt: 1, created_at: days(1) }],
    artifacts: { 100: [{ id: 1, name: 'flaky-tests-browser-community', expired: false, size_in_bytes: archives[1].length, created_at: days(1) }] },
    archives,
  });
  const collected = await collectFlakyArtifacts({ repository: 'Nine-Minds/alga-psa', githubToken: 'github-secret',
    request, now: Date.parse(generatedAt) });
  assert.equal(collected.artifacts.length, 1);
  assert.deepEqual(collected.diagnostics, [{ scope: 'artifacts', runId: '102', code: 'artifact-inventory-unavailable' }]);
});

test('configuration and run inventory failures are reported as codes, never as upstream text', async () => {
  for (const [code, options] of [
    ['invalid-repository', { repository: 'not-a-repository' }],
    ['github-token-missing', { githubToken: '' }],
    ['invalid-window', { windowDays: 0 }],
  ]) {
    await assert.rejects(() => collectFlakyArtifacts({ repository: 'Nine-Minds/alga-psa', githubToken: 'github-secret',
      request: async () => new Response('{}', { status: 200 }), ...options }),
    error => error instanceof FlakyCollectionError && error.diagnostic.code === code);
  }
  await assert.rejects(() => collectFlakyArtifacts({ repository: 'Nine-Minds/alga-psa', githubToken: 'github-secret',
    request: async () => new Response('sorry: token 1234', { status: 403 }) }),
  error => error.diagnostic.code === 'run-inventory-unavailable' && !/1234/.test(error.message));
});

test('the CLI writes the report, the diagnostics and the step summary', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-flaky-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const archives = { 1: zipped(browserDocument()) };
  const { request } = github({
    runs: [{ id: 100, run_attempt: 1, created_at: days(1) }],
    artifacts: { 100: [{ id: 1, name: 'flaky-tests-browser-community', expired: false, size_in_bytes: archives[1].length, created_at: days(1) }] },
    archives,
  });
  const directory = path.join(root, 'test-results/flaky-tests');
  const summary = path.join(root, 'summary.md');
  writeFileSync(summary, '');
  const env = { GITHUB_REPOSITORY: 'Nine-Minds/alga-psa', GITHUB_TOKEN: 'github-secret', GITHUB_STEP_SUMMARY: summary };
  const diagnostics = await runFlakyTestCollection({ directory, env, request, now: Date.parse(generatedAt) });
  assert.equal(diagnostics.status, 'collected');
  assert.equal(diagnostics.artifactsDownloaded, 1);
  const report = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8'));
  assert.equal(report.scope, 'flaky-test-report');
  assert.equal(report.tests.length, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'collection.json'), 'utf8')).summary, report.summary);
  assert.match(readFileSync(summary, 'utf8'), /retains balance \[community\] \| production-browser \|/);

  // A failed collection still leaves diagnostics and a visible summary behind.
  mkdirSync(directory, { recursive: true });
  const failed = await runFlakyTestCollection({ directory, env: { ...env, GITHUB_REPOSITORY: 'broken' }, request, now: Date.parse(generatedAt) });
  assert.deepEqual(failed.diagnostic, { phase: 'configuration', code: 'invalid-repository' });
  assert.match(readFileSync(summary, 'utf8'), /Collection failed/);
});
