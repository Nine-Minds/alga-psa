#!/usr/bin/env node
/**
 * Archive browser_readiness rows older than the retention window into weekly
 * summaries on browser_readiness_weekly, then delete the archived raw rows.
 *
 * Inputs (env):
 *   GOOGLE_SA_KEY          service-account key JSON (raw or base64), write scope
 *   TEST_METRICS_SHEET_ID  spreadsheet id from the sheet URL
 *
 * Dry run is the default; pass --apply to write. See
 * docs/reference/test-metrics.md for the retention policy.
 */
import { pathToFileURL } from 'node:url';
import { appendRows, getAccessToken, parseServiceAccountKey } from './record-test-metrics.mjs';
import { BROWSER_RETENTION_DAYS, BROWSER_WEEKLY_HEADER, browserSummaryKey, planBrowserMetricsRetention } from './lib/browser-metrics-retention.mjs';

const TAB = 'browser_readiness';
const WEEKLY_TAB = 'browser_readiness_weekly';

export async function runBrowserMetricsRetention({ env = process.env, dryRun = true, now = Date.now(),
  request = fetch, append = appendRows, token, log = console.log } = {}) {
  const sheetId = env.TEST_METRICS_SHEET_ID;
  if (!sheetId) throw new Error('TEST_METRICS_SHEET_ID is required');
  if (token === undefined) {
    if (!env.GOOGLE_SA_KEY) throw new Error('GOOGLE_SA_KEY is required');
    token = await getAccessToken(parseServiceAccountKey(env.GOOGLE_SA_KEY));
  }
  const api = async (pathAndQuery, method = 'GET', body) => {
    const response = await request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${pathAndQuery}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(`Sheets ${method} failed with ${response.status}`), { status: response.status });
    return json;
  };
  const readRange = range => api(`/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
  const readGrid = async () => {
    const metadata = await api('?fields=spreadsheetId,sheets.properties');
    const tabs = (metadata.sheets ?? []).filter(sheet => sheet.properties?.title === TAB);
    if (tabs.length !== 1) throw new Error(`expected exactly one "${TAB}" tab`);
    const { sheetId: gridId, gridProperties } = tabs[0].properties;
    if (!Number.isSafeInteger(gridId) || !Number.isSafeInteger(gridProperties?.rowCount)
      || !Number.isSafeInteger(gridProperties?.columnCount)) throw new Error(`could not read "${TAB}" grid properties`);
    return { gridId, ...gridProperties };
  };

  const grid = await readGrid();
  const lastColumn = String.fromCharCode(64 + Math.min(25, grid.columnCount));
  // Retention needs the whole tab to bucket rows by week; it runs weekly, unlike
  // the per-run collector, which reads only its own rows.
  const values = [];
  for (let start = 1; start <= grid.rowCount; start += 5000) {
    const end = Math.min(start + 4999, grid.rowCount);
    const chunk = await readRange(`'${TAB}'!A${start}:${lastColumn}${end}`);
    const rows = chunk.values ?? [];
    values.push(...rows);
    for (let missing = rows.length; missing < end - start + 1; missing++) values.push([]);
  }

  let existingSummaryKeys = [];
  try {
    const weekly = await readRange(`'${WEEKLY_TAB}'!A2:C`);
    existingSummaryKeys = (weekly.values ?? []).filter(row => row.length >= 3)
      .map(row => browserSummaryKey(String(row[0]), String(row[1]), String(row[2])));
  } catch (error) {
    // Only an absent tab is a known-empty summary history. Any other failure
    // could hide existing keys and duplicate them, so it stops the run.
    if (error.status !== 400) throw error;
    log(`browser-metrics-retention: no ${WEEKLY_TAB} tab yet; every archived week is new`);
  }

  const plan = planBrowserMetricsRetention({ values, now, existingSummaryKeys });
  log(`browser-metrics-retention: ${TAB} has ${grid.rowCount} allocated rows; window ${BROWSER_RETENTION_DAYS} days, whole ISO weeks only.`);
  log(`browser-metrics-retention: ${plan.archivedRowCount} rows are past the window in ${plan.summaries.length} week/edition/run-kind groups; ${plan.retainedRowCount} rows stay.`);
  if (plan.unreadableTimestampCount) log(`browser-metrics-retention: ${plan.unreadableTimestampCount} rows have an unreadable timestamp_utc and are never deleted.`);
  for (const summary of plan.summaries) {
    log(`  ${summary.week} ${summary.edition} ${summary.runKind}: runs=${summary.runs} passed=${summary.passed}`
      + ` failed=${summary.failed} incomplete=${summary.incomplete} retried-journeys=${summary.journeysWithRetry}`
      + ` median-collected=${summary.medianCollected} median-executed=${summary.medianExecuted}`
      + ` rows=${summary.archivedRows}${summary.alreadySummarized ? ' (already summarized)' : ''}`);
  }
  log(`browser-metrics-retention: ${plan.summaryRows.length} summary rows to append; ${plan.deletions.length} deletion blocks, bottom-up.`);
  if (dryRun) {
    log('browser-metrics-retention: dry run; nothing was written.');
    return { ...plan, applied: false, deletedRowCount: 0 };
  }
  // Summaries first: a failed append throws here and leaves every raw row.
  if (plan.summaryRows.length) await append(token, sheetId, WEEKLY_TAB, BROWSER_WEEKLY_HEADER, plan.summaryRows);
  if (!plan.deletions.length) return { ...plan, applied: true, deletedRowCount: 0 };
  const after = await readGrid();
  if (after.rowCount !== grid.rowCount) {
    log(`browser-metrics-retention: grid row count moved from ${grid.rowCount} to ${after.rowCount} during the read.`);
  }
  // Concurrent appends land below these rows and cannot move them, but an insert
  // or hand edit can. Re-read exactly the rows about to be deleted and refuse
  // unless every timestamp still matches the plan.
  for (const block of plan.deletions) {
    const verify = await readRange(`'${TAB}'!A${block.startIndex + 1}:A${block.endIndex}`);
    const observed = (verify.values ?? []).map(row => String(row[0] ?? ''));
    if (observed.length !== block.timestamps.length
      || observed.some((value, index) => value !== block.timestamps[index])) {
      throw new Error(`${TAB} rows ${block.startIndex + 1}-${block.endIndex} changed between the read and the delete; refusing to delete`);
    }
  }
  await api(':batchUpdate', 'POST', { requests: plan.deletions.map(block => ({
    deleteDimension: { range: { sheetId: grid.gridId, dimension: 'ROWS', startIndex: block.startIndex, endIndex: block.endIndex } },
  })) });
  log(`browser-metrics-retention: deleted ${plan.archivedRowCount} archived rows.`);
  return { ...plan, applied: true, deletedRowCount: plan.archivedRowCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runBrowserMetricsRetention({ dryRun: process.argv.includes('--dry-run') || !process.argv.includes('--apply') });
  } catch (error) {
    console.error(`browser-metrics-retention: ${error.message}`);
    process.exitCode = 1;
  }
}
