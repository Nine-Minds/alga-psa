import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { collectBrowserMetricExecutions } from '../lib/collect-browser-metric-executions.mjs';
import { runBrowserMetricCollection } from '../collect-browser-metric-executions.mjs';
import { reconcileBrowserMetricExecutions } from '../lib/reconcile-browser-metric-executions.mjs';
import { BROWSER_HEADER } from '../record-browser-metrics.mjs';
const revision = 'a'.repeat(40), head = 'b'.repeat(40), base = 'c'.repeat(40);
const notSelectedSteps = () => [
  { name: 'Record browser tests not selected', status: 'completed', conclusion: 'success' },
  { name: 'Record browser journey readiness', status: 'completed', conclusion: 'skipped' },
];
export const exportRow = values => BROWSER_HEADER.map(column => values[column] ?? '');
const RUN_URL = 'https://github.com/Nine-Minds/alga-psa/actions/runs/123';
function fixture() {
  const run = { id: 123, repository: { full_name: 'Nine-Minds/alga-psa' }, path: '.github/workflows/production-regression.yml',
    run_attempt: 2, head_sha: head, status: 'completed', conclusion: 'failure', event: 'pull_request',
    // Relative, so a fixture date can never drift past the retention window.
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    pull_requests: [{ number: 3343, head: { sha: head }, base: { sha: base } }] };
  const job = (id, name) => ({ id, name, run_id: 123, run_attempt: 2, head_sha: head, status: 'completed', conclusion: 'success' });
  const jobs = [job(1, 'browser / Production browser (community)'), job(2, 'browser / Production browser (enterprise)')];
  const metadata = { spreadsheetId: 'sheet-id', sheets: [{ properties: { title: 'browser_readiness', gridProperties: { rowCount: 1000, columnCount: 26 } } }] };
  const values = { majorDimension: 'ROWS', values: [BROWSER_HEADER,
    exportRow({ timestamp_utc: '2026-09-09', schema_version: 2, row_kind: 'run', run_url: RUN_URL })] };
  const state = { run, after: null, jobs, metadata, values, parents: [{ sha: base }, { sha: head }], calls: [], intercept: null, total: undefined };
  const request = async (input, options) => {
    const url = new URL(input); state.calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.authorization, `Bearer ${url.hostname === 'api.github.com' ? 'github-secret' : 'sheets-secret'}`);
    const intercepted = state.intercept?.(url, options);
    if (intercepted) return intercepted;
    let data;
    if (url.pathname.endsWith('/actions/runs/123')) data = state.calls.filter(c => c.url.pathname === url.pathname).length > 1 ? state.after ?? state.run : state.run;
    else if (url.pathname.includes('/git/commits/')) data = { sha: revision, parents: state.parents };
    else if (url.pathname.includes('/jobs')) {
      assert.ok(url.pathname.endsWith('/attempts/2/jobs'));
      assert.equal(url.searchParams.get('per_page'), '100');
      const page = Number(url.searchParams.get('page'));
      data = { total_count: state.total ?? state.jobs.length, jobs: state.jobs.slice((page - 1) * 100, page * 100) };
    } else if (url.pathname.endsWith('/values:batchGet')) {
      const ranges = url.searchParams.getAll('ranges');
      assert.ok(ranges.length > 0 && ranges.length <= 50);
      data = { spreadsheetId: 'sheet-id', valueRanges: ranges.map(range => {
        const match = /^'browser_readiness'!A(\d+):([R-Y])(\d+)$/.exec(range);
        assert.ok(match, range);
        const [start, end] = [Number(match[1]), Number(match[3])];
        const rows = (state.values.values ?? []).slice(start - 1, end).map(row => row.slice(0, match[2].charCodeAt(0) - 64));
        while (rows.length && rows.at(-1).length === 0) rows.pop();
        return { range, majorDimension: 'ROWS', ...(rows.length ? { values: rows } : {}) };
      }) };
    } else if (url.pathname.includes('/values/')) {
      const range = decodeURIComponent(url.pathname.split('/values/')[1]);
      const match = /^'browser_readiness'!G(\d+):G(\d+)$/.exec(range);
      assert.ok(match, range);
      const start = Number(match[1]), end = Number(match[2]);
      assert.ok(end - start + 1 <= 20_000);
      const column = (state.values.values ?? []).slice(start - 1, end)
        .map(row => ((row[6] ?? '') === '' ? [] : [row[6]]));
      while (column.length && column.at(-1).length === 0) column.pop();
      data = { majorDimension: 'ROWS', range, ...(column.length ? { values: column } : {}) };
    } else data = state.metadata;
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return { state, job, request, collect: options => collectBrowserMetricExecutions({ repository: 'Nine-Minds/alga-psa', runId: '123', revision,
    sheetId: 'sheet-id', githubToken: 'github-secret', sheetsToken: 'sheets-secret', request, ...options }) };
}

test('binds explicit PR merge parents and current attempt, returning both browser expectations and raw rows', async () => {
  const { state, collect } = fixture();
  state.jobs[0].conclusion = 'failure'; state.jobs[1].conclusion = 'skipped';
  const result = await collect();
  assert.deepEqual(result.expectedExecutions.map(x => [x.edition, x.runAttempt, x.runStatus, x.conclusion]),
    [['community', 2, 'completed', 'failure'], ['enterprise', 2, 'completed', 'skipped']]);
  assert.equal(result.schemaVersion, 1);
  assert.ok(result.expectedExecutions.every(x => x.revision === revision && x.eventName === 'pull_request' && x.runId === '123'));
  assert.deepEqual(result.exportedRows, { header: BROWSER_HEADER, rows: state.values.values.slice(1) });
  assert.equal(state.calls.filter(x => x.url.pathname.endsWith('/actions/runs/123')).length, 2);
});

test('documentation-only executions need no browser artifact or export', async () => {
  const { state, collect } = fixture();
  state.jobs.forEach(job => { job.steps = notSelectedSteps(); });
  state.intercept = url => url.pathname.endsWith('/artifacts')
    ? new Response(JSON.stringify({ total_count: 0, artifacts: [] }), { status: 200 }) : null;
  state.values.values = [BROWSER_HEADER];
  const input = await collect({ revisionMode: 'artifact' });
  assert.ok(input.expectedExecutions.every(entry => entry.executionRequired === false && entry.revision === null));
  const result = reconcileBrowserMetricExecutions(input);
  assert.equal(result.status, 'not-required');
  assert.ok(result.records.every(record => record.status === 'not-required'));
});

for (const defect of ['missing-marker', 'skipped-marker', 'failed-job', 'recorder-executed']) {
  test(`does not excuse missing exports with ${defect}`, async () => {
    const { state, collect } = fixture();
    state.jobs[0].steps = notSelectedSteps();
    if (defect === 'missing-marker') state.jobs[0].steps.shift();
    if (defect === 'skipped-marker') state.jobs[0].steps[0].conclusion = 'skipped';
    if (defect === 'failed-job') state.jobs[0].conclusion = 'failure';
    if (defect === 'recorder-executed') state.jobs[0].steps[1].conclusion = 'success';
    state.values.values = [BROWSER_HEADER];
    const input = await collect();
    assert.notEqual(input.expectedExecutions[0].executionRequired, false);
    assert.equal(reconcileBrowserMetricExecutions(input).status, 'incomplete');
  });
}

test('the browser matrix emits non-selection evidence only for the explicit false filter result', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e-fresh-install-tests.yaml', 'utf8'));
  const job = Object.values(workflow.jobs).find(job => job.name === 'Production browser (${{ matrix.edition }})');
  const markers = job.steps.filter(step => step.name === 'Record browser tests not selected');
  assert.equal(markers.length, 1);
  assert.equal(markers[0].if, "needs.changes.outputs.run_tests == 'false'");
  assert.ok(job.steps.findIndex(step => step.name === 'Check build results') < job.steps.indexOf(markers[0]));
});

test('collects all current-attempt job pages before matching late browser jobs', async () => {
  const { state, job, collect } = fixture();
  state.jobs = [...Array.from({ length: 100 }, (_, i) => job(i + 10, `unit ${i}`)), ...state.jobs];
  assert.equal((await collect()).expectedExecutions.length, 2);
  assert.equal(state.calls.filter(x => x.url.pathname.includes('/jobs')).length, 2);
});

for (const terminal of [false, true]) test(`missing jobs remain ${terminal ? 'unknown terminal' : 'pending'} expectations`, async () => {
  const { state, collect } = fixture(); state.jobs = [];
  state.run.status = terminal ? 'completed' : 'in_progress';
  state.run.conclusion = terminal ? 'failure' : null;
  const result = await collect();
  assert.deepEqual(result.expectedExecutions.map(x => [x.runStatus, x.conclusion]),
    Array(2).fill([terminal ? 'completed' : 'pending', null]));
});

for (const defect of ['wrong-parent', 'wrong-job-head', 'wrong-workflow', 'wrong-repository', 'stale-job', 'duplicate-job', 'duplicate-edition', 'truncated-page', 'page-cap', 'sheet-cap', 'changing-attempt', 'changing-status', 'error', 'malformed']) {
  test(`rejects ${defect} rather than producing misleading evidence`, async () => {
    const { state, collect } = fixture();
    if (defect === 'wrong-job-head') state.jobs[0].head_sha = 'd'.repeat(40);
    if (defect === 'wrong-parent') state.parents[1].sha = 'd'.repeat(40);
    if (defect === 'wrong-workflow') state.run.path = '.github/workflows/unrelated.yml';
    if (defect === 'wrong-repository') state.run.repository.full_name = 'unowned/repo';
    if (defect === 'stale-job') state.jobs[0].run_attempt = 1;
    if (defect === 'duplicate-job') state.jobs.push(state.jobs[0]);
    if (defect === 'duplicate-edition') state.jobs.push({ ...state.jobs[0], id: 42 });
    if (defect === 'truncated-page') state.total = 3;
    if (defect === 'page-cap') state.total = 2001;
    if (defect === 'sheet-cap') state.metadata.sheets[0].properties.gridProperties.rowCount = 200_001;
    if (defect === 'missing-tab') state.metadata.sheets = [];
    if (defect === 'changing-attempt') state.after = { ...state.run, run_attempt: 3 };
    if (defect === 'changing-status') state.after = { ...state.run, status: 'in_progress' };
    if (defect === 'error') state.intercept = () => new Response('credential=must-not-print', { status: 403 });
    if (defect === 'malformed') state.intercept = () => new Response('credential=must-not-print', { status: 200 });
    await assert.rejects(collect, error => {
      assert.match(error.message, /^Browser metric collection failed \([a-z-]+\): [a-z-]+$/);
      assert.ok(!error.message.includes('credential'));
      return true;
    });
  });
}

test('non-PR revision must equal the exact run head, independent of Sheets contents', async () => {
  const { state, collect } = fixture(); state.run.event = 'workflow_dispatch'; state.run.head_sha = revision; state.jobs.forEach(job => { job.head_sha = revision; });
  assert.equal((await collect()).expectedExecutions[0].revision, revision);
  state.run.head_sha = head;
  await assert.rejects(collect);
});

test('index-scan cap failure reports the allocated grid and limit without reading a row of it', async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.rowCount = 200_001;
  await assert.rejects(collect, error => {
    assert.deepEqual(error.diagnostic, { phase: 'sheet-metadata', code: 'sheet-row-limit-exceeded',
      rowCount: 200_001, columnCount: 26, maxSheetRows: 200_000 });
    return true;
  });
  assert.equal(state.calls.filter(call => call.url.pathname.includes('/values')).length, 0);
});

test('the cap tolerates a tab far larger than retention leaves behind', async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.rowCount = 19_091;
  const result = await collect();
  assert.equal(result.collectionMetadata.indexRowCount, 19_091);
  assert.equal(result.collectionMetadata.matchedRowCount, 1);
  assert.equal(result.exportedRows.rows.length, 1);
});

for (const phase of ['run', 'sheet-metadata', 'sheet-index', 'sheet-values']) {
  test(`HTTP failure in ${phase} preserves its status but never the response body`, async () => {
    const { state, collect } = fixture();
    state.intercept = url => {
      const matches = phase === 'run' ? url.pathname.endsWith('/actions/runs/123')
        : phase === 'sheet-index' ? url.pathname.includes('/values/')
          : phase === 'sheet-values' ? url.pathname.endsWith('/values:batchGet')
            : url.hostname === 'sheets.googleapis.com' && !url.pathname.includes('/values');
      return matches ? new Response('credential=must-not-print', { status: 403 }) : null;
    };
    await assert.rejects(collect, error => {
      assert.deepEqual(error.diagnostic, { phase, code: 'http-error', httpStatus: 403 });
      assert.ok(!JSON.stringify(error).includes('must-not-print'));
      return true;
    });
  });
}

test('transport errors cannot inject their message or cause into diagnostics', async () => {
  const { collect } = fixture();
  await assert.rejects(collect({ request: async () => {
    throw new Error('credential=must-not-print', { cause: new Error('authorization=private') });
  } }), error => {
    assert.deepEqual(error.diagnostic, { phase: 'run', code: 'request-failed' });
    assert.equal(error.cause, undefined);
    assert.ok(!error.stack.includes('must-not-print'));
    return true;
  });
});

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
async function fileFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'browser-metric-collection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { state, request } = fixture();
  const options = {
    output: path.join(directory, 'executions.json'), diagnostics: path.join(directory, 'collection.json'),
    env: { GITHUB_REPOSITORY: 'Nine-Minds/alga-psa', GITHUB_TOKEN: 'github-secret', RECONCILE_RUN_ID: '123',
      RECONCILE_TESTED_REVISION: revision, TEST_METRICS_SHEET_ID: 'sheet-id',
      GOOGLE_SA_KEY: JSON.stringify({ client_email: 'fixture@example.invalid', private_key: privateKey }),
      GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md') },
    request: async (url, init) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        assert.equal(init.method, 'POST');
        const claims = JSON.parse(Buffer.from(init.body.get('assertion').split('.')[1], 'base64url'));
        assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
        return new Response(JSON.stringify({ access_token: 'sheets-secret' }));
      }
      return request(url, init);
    },
  };
  return { state, options };
}

test('collection failure replaces stale reports, removes stale evidence and retains safe diagnostics', async t => {
  const { state, options } = await fileFixture(t);
  state.metadata.sheets[0].properties.gridProperties.rowCount = 234_567;
  await writeFile(options.output, 'stale successful evidence');
  await writeFile(options.diagnostics, 'stale successful report');
  const result = await runBrowserMetricCollection(options);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.diagnostic, { phase: 'sheet-metadata', code: 'sheet-row-limit-exceeded',
    rowCount: 234_567, columnCount: 26, maxSheetRows: 200_000 });
  assert.deepEqual(JSON.parse(await readFile(options.diagnostics, 'utf8')), result);
  await assert.rejects(readFile(options.output), { code: 'ENOENT' });
  const summary = await readFile(options.env.GITHUB_STEP_SUMMARY, 'utf8');
  assert.match(summary, /sheet-row-limit-exceeded/);
  assert.match(summary, /234567/);
  assert.ok(!summary.includes('secret') && !summary.includes('PRIVATE KEY'));
});

test('successful collection preserves raw evidence and reports collection separately from reconciliation', async t => {
  const { options } = await fileFixture(t);
  const result = await runBrowserMetricCollection(options);
  assert.equal(result.status, 'collected');
  assert.equal(result.executionCount, 2);
  assert.equal(result.exportedRowCount, 1);
  assert.equal(result.matchedRowCount, 1);
  assert.equal(result.indexRowCount, 1000);
  assert.equal(JSON.parse(await readFile(options.output, 'utf8')).expectedExecutions.length, 2);
  assert.deepEqual(JSON.parse(await readFile(options.diagnostics, 'utf8')), result);
});

for (const [defect, code] of [['missing', 'service-account-missing'], ['malformed', 'invalid-service-account'],
  ['invalid-key', 'invalid-signing-key'], ['http', 'http-error'], ['transport', 'request-failed'],
  ['invalid-json', 'invalid-token-response'], ['missing-token', 'token-missing']]) {
  test(`OAuth ${defect} failure produces an artifact without exposing credentials`, async t => {
    const { options } = await fileFixture(t);
    if (defect === 'missing') delete options.env.GOOGLE_SA_KEY;
    if (defect === 'malformed') options.env.GOOGLE_SA_KEY = 'credential=must-not-print';
    if (defect === 'invalid-key') options.env.GOOGLE_SA_KEY = JSON.stringify({ client_email: 'test', private_key: 'credential=must-not-print' });
    options.request = async () => {
      if (defect === 'transport') throw new Error('credential=must-not-print');
      if (defect === 'missing-token') return new Response(JSON.stringify({ error: 'credential=must-not-print' }));
      return new Response('credential=must-not-print', { status: defect === 'http' ? 401 : 200 });
    };
    const result = await runBrowserMetricCollection(options);
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.diagnostic, { phase: 'sheets-authentication', code, ...(defect === 'http' ? { httpStatus: 401 } : {}) });
    const artifact = await readFile(options.diagnostics, 'utf8');
    const summary = await readFile(options.env.GITHUB_STEP_SUMMARY, 'utf8');
    assert.ok(![artifact, summary].some(text => /must-not-print|PRIVATE KEY|github-secret|sheets-secret/.test(text)));
    await assert.rejects(readFile(options.output), { code: 'ENOENT' });
  });
}

test('CLI failure exits nonzero, prints the safe phase and writes the backward-compatible default report', async t => {
  const { options } = await fileFixture(t);
  const result = spawnSync(process.execPath, ['scripts/collect-browser-metric-executions.mjs', options.output], {
    env: { ...process.env, ...options.env, GOOGLE_SA_KEY: 'credential=must-not-print' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sheets-authentication/);
  assert.match(result.stderr, /invalid-service-account/);
  assert.ok(!result.stderr.includes('must-not-print'));
  const report = JSON.parse(await readFile(path.join(path.dirname(options.output), 'browser-metric-collection.json'), 'utf8'));
  assert.equal(report.status, 'failed');
});

test('output aliases are rejected without deleting existing evidence', async t => {
  const { options } = await fileFixture(t);
  await writeFile(options.output, 'keep');
  await assert.rejects(runBrowserMetricCollection({ ...options, diagnostics: options.output }), /expected-distinct-output-paths/);
  assert.equal(await readFile(options.output, 'utf8'), 'keep');
});

test('workflow retains diagnostic and reconciliation reports even when collection fails', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/reconcile-browser-metrics.yml', 'utf8'));
  const steps = workflow.jobs.reconcile.steps;
  const collect = steps.find(step => step.run?.includes('scripts/collect-browser-metric-executions.mjs'));
  const upload = steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.match(collect.run, /browser-metric-collection\.json/);
  assert.equal(collect['continue-on-error'], undefined);
  assert.equal(upload.if, 'always()');
  assert.match(upload.with.path, /browser-metric-collection\.json/);
  assert.match(upload.with.path, /browser-metric-reconciliation\.json/);
  assert.equal(upload.with['if-no-files-found'], 'error');
});

test('deadline aborts a stalled request', async () => {
  const { collect } = fixture();
  await assert.rejects(collect({ timeoutMs: 5, request: async (_url, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('private timeout')); }, { once: true });
    });
  } }), /Browser metric collection failed \(run\)/);
});

test('scans run_url in bounded chunks and fetches matches at the first, middle and last rows', async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.rowCount = 45_000;
  const other = exportRow({ row_kind: 'run', run_url: 'https://github.com/Nine-Minds/alga-psa/actions/runs/999' });
  state.values.values = [BROWSER_HEADER, exportRow({ row_kind: 'run', run_url: RUN_URL, collected: 'first' })];
  for (let row = 3; row <= 22_000; row++) state.values.values.push(row % 2 ? other : []);
  // Adjacent middle matches, then a lone match on the very last allocated row.
  state.values.values.push(exportRow({ row_kind: 'run', run_url: RUN_URL, collected: 'middle-a' }),
    exportRow({ row_kind: 'journey', run_url: RUN_URL, collected: 'middle-b' }));
  for (let row = 22_003; row < 45_000; row++) state.values.values.push([]);
  state.values.values.push(exportRow({ row_kind: 'run', run_url: RUN_URL, collected: 'last' }));
  const result = await collect();
  assert.deepEqual(result.exportedRows.rows.map(row => row[BROWSER_HEADER.indexOf('collected')]),
    ['first', 'middle-a', 'middle-b', 'last']);
  assert.equal(result.collectionMetadata.matchedRowCount, 4);
  assert.deepEqual(state.calls.filter(call => call.url.pathname.includes('/values/'))
    .map(call => decodeURIComponent(call.url.pathname.split('/values/')[1])),
    ["'browser_readiness'!G1:G20000", "'browser_readiness'!G20001:G40000", "'browser_readiness'!G40001:G45000"]);
  // Header plus one range per run of adjacent matches; no other run is fetched.
  assert.deepEqual(state.calls.filter(call => call.url.pathname.endsWith('/values:batchGet'))
    .flatMap(call => call.url.searchParams.getAll('ranges')),
    ["'browser_readiness'!A1:Y2", "'browser_readiness'!A22001:Y22002", "'browser_readiness'!A45000:Y45000"]);
});

test('rows belonging to other runs are never fetched, whatever the header claims', async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.rowCount = 6;
  state.values.values = [BROWSER_HEADER,
    exportRow({ row_kind: 'run', run_url: 'https://github.com/Nine-Minds/alga-psa/actions/runs/122' }),
    exportRow({ row_kind: 'run', run_url: 'https://github.com/other/repository/actions/runs/123' }),
    exportRow({ row_kind: 'run', run_url: 'https://github.com/Nine-Minds/alga-psa/actions/runs/1234' }),
    exportRow({ row_kind: 'run', run_url: RUN_URL, collected: 'mine' }),
    exportRow({ row_kind: 'run', run_url: 'https://github.com/Nine-Minds/alga-psa/actions/runs/124' })];
  const result = await collect();
  assert.deepEqual(result.exportedRows.rows.map(row => row[BROWSER_HEADER.indexOf('collected')]), ['mine']);
  assert.deepEqual(state.calls.filter(call => call.url.pathname.endsWith('/values:batchGet'))
    .flatMap(call => call.url.searchParams.getAll('ranges')),
    ["'browser_readiness'!A1:Y1", "'browser_readiness'!A5:Y5"]);
});

test('other attempts of the same run are fetched so stale attempts stay detectable', async () => {
  const { state, collect } = fixture();
  state.run.conclusion = 'success';
  for (const job of state.jobs) job.steps = [{ name: 'Record browser journey readiness', status: 'completed', conclusion: 'success' }];
  state.metadata.sheets[0].properties.gridProperties.rowCount = 3;
  const common = { schema_version: 2, tested_sha: revision, edition: 'community', event_name: 'pull_request',
    run_url: RUN_URL, run_id: '123', row_kind: 'run', lane_status: 'passed' };
  state.values.values = [BROWSER_HEADER, exportRow({ ...common, run_attempt: 1 }), exportRow({ ...common, run_attempt: 2, collected: 1, executed: 1 })];
  const result = await collect();
  assert.equal(result.collectionMetadata.matchedRowCount, 2);
  const record = reconcileBrowserMetricExecutions(result).records.find(entry => entry.edition === 'community');
  assert.deepEqual(record.staleAttempts, [1]);
});

test('a fetched row that is not a row cannot pass cell validation', async () => {
  const { state, collect } = fixture();
  state.values.values[1][6] = RUN_URL;
  state.intercept = url => (url.pathname.endsWith('/values:batchGet')
    ? new Response(JSON.stringify({ valueRanges: [{ range: 'r', majorDimension: 'ROWS', values: [[{ nested: true }]] }] }), { status: 200 })
    : null);
  await assert.rejects(collect, error => {
    assert.deepEqual(error.diagnostic, { phase: 'sheet-values', code: 'invalid-sheet-cells' });
    return true;
  });
});

test('a truncated batch response is refused rather than dropping a matched row', async () => {
  const { state, collect } = fixture();
  state.intercept = url => (url.pathname.endsWith('/values:batchGet')
    ? new Response(JSON.stringify({ valueRanges: [] }), { status: 200 }) : null);
  await assert.rejects(collect, error => {
    assert.deepEqual(error.diagnostic, { phase: 'sheet-values', code: 'invalid-sheet-range' });
    return true;
  });
});

test('a malformed index column is refused rather than silently matching nothing', async () => {
  const { state, collect } = fixture();
  state.intercept = url => (url.pathname.includes('/values/')
    ? new Response(JSON.stringify({ majorDimension: 'ROWS', values: [['a', 'b']] }), { status: 200 }) : null);
  await assert.rejects(collect, error => {
    assert.deepEqual(error.diagnostic, { phase: 'sheet-index', code: 'invalid-sheet-cells' });
    return true;
  });
});

test('a header-only tab reports the current header and matches nothing', async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.rowCount = 1;
  state.values.values = [BROWSER_HEADER];
  const result = await collect();
  assert.equal(result.collectionMetadata.sheetObservation, 'current-header');
  assert.equal(result.collectionMetadata.matchedRowCount, 0);
  assert.deepEqual(result.exportedRows, { header: BROWSER_HEADER, rows: [] });
});

test('an allocated but empty tab has no header to trust', async () => {
  const { state, collect } = fixture();
  state.values.values = [];
  await assert.rejects(collect, error => {
    assert.deepEqual(error.diagnostic, { phase: 'sheet-values', code: 'invalid-sheet-header' });
    return true;
  });
});

test('absent browser jobs retain a terminal parent cancellation', async () => {
  const { state, collect } = fixture(); state.jobs = []; state.run.conclusion = 'cancelled';
  assert.deepEqual((await collect()).expectedExecutions.map(row => [row.runStatus, row.conclusion]),
    [['completed', 'cancelled'], ['completed', 'cancelled']]);
});


test('repository identity is case insensitive with canonical lowercase output', async () => {
  const { collect } = fixture();
  const result = await collect({ repository: 'nine-minds/ALGA-psa' });
  assert.ok(result.expectedExecutions.every(row => row.repository === 'nine-minds/alga-psa'));
  assert.deepEqual(result.collectionMetadata, { testedRevisionSource: 'operator-supplied',
    revisionValidation: 'merge-run-head-parent-verified', checkoutIndependentlyVerified: false, sheetObservation: 'current-header',
    sheetReadStrategy: 'index-filtered', indexRowCount: 1000, matchedRowCount: 1 });
});

for (const conclusion of ['success', 'failure', 'skipped']) test(`retains actual recorder ${conclusion} separately from job result`, async () => {
  const { state, collect } = fixture();
  state.jobs[0].steps = [{ name: 'Record browser journey readiness', status: 'completed', conclusion }];
  const result = await collect();
  assert.equal(result.expectedExecutions[0].recorderStatus, 'completed');
  assert.equal(result.expectedExecutions[0].recorderConclusion, conclusion);
  assert.equal(result.expectedExecutions[1].recorderStatus, null);
  assert.equal(result.expectedExecutions[1].recorderConclusion, null);
});

test('duplicate recorder steps fail closed', async () => {
  const { state, collect } = fixture();
  const recorder = { name: 'Record browser journey readiness', status: 'completed', conclusion: 'success' };
  state.jobs[0].steps = [recorder, recorder];
  await assert.rejects(collect, /failed \(jobs\)/);
});

test('collected executions reconcile complete CE/EE exports and detect a missing enterprise export', async () => {
  const { state, collect } = fixture();
  state.run.conclusion = 'success';
  for (const job of state.jobs) job.steps = [{ name: 'Record browser journey readiness', status: 'completed', conclusion: 'success' }];
  const row = values => BROWSER_HEADER.map(column => values[column] ?? '');
  state.values.values = [BROWSER_HEADER];
  for (const edition of ['community', 'enterprise']) {
    const common = { schema_version: 2, tested_sha: revision, edition, event_name: 'pull_request',
      run_url: 'https://github.com/Nine-Minds/alga-psa/actions/runs/123', run_id: '123', run_attempt: 2,
      lane_status: 'passed', authentication: 'real-credentials', server_lifecycle: 'externally-started-production-build' };
    state.values.values.push(row({ ...common, row_kind: 'run', collected: 1, executed: 1 }),
      row({ ...common, row_kind: 'journey', project_id: edition, project: edition, file: 'test.spec.ts',
        journey: ' ["test journey"]', required: true, observed: true, outcome: 'expected', first_attempt: 'passed', retry_count: 0 }));
  }
  assert.equal(reconcileBrowserMetricExecutions(await collect()).status, 'passed');
  state.values.values = state.values.values.slice(0, 3);
  const incomplete = reconcileBrowserMetricExecutions(await collect());
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.records.find(record => record.edition === 'enterprise').status, 'missing-export');
});


test('missing browser tab preserves cancelled expectations as explicit missing exports', async () => {
  const { state, collect } = fixture(); state.metadata.sheets = []; state.jobs = []; state.run.conclusion = 'cancelled';
  const result = await collect();
  assert.equal(result.collectionMetadata.sheetObservation, 'missing-tab');
  assert.deepEqual(result.collectionMetadata.indexRowCount, 0);
  assert.deepEqual(result.exportedRows, { header: BROWSER_HEADER, rows: [] });
  assert.ok(reconcileBrowserMetricExecutions(result).records.every(record => record.status === 'cancelled'));
  assert.equal(state.calls.filter(call => call.url.pathname.includes('/values')).length, 0);
});
for (const width of [18, 20]) test(`legacy ${width}-column sheet is readable without inventing current evidence`, async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.columnCount = width;
  state.values.values = [BROWSER_HEADER.slice(0, width)];
  const result = await collect();
  assert.equal(result.collectionMetadata.sheetObservation, 'legacy-header');
  assert.equal(reconcileBrowserMetricExecutions(result).status, 'incomplete');
  assert.deepEqual(state.calls.filter(call => call.url.pathname.endsWith('/values:batchGet'))
    .flatMap(call => call.url.searchParams.getAll('ranges')), [`'browser_readiness'!A1:${String.fromCharCode(64 + width)}1`]);
});


test('historical run uses immutable run head while associated PR metadata changes', async () => {
  const { state, collect } = fixture();
  // GitHub's historical run response contains current PR head/base metadata.
  state.run.pull_requests[0].head.sha = 'd'.repeat(40);
  state.run.pull_requests[0].base.sha = 'e'.repeat(40);
  state.after = structuredClone(state.run);
  state.after.pull_requests[0].head.sha = 'f'.repeat(40);
  const result = await collect();
  assert.equal(result.expectedExecutions[0].revision, revision);
  assert.equal(result.collectionMetadata.revisionValidation, 'merge-run-head-parent-verified');
  assert.equal(result.collectionMetadata.checkoutIndependentlyVerified, false);
});

test('historical pull request run permits absent mutable PR association', async () => {
  const { state, collect } = fixture(); state.run.pull_requests = [];
  assert.equal((await collect()).collectionMetadata.revisionValidation, 'merge-run-head-parent-verified');
});
