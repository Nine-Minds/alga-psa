#!/usr/bin/env node
/**
 * Append the weekly flaky-test report to the `flaky_tests` tab of the
 * test-metrics sheet: one row per test per report. The job summary and the
 * 30-day artifact stay; the sheet is where the list is tracked and owned.
 *
 * Usage: node scripts/record-flaky-tests.mjs <collector output dir>
 *   (the directory scripts/collect-flaky-tests.mjs wrote report.json into)
 *
 * A report run that was already recorded (same GITHUB_RUN_ID) appends nothing,
 * so a re-run attempt of the workflow cannot duplicate a week.
 *
 * Inputs (env): GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_REPOSITORY,
 *   GOOGLE_SA_KEY, TEST_METRICS_SHEET_ID   as in record-test-metrics.mjs
 *
 * Exits 0 without recording when the Google credentials are not configured.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendRows, getAccessToken, parseServiceAccountKey } from './record-test-metrics.mjs';
import { isoWeek } from './lib/browser-metrics-retention.mjs';

export const FLAKY_TESTS_TAB = 'flaky_tests';
export const FLAKY_TESTS_HEADER = ['reported_at_utc', 'week', 'window_days', 'since', 'suite', 'test_id', 'jobs',
  'main_occurrences', 'pr_occurrences', 'occurrences', 'first_seen', 'last_seen', 'report_run_id', 'report_run_url',
  'schema_version'];
const REPORT_RUN_ID_COLUMN = 'M';

const text = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

export function flakyTestRows(report, { env = process.env } = {}) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.tests)) throw new Error('report.json has no tests list');
  const reportedAt = text(report.generatedAt) || new Date().toISOString();
  const runId = text(env.GITHUB_RUN_ID);
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && runId
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}` : '';
  return report.tests.map(row => [reportedAt, isoWeek(Date.parse(reportedAt)), count(report.windowDays), text(report.since),
    text(row.suite), text(row.testId), (Array.isArray(row.jobs) ? row.jobs : []).join(', '),
    count(row.mainOccurrences), count(row.prOccurrences), count(row.occurrences),
    text(row.firstSeen), text(row.lastSeen), runId, runUrl, 1]);
}

// Reads one column of the tab; a tab that does not exist yet reads as empty.
export async function recordedRunIds({ token, sheetId, request = fetch }) {
  const range = encodeURIComponent(`${FLAKY_TESTS_TAB}!${REPORT_RUN_ID_COLUMN}2:${REPORT_RUN_ID_COLUMN}`);
  const response = await request(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?majorDimension=COLUMNS`, {
    headers: { authorization: `Bearer ${token}` } });
  if (response.status === 400) return new Set();
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`could not read "${FLAKY_TESTS_TAB}": ${response.status} ${JSON.stringify(json)}`);
  return new Set((json.values?.[0] ?? []).map(String));
}

export async function recordFlakyTests({ directory, env = process.env, append = appendRows, request = fetch, token, log = console.log } = {}) {
  const report = JSON.parse(readFileSync(path.join(directory, 'report.json'), 'utf8'));
  const rows = flakyTestRows(report, { env });
  const sheetId = env.TEST_METRICS_SHEET_ID;
  if (!env.GOOGLE_SA_KEY || !sheetId) {
    log('flaky-tests: GOOGLE_SA_KEY / TEST_METRICS_SHEET_ID not configured, skipping');
    return { recorded: 0, rows };
  }
  if (!rows.length) {
    log('flaky-tests: no retry-only pass in this window; nothing to record');
    return { recorded: 0, rows };
  }
  if (token === undefined) token = await getAccessToken(parseServiceAccountKey(env.GOOGLE_SA_KEY));
  const runId = text(env.GITHUB_RUN_ID);
  if (runId && (await recordedRunIds({ token, sheetId, request })).has(runId)) {
    log(`flaky-tests: run ${runId} is already recorded in "${FLAKY_TESTS_TAB}"; nothing appended`);
    return { recorded: 0, rows };
  }
  await append(token, sheetId, FLAKY_TESTS_TAB, FLAKY_TESTS_HEADER, rows);
  log(`flaky-tests: recorded ${rows.length} row${rows.length === 1 ? '' : 's'} in "${FLAKY_TESTS_TAB}"`);
  return { recorded: rows.length, rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const directory = process.argv[2];
    if (!directory) throw new Error('usage: record-flaky-tests.mjs <collector output dir>');
    await recordFlakyTests({ directory });
  } catch (error) {
    console.error(`flaky-tests: ${error.message}`);
    process.exitCode = 1;
  }
}
