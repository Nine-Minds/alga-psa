#!/usr/bin/env node
/**
 * Delete coverage_by_dir rows older than the retention window.
 *
 * Inputs (env):
 *   GOOGLE_SA_KEY          service-account key JSON (raw or base64), write scope
 *   TEST_METRICS_SHEET_ID  spreadsheet id from the sheet URL
 *
 * Dry run is the default; pass --apply to write. See
 * docs/reference/test-metrics.md for the retention policy.
 */
import { pathToFileURL } from 'node:url';
import { DETAIL_HEADER, getAccessToken, parseServiceAccountKey } from './record-test-metrics.mjs';
import { COVERAGE_RETENTION_DAYS, planCoverageMetricsRetention } from './lib/coverage-metrics-retention.mjs';

const TAB = 'coverage_by_dir';
// Only column A is read, so a chunk this size stays a small response.
const CHUNK_ROWS = 50_000;

// LEVERAGE: pattern sheet-tab-retention — same read-plan-verify-delete shape as browser-metrics-retention.mjs
export async function runCoverageMetricsRetention({ env = process.env, dryRun = true, now = Date.now(),
  request = fetch, token, log = console.log } = {}) {
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
  // Column A for grid rows first..last, one entry per row, '' for a blank row.
  const readTimestamps = async (first, last) => {
    const column = [];
    for (let start = first; start <= last; start += CHUNK_ROWS) {
      const end = Math.min(start + CHUNK_ROWS - 1, last);
      const rows = (await readRange(`'${TAB}'!A${start}:A${end}`)).values ?? [];
      for (let offset = 0; offset < end - start + 1; offset++) column.push(rows[offset]?.[0] ?? '');
    }
    return column;
  };

  const metadata = await api('?fields=spreadsheetId,sheets.properties');
  const tabs = (metadata.sheets ?? []).filter(sheet => sheet.properties?.title === TAB);
  if (tabs.length !== 1) throw new Error(`expected exactly one "${TAB}" tab`);
  const { sheetId: gridId, gridProperties } = tabs[0].properties;
  if (!Number.isSafeInteger(gridId) || !Number.isSafeInteger(gridProperties?.rowCount)) {
    throw new Error(`could not read "${TAB}" grid properties`);
  }
  const { rowCount } = gridProperties;
  const lastColumn = String.fromCharCode(64 + DETAIL_HEADER.length);
  const header = (await readRange(`'${TAB}'!A1:${lastColumn}1`)).values?.[0] ?? [];
  const timestamps = rowCount > 1 ? await readTimestamps(2, rowCount) : [];

  const plan = planCoverageMetricsRetention({ header, timestamps, now });
  log(`coverage-metrics-retention: ${TAB} has ${rowCount} allocated rows; window ${COVERAGE_RETENTION_DAYS} days.`);
  log(`coverage-metrics-retention: ${plan.expiredRowCount} rows are past the window in ${plan.deletions.length} deletion blocks, bottom-up; ${plan.retainedRowCount} rows stay.`);
  if (plan.unreadableTimestampCount) log(`coverage-metrics-retention: ${plan.unreadableTimestampCount} rows have an unreadable timestamp_utc and are never deleted.`);
  if (dryRun) {
    log('coverage-metrics-retention: dry run; nothing was written.');
    return { ...plan, applied: false, deletedRowCount: 0 };
  }
  if (!plan.deletions.length) return { ...plan, applied: true, deletedRowCount: 0 };
  // Concurrent appends land below these rows and cannot move them, but an insert
  // or hand edit can. Re-read exactly the rows about to be deleted and refuse
  // unless every timestamp still matches the plan.
  for (const block of plan.deletions) {
    const observed = await readTimestamps(block.startIndex + 1, block.endIndex);
    if (observed.length !== block.timestamps.length
      || observed.some((value, index) => value !== block.timestamps[index])) {
      throw new Error(`${TAB} rows ${block.startIndex + 1}-${block.endIndex} changed between the read and the delete; refusing to delete`);
    }
  }
  await api(':batchUpdate', 'POST', { requests: plan.deletions.map(block => ({
    deleteDimension: { range: { sheetId: gridId, dimension: 'ROWS', startIndex: block.startIndex, endIndex: block.endIndex } },
  })) });
  log(`coverage-metrics-retention: deleted ${plan.expiredRowCount} rows.`);
  return { ...plan, applied: true, deletedRowCount: plan.expiredRowCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runCoverageMetricsRetention({ dryRun: process.argv.includes('--dry-run') || !process.argv.includes('--apply') });
  } catch (error) {
    console.error(`coverage-metrics-retention: ${error.message}`);
    process.exitCode = 1;
  }
}
