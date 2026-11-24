import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { DETAIL_HEADER, recordsCoverageDetail } from '../record-test-metrics.mjs';
import { COVERAGE_RETENTION_DAYS, planCoverageMetricsRetention } from '../lib/coverage-metrics-retention.mjs';
import { runCoverageMetricsRetention } from '../coverage-metrics-retention.mjs';

// 2026-11-23 with a 90-day window puts the cutoff at 2026-08-25T12:00Z.
const NOW = Date.UTC(2026, 10, 23, 12);
const OLD_A = '2026-07-14T19:27:02.274Z', OLD_B = '2026-08-25T11:59:59.999Z';
const KEPT = '2026-08-25T12:00:00.000Z', RECENT = '2026-11-21T04:22:41.410Z';
// Grid rows 2-3 and 6 are past the window, row 4 is an allocated blank, row 5
// has an unreadable timestamp and rows 7-8 are inside the window.
const COLUMN = [OLD_A, OLD_A, '', 'sometime last summer', OLD_B, KEPT, RECENT];

test('rows older than the window are deleted bottom-up; blank and unreadable rows stay', () => {
  const plan = planCoverageMetricsRetention({ header: [...DETAIL_HEADER], timestamps: COLUMN, now: NOW });
  assert.equal(plan.expiredRowCount, 3);
  assert.equal(plan.retainedRowCount, 2);
  assert.equal(plan.unreadableTimestampCount, 1);
  assert.deepEqual(plan.deletions, [
    { startIndex: 5, endIndex: 6, timestamps: [OLD_B] },
    { startIndex: 1, endIndex: 3, timestamps: [OLD_A, OLD_A] }]);
});

test('the original 13-column header is still recognized', () => {
  const plan = planCoverageMetricsRetention({ header: DETAIL_HEADER.slice(0, 13), timestamps: [RECENT], now: NOW });
  assert.equal(plan.expiredRowCount, 0);
});

for (const [name, header] of [['no header', []], ['a foreign header', ['when', 'what']],
  ['a reordered header', [DETAIL_HEADER[1], DETAIL_HEADER[0], ...DETAIL_HEADER.slice(2)]],
  ['a longer header', [...DETAIL_HEADER, 'extra']]]) {
  test(`${name} stops the plan rather than deleting by guessed column positions`, () => {
    assert.throws(() => planCoverageMetricsRetention({ header, timestamps: COLUMN, now: NOW }));
  });
}

function sheetsFixture(column = COLUMN) {
  const state = { column: [...column], rowCount: column.length + 1, requests: [], onVerify: () => {}, reads: 0 };
  const json = data => new Response(JSON.stringify(data), { status: 200 });
  const request = async (input, options) => {
    const url = new URL(input);
    state.requests.push({ url, method: options.method ?? 'GET' });
    assert.equal(options.headers.authorization, 'Bearer sheets-token');
    if (url.searchParams.get('fields') === 'spreadsheetId,sheets.properties') {
      return json({ spreadsheetId: 'sheet-id', sheets: [
        { properties: { sheetId: 5, title: 'metrics', gridProperties: { rowCount: 10, columnCount: 28 } } },
        { properties: { sheetId: 91, title: 'coverage_by_dir', gridProperties: { rowCount: state.rowCount, columnCount: 17 } } }] });
    }
    if (url.pathname.endsWith(':batchUpdate')) { state.batchUpdate = JSON.parse(options.body); return json({ replies: [] }); }
    const range = decodeURIComponent(url.pathname.split('/values/')[1]);
    if (range === "'coverage_by_dir'!A1:Q1") return json({ range, majorDimension: 'ROWS', values: [[...DETAIL_HEADER]] });
    const single = /^'coverage_by_dir'!A(\d+):A(\d+)$/.exec(range);
    assert.ok(single, range);
    if (++state.reads > 1) state.onVerify();
    const rows = state.column.slice(Number(single[1]) - 2, Number(single[2]) - 1).map(value => (value === '' ? [] : [value]));
    while (rows.length && rows.at(-1).length === 0) rows.pop();
    return json({ range, majorDimension: 'ROWS', values: rows });
  };
  const run = options => runCoverageMetricsRetention({ env: { TEST_METRICS_SHEET_ID: 'sheet-id' },
    token: 'sheets-token', now: NOW, request, log: () => {}, ...options });
  return { state, run };
}

test('a dry run reports the plan and writes nothing', async () => {
  const { state, run } = sheetsFixture();
  const result = await run();
  assert.equal(result.applied, false);
  assert.equal(result.expiredRowCount, 3);
  assert.equal(result.deletedRowCount, 0);
  assert.equal(state.batchUpdate, undefined);
  assert.ok(!state.requests.some(entry => entry.method !== 'GET'));
});

test('applying deletes the expired rows of the coverage tab only, bottom-up', async () => {
  const { state, run } = sheetsFixture();
  const result = await run({ dryRun: false });
  assert.equal(result.applied, true);
  assert.equal(result.deletedRowCount, 3);
  assert.deepEqual(state.batchUpdate.requests, [
    { deleteDimension: { range: { sheetId: 91, dimension: 'ROWS', startIndex: 5, endIndex: 6 } } },
    { deleteDimension: { range: { sheetId: 91, dimension: 'ROWS', startIndex: 1, endIndex: 3 } } }]);
});

test('rows that moved between the read and the delete are refused', async () => {
  const { state, run } = sheetsFixture();
  // A hand edit inserts a row above the expired block after it was planned.
  state.onVerify = () => { state.onVerify = () => {}; state.column.unshift(RECENT); state.rowCount++; };
  await assert.rejects(run({ dryRun: false }), /changed between the read and the delete/);
  assert.equal(state.batchUpdate, undefined);
});

test('a tab with nothing past the window is read and left alone', async () => {
  const { state, run } = sheetsFixture([KEPT, RECENT]);
  const result = await run({ dryRun: false });
  assert.equal(result.applied, true);
  assert.equal(result.deletedRowCount, 0);
  assert.equal(state.batchUpdate, undefined);
});

test('missing configuration fails before any request', async () => {
  await assert.rejects(runCoverageMetricsRetention({ env: {}, token: 'sheets-token',
    request: async () => assert.fail('no request expected') }), /TEST_METRICS_SHEET_ID is required/);
  await assert.rejects(runCoverageMetricsRetention({ env: { TEST_METRICS_SHEET_ID: 'sheet-id' },
    request: async () => assert.fail('no request expected') }), /GOOGLE_SA_KEY is required/);
});

test('only pushes to main record per-directory coverage rows', () => {
  const env = (event, ref, detail = '1') => ({ GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: ref, TEST_METRICS_DETAIL: detail });
  assert.equal(recordsCoverageDetail(env('push', 'main')), true);
  assert.equal(recordsCoverageDetail(env('push', 'main', '')), false);
  assert.equal(recordsCoverageDetail(env('push', 'develop')), false);
  assert.equal(recordsCoverageDetail(env('pull_request', '4494/merge')), false);
  assert.equal(recordsCoverageDetail(env('workflow_dispatch', 'main')), false);
  assert.equal(recordsCoverageDetail({ TEST_METRICS_DETAIL: '1' }), false);
});

test('the retention workflow schedules itself, serializes runs and defaults dispatch to a dry run', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/coverage-metrics-retention.yml', 'utf8'));
  assert.deepEqual(workflow.on.schedule, [{ cron: '40 6 * * 0' }]);
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, true);
  assert.equal(workflow.concurrency.group, 'coverage-metrics-retention');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.permissions.issues, undefined);
  const steps = workflow.jobs.retain.steps;
  const retain = steps.find(step => step.run?.includes('scripts/coverage-metrics-retention.mjs'));
  assert.match(retain.env.RETENTION_MODE, /inputs\.dry_run.*--dry-run.*--apply/s);
  assert.equal(retain.env.GOOGLE_SA_KEY, '${{ secrets.TEST_METRICS_GOOGLE_SA_KEY }}');
  const notice = steps.at(-1);
  assert.equal(notice.if, 'failure()');
  assert.match(notice.run, /scripts\/record-workflow-health\.mjs/);
});

test('the documented retention window is the one the code enforces', () => {
  assert.equal(COVERAGE_RETENTION_DAYS, 90);
  const reference = readFileSync('docs/reference/test-metrics.md', 'utf8');
  assert.match(reference, /coverage-metrics-retention\.mjs/);
  assert.match(reference, new RegExp(`\\*\\*${COVERAGE_RETENTION_DAYS} days\\*\\*`));
});
