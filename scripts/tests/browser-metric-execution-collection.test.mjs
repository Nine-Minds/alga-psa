import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBrowserMetricExecutions } from '../lib/collect-browser-metric-executions.mjs';
import { reconcileBrowserMetricExecutions } from '../lib/reconcile-browser-metric-executions.mjs';
import { BROWSER_HEADER } from '../record-browser-metrics.mjs';
const revision = 'a'.repeat(40), head = 'b'.repeat(40), base = 'c'.repeat(40);
function fixture() {
  const run = { id: 123, repository: { full_name: 'Nine-Minds/alga-psa' }, path: '.github/workflows/production-regression.yml',
    run_attempt: 2, head_sha: head, status: 'completed', conclusion: 'failure', event: 'pull_request',
    pull_requests: [{ number: 3343, head: { sha: head }, base: { sha: base } }] };
  const job = (id, name) => ({ id, name, run_id: 123, run_attempt: 2, head_sha: head, status: 'completed', conclusion: 'success' });
  const jobs = [job(1, 'browser / Production browser (community)'), job(2, 'browser / Production browser (enterprise)')];
  const metadata = { spreadsheetId: 'sheet-id', sheets: [{ properties: { title: 'browser_readiness', gridProperties: { rowCount: 1000, columnCount: 26 } } }] };
  const values = { majorDimension: 'ROWS', values: [BROWSER_HEADER, ['2026-09-09', 2, 'run']] };
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
    } else if (url.pathname.includes('/values/')) {
      const range = decodeURIComponent(url.pathname.split('/values/')[1]);
      const match = /^'browser_readiness'!A(\d+):[R-Y](\d+)$/.exec(range);
      assert.ok(match);
      const start = Number(match[1]), end = Number(match[2]);
      assert.ok(end - start + 1 <= 2000);
      const selected = state.values.values?.slice(start - 1, end);
      while (selected?.length && selected.at(-1).length === 0) selected.pop();
      data = { ...state.values, values: selected, range };
    } else data = state.metadata;
    return new Response(JSON.stringify(data), { status: 200 });
  };
  return { state, job, collect: options => collectBrowserMetricExecutions({ repository: 'Nine-Minds/alga-psa', runId: '123', revision,
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

for (const defect of ['wrong-parent', 'wrong-job-head', 'missing-pr', 'wrong-workflow', 'wrong-repository', 'stale-job', 'duplicate-job', 'duplicate-edition', 'truncated-page', 'page-cap', 'sheet-cap', 'changing-attempt', 'changing-status', 'error', 'malformed']) {
  test(`rejects ${defect} rather than producing misleading evidence`, async () => {
    const { state, collect } = fixture();
    if (defect === 'wrong-job-head') state.jobs[0].head_sha = 'd'.repeat(40);
    if (defect === 'wrong-parent') state.parents[0].sha = 'd'.repeat(40);
    if (defect === 'missing-pr') state.run.pull_requests = [];
    if (defect === 'wrong-workflow') state.run.path = '.github/workflows/unrelated.yml';
    if (defect === 'wrong-repository') state.run.repository.full_name = 'unowned/repo';
    if (defect === 'stale-job') state.jobs[0].run_attempt = 1;
    if (defect === 'duplicate-job') state.jobs.push(state.jobs[0]);
    if (defect === 'duplicate-edition') state.jobs.push({ ...state.jobs[0], id: 42 });
    if (defect === 'truncated-page') state.total = 3;
    if (defect === 'page-cap') state.total = 2001;
    if (defect === 'sheet-cap') state.metadata.sheets[0].properties.gridProperties.rowCount = 10001;
    if (defect === 'missing-tab') state.metadata.sheets = [];
    if (defect === 'changing-attempt') state.after = { ...state.run, run_attempt: 3 };
    if (defect === 'changing-status') state.after = { ...state.run, status: 'in_progress' };
    if (defect === 'error') state.intercept = () => new Response('credential=must-not-print', { status: 403 });
    if (defect === 'malformed') state.intercept = () => new Response('credential=must-not-print', { status: 200 });
    await assert.rejects(collect, error => {
      assert.match(error.message, /^Browser metric collection failed \([a-z-]+\)$/);
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

test('deadline aborts a stalled request', async () => {
  const { collect } = fixture();
  await assert.rejects(collect({ timeoutMs: 5, request: async (_url, { signal }) => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('private timeout')); }, { once: true });
    });
  } }), /Browser metric collection failed \(run\)/);
});

test('chunks large grids within 50k cells and preserves blank row offsets', async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.rowCount = 4500;
  state.values.values = [BROWSER_HEADER, ['first']];
  // No cells in the rest of the first chunk or start of the second.
  for (let row = 2; row < 2400; row++) state.values.values.push([]);
  state.values.values.push(['later']);
  const result = await collect();
  assert.equal(result.exportedRows.rows.length, 2400);
  assert.deepEqual(result.exportedRows.rows[2399], ['later']);
  assert.deepEqual(result.exportedRows.rows[1999], []);
  const reads = state.calls.filter(call => call.url.pathname.includes('/values/'));
  assert.deepEqual(reads.map(call => decodeURIComponent(call.url.pathname.split('/values/')[1])),
    ["'browser_readiness'!A1:Y2000", "'browser_readiness'!A2001:Y4000", "'browser_readiness'!A4001:Y4500"]);
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
    revisionValidation: 'merge-parents-verified', checkoutIndependentlyVerified: false, sheetObservation: 'current-header' });
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
  assert.deepEqual(result.exportedRows, { header: BROWSER_HEADER, rows: [] });
  assert.ok(reconcileBrowserMetricExecutions(result).records.every(record => record.status === 'cancelled'));
  assert.equal(state.calls.filter(call => call.url.pathname.includes('/values/')).length, 0);
});
for (const width of [18, 20]) test(`legacy ${width}-column sheet is readable without inventing current evidence`, async () => {
  const { state, collect } = fixture();
  state.metadata.sheets[0].properties.gridProperties.columnCount = width;
  state.values.values = [BROWSER_HEADER.slice(0, width)];
  const result = await collect();
  assert.equal(result.collectionMetadata.sheetObservation, 'legacy-header');
  assert.equal(reconcileBrowserMetricExecutions(result).status, 'incomplete');
  assert.ok(decodeURIComponent(state.calls.find(call => call.url.pathname.includes('/values/')).url.pathname)
    .endsWith(`A1:${String.fromCharCode(64 + width)}1000`));
});
