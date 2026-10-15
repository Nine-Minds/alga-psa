#!/usr/bin/env node
/**
 * Append one row per failed CI maintenance run to the `workflow_health` tab of
 * the test-metrics sheet. Replaces the GitHub-issue failure notices: the sheet
 * is where the team tracks CI health, and an issue per streak was noise there.
 *
 * Usage: node scripts/record-workflow-health.mjs [detail.json ...]
 *
 * Each detail file is a JSON document the failing job wrote (for reconcile:
 * browser-metric-collection.json and browser-metric-reconciliation.json).
 * Their `phase`, `code`, `status` and per-record `issues` fields, when present,
 * land in the row so the sheet says why the run failed without opening it.
 *
 * Inputs (env):
 *   WORKFLOW_HEALTH_CONCLUSION  job status to record (default "failure")
 *   GITHUB_WORKFLOW, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_EVENT_NAME,
 *   GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_REPOSITORY
 *   GOOGLE_SA_KEY, TEST_METRICS_SHEET_ID   as in record-test-metrics.mjs
 *
 * Exits 0 without recording when the Google credentials are not configured.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { appendRows, getAccessToken, parseServiceAccountKey } from './record-test-metrics.mjs';

export const WORKFLOW_HEALTH_TAB = 'workflow_health';
export const WORKFLOW_HEALTH_HEADER = ['timestamp_utc', 'workflow', 'conclusion', 'run_url', 'run_attempt',
  'event_name', 'revision', 'phase', 'code', 'status', 'issues', 'schema_version'];

const text = value => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

// Pulls the fields a failing job's diagnostics carry. Anything missing stays
// blank; a detail file that cannot be read contributes nothing rather than
// hiding the row that says the run failed.
export function summarizeDetails(documents) {
  const summary = { phase: '', code: '', status: '', issues: [] };
  for (const document of documents) {
    if (!document || typeof document !== 'object') continue;
    if (!summary.phase && text(document.phase)) summary.phase = text(document.phase);
    if (!summary.code && text(document.code)) summary.code = text(document.code);
    if (text(document.status)) summary.status = summary.status ? `${summary.status}; ${text(document.status)}` : text(document.status);
    for (const record of Array.isArray(document.records) ? document.records : []) {
      for (const issue of Array.isArray(record?.issues) ? record.issues : []) {
        if (text(issue) && !summary.issues.includes(text(issue))) summary.issues.push(text(issue));
      }
    }
  }
  return summary;
}

export function buildWorkflowHealthRow({ env = process.env, documents = [], now = new Date() } = {}) {
  const details = summarizeDetails(documents);
  const runUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT || '1'}`
    : '';
  return [now.toISOString(), text(env.GITHUB_WORKFLOW), text(env.WORKFLOW_HEALTH_CONCLUSION) || 'failure', runUrl,
    text(env.GITHUB_RUN_ATTEMPT), text(env.GITHUB_EVENT_NAME), text(env.GITHUB_SHA),
    details.phase, details.code, details.status, details.issues.join(', '), 1];
}

export function readDetailFiles(paths) {
  return paths.map(file => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
  });
}

export async function recordWorkflowHealth({ env = process.env, files = [], append = appendRows, token, log = console.log, now = new Date() } = {}) {
  const row = buildWorkflowHealthRow({ env, documents: readDetailFiles(files), now });
  const sheetId = env.TEST_METRICS_SHEET_ID;
  if (!env.GOOGLE_SA_KEY || !sheetId) {
    log('workflow-health: GOOGLE_SA_KEY / TEST_METRICS_SHEET_ID not configured, skipping');
    return { recorded: false, row };
  }
  if (token === undefined) token = await getAccessToken(parseServiceAccountKey(env.GOOGLE_SA_KEY));
  await append(token, sheetId, WORKFLOW_HEALTH_TAB, WORKFLOW_HEALTH_HEADER, [row]);
  log(`workflow-health: recorded ${row[1]} ${row[2]} (${row[7] || row[9] || 'no detail'}) in "${WORKFLOW_HEALTH_TAB}"`);
  return { recorded: true, row };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await recordWorkflowHealth({ files: process.argv.slice(2) });
  } catch (error) {
    console.error(`workflow-health: ${error.message}`);
    process.exitCode = 1;
  }
}
