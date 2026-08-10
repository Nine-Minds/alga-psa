#!/usr/bin/env node
/**
 * Append one row per locale of translation-quality metrics to the shared
 * Google Sheet after a CI run. Companion to record-test-metrics.mjs, reusing
 * its service account, sheet id and append helpers — see
 * docs/reference/test-metrics.md for the sheet setup.
 *
 * Rows land on their own tab (`i18n_locale_quality`) rather than `metrics`:
 * the unit is a locale, not a test run, so the columns do not line up with the
 * pass/coverage schema. The append helper writes the header on first use, so
 * no manual tab setup is needed.
 *
 * Records only what the gates act on. The audit's `unreviewed` tally is left
 * out: its ledger entries record that a machine pass ran rather than that a
 * human validated anything, and the count never suppresses or produces a
 * finding — it would be a column that always grows and never means much.
 *
 * Inputs (env):
 *   GOOGLE_SA_KEY           service-account key JSON (raw or base64)
 *   TEST_METRICS_SHEET_ID   spreadsheet id from the sheet URL
 *   I18N_METRICS_SHEET_TAB  tab name (default "i18n_locale_quality")
 *   I18N_METRICS_INPUT      path to `audit-all.cjs --json` output; when unset
 *                           the audit is run directly
 *
 * Exits 0 without recording when the Google credentials are not configured, so
 * forks and local runs are unaffected. Pass --dry-run to print the rows.
 */
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendRows,
  getAccessToken,
  parseServiceAccountKey,
} from './record-test-metrics.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HEADER = [
  'timestamp_utc', 'branch', 'commit', 'locale',
  'keys', 'untranslated', 'forbidden_terms',
  'parse_errors', 'missing_files', 'run_url',
];

function auditSummaries() {
  const providedPath = process.env.I18N_METRICS_INPUT;
  if (providedPath && existsSync(providedPath)) {
    return JSON.parse(readFileSync(providedPath, 'utf8')).summaries ?? [];
  }

  // audit-all exits nonzero when a locale regresses; the report is still on
  // stdout and is exactly the data point worth recording.
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'tools/i18n/audit-all.cjs'), '--json'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return JSON.parse(stdout).summaries ?? [];
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout).summaries ?? [];
    throw error;
  }
}

export function buildRows(summaries, now = new Date()) {
  const timestamp = now.toISOString();
  const branch = process.env.GITHUB_REF_NAME || '';
  const commit = (process.env.GITHUB_SHA || '').slice(0, 12);
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';

  return summaries.map((s) => [
    timestamp, branch, commit, s.locale,
    s.keyCount ?? 0, s.untranslatedCount ?? 0, s.forbiddenViolationCount ?? 0,
    s.parseErrorCount ?? 0, s.missingFileCount ?? 0, runUrl,
  ]);
}

function writeJobSummary(rows) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;

  const lines = [
    '## Locale quality metrics',
    '',
    '| locale | keys | untranslated | forbidden | parse/missing |',
    '|---|---:|---:|---:|---:|',
    ...rows.map((r) => `| ${r[3]} | ${r[4]} | ${r[5]} | ${r[6]} | ${r[7] + r[8]} |`),
    '',
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
}

async function main() {
  const rows = buildRows(auditSummaries());

  if (process.argv.includes('--dry-run')) {
    console.log(`i18n-metrics dry run — ${rows.length} row(s), tab "${process.env.I18N_METRICS_SHEET_TAB || 'i18n_locale_quality'}":`);
    console.log(`  ${HEADER.join(' | ')}`);
    for (const row of rows) console.log(`  ${row.join(' | ')}`);
    return;
  }

  writeJobSummary(rows);

  const rawKey = process.env.GOOGLE_SA_KEY;
  const sheetId = process.env.TEST_METRICS_SHEET_ID;
  if (!rawKey || !sheetId) {
    console.log('i18n-metrics: GOOGLE_SA_KEY / TEST_METRICS_SHEET_ID not configured, skipping');
    return;
  }

  if (rows.length === 0) {
    console.log('i18n-metrics: no locales audited, nothing to record');
    return;
  }

  const tab = process.env.I18N_METRICS_SHEET_TAB || 'i18n_locale_quality';
  const token = await getAccessToken(parseServiceAccountKey(rawKey));
  await appendRows(token, sheetId, tab, HEADER, rows);
  console.log(`i18n-metrics: recorded ${rows.length} locale row(s) to "${tab}"`);
}

main().catch((error) => {
  // Never fail a build over a metrics write.
  console.error(`i18n-metrics: ${error.message}`);
  process.exit(0);
});
