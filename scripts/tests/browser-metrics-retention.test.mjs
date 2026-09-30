import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { BROWSER_HEADER } from '../record-browser-metrics.mjs';
import { BROWSER_RETENTION_DAYS, BROWSER_WEEKLY_HEADER, browserSummaryKey, isoWeek,
  planBrowserMetricsRetention } from '../lib/browser-metrics-retention.mjs';
import { runBrowserMetricsRetention } from '../browser-metrics-retention.mjs';

const row = values => BROWSER_HEADER.map(column => values[column] ?? '');
// 2026-09-28 with a 90-day window puts the cutoff at 2026-06-30: ISO weeks 19,
// 20 and 26 are wholly outside it, week 27 straddles it and stays.
const NOW = Date.UTC(2026, 8, 28, 12);
const GROUPS = [['2026-W19', 'community', 'pr'], ['2026-W19', 'enterprise', 'pr'], ['2026-W26', 'community', 'nightly']];
const KEYS = GROUPS.map(group => browserSummaryKey(...group));

// Grid rows 2-8 are archivable (row 5 is an allocated blank), row 9 has an
// unreadable timestamp and rows 10-11 are inside the window.
function grid() {
  const old = { run_url: 'https://github.com/Nine-Minds/alga-psa/actions/runs/1', schema_version: 2 };
  return [[...BROWSER_HEADER],
    row({ ...old, timestamp_utc: '2026-05-04T01:00:00.000Z', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'passed', collected: 5, executed: 5 }),
    row({ ...old, timestamp_utc: '2026-05-04T01:00:01.000Z', row_kind: 'journey', edition: 'community', run_kind: 'pr', lane_status: 'passed', retry_count: 0 }),
    row({ ...old, timestamp_utc: '2026-05-04T01:00:02.000Z', row_kind: 'journey', edition: 'community', run_kind: 'pr', lane_status: 'passed', retry_count: 2 }),
    [],
    row({ ...old, timestamp_utc: '2026-05-06T02:00:00.000Z', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'failed', collected: 7, executed: 3 }),
    row({ ...old, timestamp_utc: '2026-05-10T23:00:00.000Z', row_kind: 'run', edition: 'enterprise', run_kind: 'pr', lane_status: 'incomplete' }),
    row({ ...old, timestamp_utc: '2026-06-22T00:00:00.000Z', row_kind: 'run', edition: 'community', run_kind: 'nightly', lane_status: 'passed', collected: 9, executed: 9 }),
    row({ ...old, timestamp_utc: 'sometime last spring', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'passed' }),
    row({ ...old, timestamp_utc: '2026-06-29T00:00:00.000Z', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'passed' }),
    row({ ...old, timestamp_utc: '2026-09-20T00:00:00.000Z', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'passed' })];
}

test('ISO weeks follow the 8601 year, including the ones a calendar year does not own', () => {
  assert.equal(isoWeek(Date.parse('2026-01-01T00:00:00.000Z')), '2026-W01');
  assert.equal(isoWeek(Date.parse('2027-01-01T00:00:00.000Z')), '2026-W53');
  assert.equal(isoWeek(Date.parse('2026-05-10T23:59:59.000Z')), '2026-W19');
  assert.equal(isoWeek(Date.parse('2026-05-11T00:00:00.000Z')), '2026-W20');
});

test('weekly summaries count runs, outcomes and retried journeys and take medians', () => {
  const plan = planBrowserMetricsRetention({ values: grid(), now: NOW });
  assert.equal(plan.archivedRowCount, 6);
  assert.equal(plan.retainedRowCount, 2);
  assert.equal(plan.unreadableTimestampCount, 1);
  assert.deepEqual(plan.summaries.map(summary => summary.key), KEYS);
  assert.deepEqual(plan.summaries[0], { key: KEYS[0], week: '2026-W19', edition: 'community', runKind: 'pr',
    runs: 2, passed: 1, failed: 1, incomplete: 0, journeysWithRetry: 1, archivedRows: 4,
    medianCollected: 6, medianExecuted: 4, alreadySummarized: false });
  assert.deepEqual(plan.summaries[1], { key: KEYS[1], week: '2026-W19', edition: 'enterprise', runKind: 'pr',
    runs: 1, passed: 0, failed: 0, incomplete: 1, journeysWithRetry: 0, archivedRows: 1,
    medianCollected: '', medianExecuted: '', alreadySummarized: false });
  assert.deepEqual(plan.summaries[2].medianCollected, 9);
  assert.deepEqual(plan.summaryRows.map(summary => summary.slice(0, 11)), [
    ['2026-W19', 'community', 'pr', 2, 1, 1, 0, 1, 6, 4, 4],
    ['2026-W19', 'enterprise', 'pr', 1, 0, 0, 1, 0, '', '', 1],
    ['2026-W26', 'community', 'nightly', 1, 1, 0, 0, 0, 9, 9, 1]]);
  assert.deepEqual(plan.summaryRows.map(summary => summary.slice(11)),
    Array(3).fill([1, new Date(NOW).toISOString()]));
  assert.equal(BROWSER_WEEKLY_HEADER.length, plan.summaryRows[0].length);
});

test('a re-run appends nothing for weeks already summarized but still clears their rows', () => {
  const plan = planBrowserMetricsRetention({ values: grid(), now: NOW, existingSummaryKeys: KEYS });
  assert.deepEqual(plan.summaryRows, []);
  assert.ok(plan.summaries.every(summary => summary.alreadySummarized));
  assert.equal(plan.archivedRowCount, 6);
  assert.equal(plan.deletions.length, 2);
});

test('deletion ranges cover only archived rows, in bottom-up zero-based blocks', () => {
  const plan = planBrowserMetricsRetention({ values: grid(), now: NOW });
  assert.deepEqual(plan.deletions.map(({ startIndex, endIndex }) => ({ startIndex, endIndex })),
    [{ startIndex: 5, endIndex: 8 }, { startIndex: 1, endIndex: 4 }]);
  // Bottom-up: applying each block in order cannot shift a later block's rows.
  assert.ok(plan.deletions.every((block, index) => index === 0 || block.endIndex <= plan.deletions[index - 1].startIndex));
  assert.deepEqual(plan.deletions.map(block => block.timestamps),
    [['2026-05-06T02:00:00.000Z', '2026-05-10T23:00:00.000Z', '2026-06-22T00:00:00.000Z'],
      ['2026-05-04T01:00:00.000Z', '2026-05-04T01:00:01.000Z', '2026-05-04T01:00:02.000Z']]);
});

test('rows inside the window, unreadable rows and the header are never archived', () => {
  const plan = planBrowserMetricsRetention({ values: grid(), now: NOW });
  const deleted = plan.deletions.flatMap(block => Array.from({ length: block.endIndex - block.startIndex },
    (_, offset) => block.startIndex + offset + 1));
  assert.deepEqual(deleted.sort((a, b) => a - b), [2, 3, 4, 6, 7, 8]);
  assert.ok(![1, 9, 10, 11].some(number => deleted.includes(number)));
});

test('a week straddling the cutoff waits rather than being summarized in halves', () => {
  const values = [[...BROWSER_HEADER],
    row({ timestamp_utc: '2026-06-29T00:00:00.000Z', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'passed' }),
    row({ timestamp_utc: '2026-07-05T23:59:59.000Z', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'passed' })];
  assert.equal(planBrowserMetricsRetention({ values, now: NOW }).archivedRowCount, 0);
  // One week later the whole week is outside the window and leaves together.
  const later = planBrowserMetricsRetention({ values, now: NOW + 7 * 86_400_000 });
  assert.equal(later.archivedRowCount, 2);
  assert.deepEqual(later.summaries.map(summary => [summary.week, summary.runs]), [['2026-W27', 2]]);
});

test('legacy-width rows summarize with an unknown run kind instead of being dropped', () => {
  const values = [BROWSER_HEADER.slice(0, 18),
    row({ timestamp_utc: '2026-05-04T00:00:00.000Z', row_kind: 'run', edition: 'community', lane_status: 'passed', collected: 3, executed: 3 }).slice(0, 18)];
  const plan = planBrowserMetricsRetention({ values, now: NOW });
  assert.deepEqual(plan.summaries.map(summary => summary.key), [browserSummaryKey('2026-W19', 'community', 'unknown')]);
  assert.equal(plan.archivedRowCount, 1);
});

for (const [name, values] of [['no header', []], ['a foreign header', [['when', 'what']]],
  ['a reordered header', [[BROWSER_HEADER[1], BROWSER_HEADER[0], ...BROWSER_HEADER.slice(2)]]]]) {
  test(`${name} stops the plan rather than deleting by guessed column positions`, () => {
    assert.throws(() => planBrowserMetricsRetention({ values, now: NOW }));
  });
}

function sheetsFixture(values = grid()) {
  const state = { values, weekly: null, weeklyStatus: 400, rowCount: values.length, appends: [], requests: [], ranges: [], onColumnRead: () => {}, failAppend: false };
  const json = data => new Response(JSON.stringify(data), { status: 200 });
  const trimmed = rows => { const copy = rows.map(cells => [...cells]); while (copy.length && copy.at(-1).length === 0) copy.pop(); return copy; };
  const request = async (input, options) => {
    const url = new URL(input);
    state.requests.push({ url, method: options.method ?? 'GET', body: options.body });
    assert.equal(options.headers.authorization, 'Bearer sheets-token');
    if (url.searchParams.get('fields') === 'spreadsheetId,sheets.properties') {
      return json({ spreadsheetId: 'sheet-id', sheets: [{ properties: { sheetId: 77, title: 'browser_readiness',
        gridProperties: { rowCount: state.rowCount, columnCount: 25 } } }] });
    }
    if (url.pathname.endsWith(':batchUpdate')) { state.batchUpdate = JSON.parse(options.body); return json({ replies: [] }); }
    const range = decodeURIComponent(url.pathname.split('/values/')[1]);
    state.ranges.push(range);
    if (range === "'browser_readiness_weekly'!A2:C") {
      return state.weekly === null ? new Response(JSON.stringify({ error: { code: state.weeklyStatus } }), { status: state.weeklyStatus })
        : json({ range, majorDimension: 'ROWS', values: state.weekly });
    }
    const wide = /^'browser_readiness'!A(\d+):Y(\d+)$/.exec(range);
    if (wide) return json({ range, majorDimension: 'ROWS', values: trimmed(state.values.slice(Number(wide[1]) - 1, Number(wide[2]))) });
    const single = /^'browser_readiness'!A(\d+):A(\d+)$/.exec(range);
    assert.ok(single, range);
    state.onColumnRead();
    return json({ range, majorDimension: 'ROWS',
      values: trimmed(state.values.slice(Number(single[1]) - 1, Number(single[2])).map(cells => (cells.length ? [cells[0]] : []))) });
  };
  const append = async (token, sheetId, tab, header, rows) => {
    if (state.failAppend) throw new Error('append rejected');
    state.appends.push({ tab, header, rows });
  };
  const run = options => runBrowserMetricsRetention({ env: { TEST_METRICS_SHEET_ID: 'sheet-id' },
    token: 'sheets-token', now: NOW, request, append, log: () => {}, ...options });
  return { state, run };
}

test('a dry run reports the plan and writes nothing', async () => {
  const { state, run } = sheetsFixture();
  const result = await run();
  assert.equal(result.applied, false);
  assert.equal(result.archivedRowCount, 6);
  assert.equal(result.deletedRowCount, 0);
  assert.deepEqual(state.appends, []);
  assert.equal(state.batchUpdate, undefined);
  assert.ok(!state.requests.some(entry => entry.method !== 'GET'));
});

test('applying appends the weekly summaries first, then deletes bottom-up', async () => {
  const { state, run } = sheetsFixture();
  const result = await run({ dryRun: false });
  assert.equal(result.applied, true);
  assert.equal(result.deletedRowCount, 6);
  assert.deepEqual(state.appends.map(entry => [entry.tab, entry.header, entry.rows.length]),
    [['browser_readiness_weekly', BROWSER_WEEKLY_HEADER, 3]]);
  assert.deepEqual(state.batchUpdate.requests, [
    { deleteDimension: { range: { sheetId: 77, dimension: 'ROWS', startIndex: 5, endIndex: 8 } } },
    { deleteDimension: { range: { sheetId: 77, dimension: 'ROWS', startIndex: 1, endIndex: 4 } } }]);
});

test('an existing weekly tab suppresses duplicate summaries without blocking deletion', async () => {
  const { state, run } = sheetsFixture();
  state.weekly = GROUPS.map(group => [...group]);
  const result = await run({ dryRun: false });
  assert.deepEqual(state.appends, []);
  assert.equal(result.deletedRowCount, 6);
  assert.equal(state.batchUpdate.requests.length, 2);
});

test('a failed summary append leaves every raw row in place', async () => {
  const { state, run } = sheetsFixture();
  state.failAppend = true;
  await assert.rejects(run({ dryRun: false }), /append rejected/);
  assert.equal(state.batchUpdate, undefined);
});

test('an unreadable weekly tab stops the run instead of duplicating its keys', async () => {
  const { state, run } = sheetsFixture();
  state.weeklyStatus = 500;
  await assert.rejects(run({ dryRun: false }), /Sheets GET failed with 500/);
  assert.deepEqual(state.appends, []);
  assert.equal(state.batchUpdate, undefined);
});

test('rows that moved between the read and the delete are refused', async () => {
  const { state, run } = sheetsFixture();
  // A hand edit inserts a row above the archived block after it was planned.
  state.onColumnRead = () => { state.onColumnRead = () => {}; state.values.splice(1, 0, state.values[10]); state.rowCount++; };
  await assert.rejects(run({ dryRun: false }), /changed between the read and the delete/);
  assert.equal(state.batchUpdate, undefined);
  assert.equal(state.appends.length, 1);
});

test('a grid with nothing past the window is read and left alone', async () => {
  const { state, run } = sheetsFixture([[...BROWSER_HEADER],
    row({ timestamp_utc: '2026-09-20T00:00:00.000Z', row_kind: 'run', edition: 'community', run_kind: 'pr', lane_status: 'passed' })]);
  const result = await run({ dryRun: false });
  assert.equal(result.deletedRowCount, 0);
  assert.deepEqual(state.appends, []);
  assert.equal(state.batchUpdate, undefined);
});

test('missing configuration fails before any request', async () => {
  await assert.rejects(runBrowserMetricsRetention({ env: {}, token: 'sheets-token',
    request: async () => assert.fail('no request expected') }), /TEST_METRICS_SHEET_ID is required/);
  await assert.rejects(runBrowserMetricsRetention({ env: { TEST_METRICS_SHEET_ID: 'sheet-id' },
    request: async () => assert.fail('no request expected') }), /GOOGLE_SA_KEY is required/);
});

test('the retention workflow schedules itself, serializes runs and defaults dispatch to a dry run', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/browser-metrics-retention.yml', 'utf8'));
  assert.deepEqual(workflow.on.schedule, [{ cron: '10 6 * * 0' }]);
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, true);
  assert.equal(workflow.concurrency.group, 'browser-metrics-retention');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.permissions.issues, 'write');
  const steps = workflow.jobs.retain.steps;
  const retain = steps.find(step => step.run?.includes('scripts/browser-metrics-retention.mjs'));
  assert.match(retain.env.RETENTION_MODE, /inputs\.dry_run.*--dry-run.*--apply/s);
  assert.equal(retain.env.GOOGLE_SA_KEY, '${{ secrets.TEST_METRICS_GOOGLE_SA_KEY }}');
  assert.equal(steps.at(-1).if, 'failure()');
  assert.match(steps.at(-1).run, /gh issue edit/);
});

test('reconciliation reports its own failure streak as a single notice', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/reconcile-browser-metrics.yml', 'utf8'));
  assert.equal(workflow.permissions.issues, 'write');
  const alert = workflow.jobs.reconcile.steps.at(-1);
  assert.equal(alert.if, 'failure()');
  assert.match(alert.run, /gh issue list/);
  assert.match(alert.run, /gh issue edit/);
  assert.match(alert.run, /gh issue create/);
});

test('the documented retention window is the one the code enforces', () => {
  assert.equal(BROWSER_RETENTION_DAYS, 90);
  const reference = readFileSync('docs/reference/test-metrics.md', 'utf8');
  assert.match(reference, /browser_readiness_weekly/);
  assert.match(reference, new RegExp(`${BROWSER_RETENTION_DAYS}-day`));
  assert.match(reference, /outside-retention/);
});
