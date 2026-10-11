import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aggregateFlakyTests, renderFlakyTestReport } from '../lib/flaky-test-report.mjs';
import { collectFlakyArtifacts, FlakyCollectionError, readFlakyDocumentZip, runFlakyTestCollection } from '../collect-flaky-tests.mjs';
import { flakyPlaywrightTests } from '../lib/playwright-execution-evidence.mjs';
import VitestFlakyReporter from '../lib/vitest-flaky-reporter.mjs';

const generatedAt = '2026-09-28T12:00:00.000Z';
const days = count => new Date(Date.parse(generatedAt) - count * 86_400_000).toISOString();

const browserDocument = (tests = [{ testId: 'e2e-tests/tests/invoice.spec.ts > invoice > retains balance [community]',
  file: 'e2e-tests/tests/invoice.spec.ts', name: 'invoice > retains balance', project: 'community', retryCount: 1 }]) => ({
  schemaVersion: 1, suite: 'production-browser', job: 'production-browser (community)', edition: 'community',
  revision: 'a'.repeat(40), runId: '100', runAttempt: 1, eventName: 'pull_request', branch: 'feature/invoices', tests,
});
const unitDocument = (tests = [{ testId: 'src/test/unit/billing.test.ts > invoices > totals',
  file: 'src/test/unit/billing.test.ts', name: 'invoices > totals', retryCount: 1 }]) => ({
  schemaVersion: 1, suite: 'server-unit', job: 'server-unit shard 2/4', shard: { index: 2, total: 4 },
  revision: 'a'.repeat(40), runId: '100', runAttempt: 1, eventName: 'push', branch: 'main', tests,
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
  assert.match(markdown, /\| Test \| Suite \| Job \| Main \| PR \| Count \| Last seen \|/);
  assert.match(markdown, /\| e2e-tests\/tests\/invoice\.spec\.ts > invoice > retains balance \[community\] \| production-browser \| production-browser \(community\), production-browser \(enterprise\) \| 0 \| 3 \| 3 \| /);
  assert.equal(markdown.split('\n').filter(line => line.startsWith('| ')).length, 4);
});

// A flake on somebody's branch and the same flake on a merged revision are
// different news, so the row counts them apart instead of summing them.
test('pull-request and main occurrences are counted and rendered apart', () => {
  const onMain = tests => ({ ...browserDocument(tests), eventName: 'push', branch: 'main' });
  const report = aggregateFlakyTests([
    artifact({ runId: '100', createdAt: days(5) }),
    artifact({ runId: '101', createdAt: days(4), document: { ...browserDocument(), branch: 'feature/other' } }),
    artifact({ runId: '102', createdAt: days(3), document: onMain() }),
    artifact({ runId: '103', createdAt: days(2), document: { ...onMain(), eventName: 'schedule' } }),
    // An artifact from before this card carries neither field and still counts.
    artifact({ runId: '104', createdAt: days(1),
      document: { ...browserDocument(), eventName: undefined, branch: undefined } }),
  ], { generatedAt });
  assert.deepEqual(report.rejected, []);
  const [row] = report.tests;
  assert.equal(row.occurrences, 5);
  assert.deepEqual([row.prOccurrences, row.mainOccurrences], [2, 3]);
  assert.deepEqual(row.events, { pull_request: 2, push: 1, schedule: 1, unknown: 1 });
  assert.deepEqual(row.branches, ['feature/invoices', 'feature/other', 'main', 'unknown']);
  assert.match(renderFlakyTestReport(report), / \| 3 \| 2 \| 5 \| /);
  assert.deepEqual(report.sources.map(entry => [entry.eventName, entry.branch]),
    [['pull_request', 'feature/invoices'], ['pull_request', 'feature/other'], ['push', 'main'],
      ['schedule', 'main'], ['unknown', 'unknown']]);
});

// Every lane that retries has to be aggregatable, or its artifacts are rejected
// and the weekly report reads as "no flakes".
test('the integration and infrastructure lanes aggregate as their own suites', () => {
  const laneDocument = (suite, index) => ({ schemaVersion: 1, suite, job: `${suite} shard ${index}/4`,
    shard: { index, total: 4 }, revision: 'a'.repeat(40), runId: '100', runAttempt: 1,
    eventName: 'schedule', branch: 'main',
    tests: [{ testId: `src/test/${suite}/redis.test.ts > reconnects`, file: `src/test/${suite}/redis.test.ts`,
      name: 'reconnects', retryCount: 1 }] });
  const report = aggregateFlakyTests([
    artifact({ artifactName: 'flaky-tests-integration-shard-2', document: laneDocument('integration', 2) }),
    artifact({ artifactName: 'flaky-tests-infrastructure-shard-3', document: laneDocument('infrastructure', 3) }),
  ], { generatedAt });
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.tests.map(row => [row.suite, row.jobs, row.mainOccurrences, row.prOccurrences]),
    [['infrastructure', ['infrastructure shard 3/4'], 1, 0], ['integration', ['integration shard 2/4'], 1, 0]]);
});

test('clean runs still report, with their empty documents counted', () => {
  const report = aggregateFlakyTests([artifact({ document: browserDocument([]) }),
    artifact({ artifactName: 'flaky-tests-unit-shard-4', document: unitDocument([]) })], { generatedAt });
  assert.deepEqual(report.tests, []);
  assert.deepEqual(report.rejected, []);
  assert.equal(report.summary.artifactsAccepted, 2);
  assert.match(renderFlakyTestReport(report), /No retry-only pass was recorded in this window\./);
});

test('a partly inspected window never reads as a clean one', () => {
  const complete = aggregateFlakyTests([artifact()], { generatedAt,
    coverage: { runsInspected: 351, complete: true, limits: [] } });
  assert.deepEqual(complete.coverage, { runsInspected: 351, complete: true, limits: [] });
  assert.match(renderFlakyTestReport(complete), /Inspected every flaky-reporting workflow run in the window \(351\)\./);

  // Any run or artifact the collector could not read makes an absent test
  // meaningless, so the summary has to say the window was only partly covered.
  const partial = aggregateFlakyTests([artifact({ document: browserDocument([]) })], { generatedAt,
    coverage: { runsInspected: 600, complete: true, limits: ['deadline-exceeded', 'run-limit-reached', 'deadline-exceeded'] } });
  assert.deepEqual(partial.coverage, { runsInspected: 600, complete: false, limits: ['deadline-exceeded', 'run-limit-reached'] });
  const markdown = renderFlakyTestReport(partial);
  assert.match(markdown, /\*\*Partial coverage\*\* — 600 workflow run\(s\) inspected \(`deadline-exceeded`, `run-limit-reached`\)\./);
  assert.match(markdown, /not evidence that it is stable/);
  assert.match(markdown, /No retry-only pass was recorded in this window\./);

  // An unreported or nonsensical coverage claim is never rendered as a promise.
  assert.equal(aggregateFlakyTests([artifact()], { generatedAt }).coverage, null);
  assert.equal(renderFlakyTestReport(aggregateFlakyTests([artifact()], { generatedAt })).includes('Inspected every'), false);
  assert.deepEqual(aggregateFlakyTests([artifact()], { generatedAt, coverage: { runsInspected: -1, complete: 'yes' } }).coverage,
    { runsInspected: null, complete: false, limits: [] });
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
    ['invalid-event-name', { document: { ...browserDocument(), eventName: 'x'.repeat(61) } }],
    ['invalid-event-name', { document: { ...browserDocument(), eventName: 12 } }],
    ['invalid-branch', { document: { ...browserDocument(), branch: 'x'.repeat(256) } }],
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

// The hand-written fixtures above would keep passing if a producer renamed a
// field: the aggregator would reject the document and the weekly report would
// read as "no flakes" instead of failing. This pins the real browser producer
// and e2e-tests/run.mjs's mapping of it against the validator.
test('the real browser producer output survives aggregation unrejected', () => {
  const data = { config: { rootDir: '/repo/e2e-tests/tests' }, errors: [],
    suites: [{ title: 'invoice.spec.ts', file: 'invoice.spec.ts', specs: [], suites: [{
      title: 'invoice', specs: [{ title: 'retains balance', file: 'invoice.spec.ts', tests: [{
        projectId: 'ce', projectName: 'community', expectedStatus: 'passed', status: 'flaky',
        results: [{ status: 'failed', retry: 0, errors: [] }, { status: 'passed', retry: 1, errors: [] }],
      }] }],
    }] }],
    stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 1 } };
  const flaky = flakyPlaywrightTests(data, '/repo');
  assert.equal(flaky.length, 1);
  const document = { schemaVersion: 1, suite: 'production-browser', job: 'production-browser (community)',
    edition: 'community', revision: 'a'.repeat(40), runId: '100', runAttempt: 1,
    // Mirrors e2e-tests/run.mjs exactly.
    tests: flaky.map(({ testId, file, name, projectName, retryCount }) => ({ testId, file, name, project: projectName, retryCount })) };
  const report = aggregateFlakyTests([artifact({ document })], { generatedAt });
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.tests.map(row => row.testId),
    ['e2e-tests/tests/invoice.spec.ts > invoice > retains balance [community]']);
});

// The same contract for the unit lane: these keys are what
// scripts/lib/vitest-flaky-reporter.mjs writes per recorded test.
test('the real unit reporter entry shape survives aggregation unrejected', () => {
  const document = unitDocument([{ testId: 'recovers.test.js > recovers after one retry',
    file: 'recovers.test.js', name: 'recovers after one retry', retryCount: 1 }]);
  const report = aggregateFlakyTests([artifact({ artifactName: 'flaky-tests-unit-shard-3', document })], { generatedAt });
  assert.deepEqual(report.rejected, []);
  assert.deepEqual(report.tests.map(row => row.testId), ['recovers.test.js > recovers after one retry']);
});

// Builds the document with the real reporter, so a renamed or dropped field
// fails here instead of quietly turning every artifact into a rejection.
function reporterDocument(overrides, tests) {
  const keys = ['FLAKY_SUITE', 'FLAKY_JOB', 'FLAKY_SHARD_INDEX', 'FLAKY_SHARD_TOTAL', 'GITHUB_SHA',
    'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_EVENT_NAME', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, overrides);
    const reporter = new VitestFlakyReporter();
    reporter.root = '/repo/server';
    reporter.tests = new Map(tests.map(entry => [entry.testId, entry]));
    return reporter.document();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('the real Vitest reporter document aggregates for every sharded lane', () => {
  const entry = { testId: 'src/test/redis.test.ts > reconnects', file: 'src/test/redis.test.ts',
    name: 'reconnects', retryCount: 1 };
  for (const [suite, artifactName] of [['server-unit', 'flaky-tests-unit-shard-2'],
    ['integration', 'flaky-tests-integration-shard-2'], ['infrastructure', 'flaky-tests-infrastructure-shard-2']]) {
    const document = reporterDocument({ FLAKY_SUITE: suite, FLAKY_SHARD_INDEX: '2', FLAKY_SHARD_TOTAL: '4',
      GITHUB_SHA: 'a'.repeat(40), GITHUB_EVENT_NAME: 'schedule', GITHUB_REF_NAME: 'main' }, [entry]);
    assert.deepEqual(document, { schemaVersion: 1, suite, job: `${suite} shard 2/4`, shard: { index: 2, total: 4 },
      revision: 'a'.repeat(40), runId: null, runAttempt: null, eventName: 'schedule', branch: 'main', tests: [entry] });
    const report = aggregateFlakyTests([artifact({ artifactName, document })], { generatedAt });
    assert.deepEqual(report.rejected, []);
    assert.deepEqual(report.tests.map(row => [row.suite, row.mainOccurrences, row.prOccurrences]), [[suite, 1, 0]]);
  }
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

function github({ runs, integrationRuns = [], artifacts, archives }) {
  const calls = [];
  const request = async (input, options) => {
    const url = new URL(input);
    calls.push(url);
    assert.equal(options.method, 'GET');
    if (url.hostname === 'api.github.com') assert.equal(options.headers.authorization, 'Bearer github-secret');
    const json = data => new Response(JSON.stringify(data), { status: 200 });
    // Both workflows that publish flaky artifacts are inventoried: the
    // regression umbrella and standalone integration-tests runs.
    const workflow = /\/actions\/workflows\/([^/]+)\/runs$/.exec(url.pathname);
    if (workflow) {
      assert.ok(['production-regression.yml', 'integration-tests.yml'].includes(workflow[1]), workflow[1]);
      assert.equal(url.searchParams.get('created'), `>=2026-09-21`);
      const list = workflow[1] === 'production-regression.yml' ? runs : integrationRuns;
      return json({ total_count: list.length, workflow_runs: list });
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
  // A standalone integration-tests run is where a schedule-event flake on main
  // usually surfaces, so its own workflow has to be inventoried too.
  const integrationDocument = { schemaVersion: 1, suite: 'integration', job: 'integration shard 2/4',
    shard: { index: 2, total: 4 }, revision: 'a'.repeat(40), runId: '200', runAttempt: 1,
    eventName: 'schedule', branch: 'main', tests: [{ testId: 'src/test/integration/redis.test.ts > reconnects',
      file: 'src/test/integration/redis.test.ts', name: 'reconnects', retryCount: 1 }] };
  const archives = { 1: zipped(browserDocument()), 2: zipped(unitDocument()), 6: zipped(integrationDocument),
    9: zipped(browserDocument()) };
  const entry = (id, name) => ({ id, name, expired: false, size_in_bytes: archives[id]?.length ?? 64, created_at: days(1) });
  const { request, calls } = github({
    runs: [{ id: 100, run_attempt: 1, created_at: days(1) }, { id: 101, run_attempt: 2, created_at: days(2) }],
    integrationRuns: [{ id: 200, run_attempt: 1, created_at: days(3) }],
    artifacts: {
      100: [entry(1, 'flaky-tests-browser-community'), entry(2, 'flaky-tests-unit-shard-2'),
        { ...entry(3, 'server-unit-shard-2'), size_in_bytes: 10 },
        { ...entry(4, 'flaky-tests-browser-enterprise'), expired: true },
        { ...entry(5, 'flaky-tests-unit-shard-3'), size_in_bytes: 0 }],
      101: [],
      200: [entry(6, 'flaky-tests-integration-shard-2')],
    },
    archives,
  });
  const collected = await collectFlakyArtifacts({ repository: 'Nine-Minds/alga-psa', githubToken: 'github-secret',
    request, now: Date.parse(generatedAt) });
  assert.deepEqual(collected.artifacts.map(item => [item.artifactName, item.runId, item.document.suite]),
    [['flaky-tests-browser-community', '100', 'production-browser'], ['flaky-tests-unit-shard-2', '100', 'server-unit'],
      ['flaky-tests-integration-shard-2', '200', 'integration']]);
  assert.deepEqual(collected.diagnostics, [{ scope: 'artifact', runId: '100', code: 'artifact-expired' },
    { scope: 'artifact', runId: '100', code: 'artifact-unreadable' }]);
  assert.equal(collected.runsInspected, 3);
  // The non-flaky artifact is never downloaded.
  assert.equal(calls.filter(url => url.pathname.includes('/artifacts/3/')).length, 0);
  const report = aggregateFlakyTests(collected.artifacts, { generatedAt });
  assert.equal(report.summary.flakyTests, 3);
  assert.deepEqual(report.tests.map(row => [row.suite, row.prOccurrences, row.mainOccurrences]),
    [['integration', 0, 1], ['production-browser', 1, 0], ['server-unit', 0, 1]]);
});

test('an unreachable artifact inventory degrades that run only', async (t) => {
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

  // And the run it could not read is reported as partial coverage, not skipped
  // quietly: the table below it is no longer the whole week.
  const root = mkdtempSync(path.join(tmpdir(), 'alga-flaky-partial-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const summary = path.join(root, 'summary.md');
  writeFileSync(summary, '');
  await runFlakyTestCollection({ directory: path.join(root, 'out'), request, now: Date.parse(generatedAt),
    env: { GITHUB_REPOSITORY: 'Nine-Minds/alga-psa', GITHUB_TOKEN: 'github-secret', GITHUB_STEP_SUMMARY: summary } });
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'out/report.json'), 'utf8')).coverage,
    { runsInspected: 2, complete: false, limits: ['artifact-inventory-unavailable'] });
  assert.match(readFileSync(summary, 'utf8'), /\*\*Partial coverage\*\* — 2 workflow run\(s\) inspected \(`artifact-inventory-unavailable`\)\./);
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
  // The collector's own diagnostics decide the coverage claim in the summary.
  assert.deepEqual(report.coverage, { runsInspected: 1, complete: true, limits: [] });
  assert.match(readFileSync(summary, 'utf8'), /retains balance \[community\] \| production-browser \|/);
  assert.match(readFileSync(summary, 'utf8'), /Inspected every flaky-reporting workflow run in the window \(1\)\./);

  // A failed collection still leaves diagnostics and a visible summary behind.
  mkdirSync(directory, { recursive: true });
  const failed = await runFlakyTestCollection({ directory, env: { ...env, GITHUB_REPOSITORY: 'broken' }, request, now: Date.parse(generatedAt) });
  assert.deepEqual(failed.diagnostic, { phase: 'configuration', code: 'invalid-repository' });
  assert.match(readFileSync(summary, 'utf8'), /Collection failed/);
  // The upload step tolerates a missing directory, so the red path has to leave
  // its own diagnostics on disk, and must not leave a stale report beside them.
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'collection.json'), 'utf8')).diagnostic, failed.diagnostic);
  assert.equal(existsSync(path.join(directory, 'report.json')), false);
});
