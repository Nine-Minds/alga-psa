#!/usr/bin/env node
/**
 * Append the production-regression readiness verdict to the `gate_runs` tab of
 * the test-metrics sheet (docs/reference/test-metrics.md).
 *
 * Reads test-results/production-readiness/aggregate.json (written by
 * verify-production-readiness.mjs, even when it fails) and READINESS_JOBS
 * (`toJSON(needs)` from the orchestrator). Exits 0 when the Google secrets are
 * absent so it can never fail the gate; `--dry-run` prints the row.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendRows, getAccessToken, parseServiceAccountKey } from './record-test-metrics.mjs';
import { GATE_HEADER, buildGateRow } from './lib/gate-metrics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function readAggregate() {
  const file = process.env.GATE_METRICS_AGGREGATE || path.join(root, 'test-results/production-readiness/aggregate.json');
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function readJobs() {
  try { return JSON.parse(process.env.READINESS_JOBS || '{}'); } catch { return {}; }
}

function writeJobSummary(row) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const get = (name) => row[GATE_HEADER.indexOf(name)];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    `### Gate metrics — ${get('gate_status')}`,
    '',
    '| Lanes red | Requirements failed | Failures |',
    '|---|---|---|',
    `| ${get('failed_lanes') || '—'} | ${get('failed_requirements') || '—'} | ${get('failure_count')} |`,
    '',
  ].join('\n'));
}

async function main() {
  const row = buildGateRow({ aggregate: readAggregate(), jobs: readJobs(), env: process.env });
  if (process.argv.includes('--dry-run')) {
    console.log('gate-metrics dry run:');
    GATE_HEADER.forEach((col, i) => console.log(`  ${col}: ${row[i]}`));
    return;
  }
  writeJobSummary(row);
  const rawKey = process.env.GOOGLE_SA_KEY;
  const sheetId = process.env.TEST_METRICS_SHEET_ID;
  if (!rawKey || !sheetId) {
    console.log('gate-metrics: GOOGLE_SA_KEY / TEST_METRICS_SHEET_ID not configured, skipping');
    return;
  }
  const tab = process.env.GATE_METRICS_SHEET_TAB || 'gate_runs';
  const token = await getAccessToken(parseServiceAccountKey(rawKey));
  await appendRows(token, sheetId, tab, GATE_HEADER, [row]);
  console.log(`gate-metrics: recorded ${row[7]} gate run${row[8] ? ` (red lanes: ${row[8]})` : ''} to sheet`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
