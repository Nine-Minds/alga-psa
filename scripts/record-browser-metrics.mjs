#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateBrowserArtifactManifest } from './lib/browser-artifact-manifest.mjs';
import { appendRows, getAccessToken, parseServiceAccountKey, runKind } from './record-test-metrics.mjs';

export const BROWSER_HEADER = ['timestamp_utc', 'schema_version', 'row_kind', 'tested_sha', 'edition',
  'lane_status', 'run_url', 'collected', 'executed', 'project', 'file', 'journey', 'required',
  'observed', 'outcome', 'first_attempt', 'retry_count', 'artifact_manifest', 'run_kind', 'event_name',
  'project_id', 'run_id', 'run_attempt', 'authentication', 'server_lifecycle'];

export function browserRows(metrics, { revision = '', edition = '', runUrl = '', timestamp = new Date().toISOString(), env = process.env } = {}) {
  const validJourney = journey => Array.isArray(journey?.identity) && journey.identity.length === 4
    && journey.identity.slice(0, 3).every(value => typeof value === 'string')
    && Array.isArray(journey.identity[3]) && journey.identity[3].every(value => typeof value === 'string')
    && typeof journey.required === 'boolean' && typeof journey.observed === 'boolean'
    && Number.isSafeInteger(journey.retryCount) && journey.retryCount >= 0;
  const valid = /^[a-f0-9]{40}$/.test(revision) && metrics?.schemaVersion === 2 && metrics?.suite === 'production-browser'
    && metrics.revision === revision && ['passed', 'failed', 'incomplete'].includes(metrics.status)
    && metrics.configuration?.edition === edition && ['community', 'enterprise'].includes(edition)
    && Array.isArray(metrics.journeys) && metrics.journeys.every(validJourney)
    && (metrics.status !== 'passed' || (metrics.collected > 0 && metrics.executed === metrics.collected
      && metrics.journeys.length === metrics.collected && metrics.journeys.every(journey =>
        journey.required && journey.observed && journey.firstAttempt === 'passed' && journey.retryCount === 0 && journey.outcome === 'expected')));
  const classification = [runKind(env), env.GITHUB_EVENT_NAME || ''];
  const optionalText = value => typeof value === 'string' && value.trim() && !/[\x00-\x1f\x7f]/.test(value) ? value : '';
  const runId = typeof env.GITHUB_RUN_ID === 'string' && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID) ? env.GITHUB_RUN_ID : '';
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  const runAttempt = runId && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? '') && Number.isSafeInteger(attempt) ? attempt : '';
  const metadata = [runId, runAttempt, valid ? optionalText(metrics.configuration.authentication) : '',
    valid ? optionalText(metrics.configuration.serverLifecycle) : ''];
  let artifact = '', artifactInvalid = false;
  if (metrics?.artifactManifest !== undefined && metrics.artifactManifest !== null) {
    try {
      artifact = JSON.stringify(validateBrowserArtifactManifest(metrics.artifactManifest, { revision, edition, runId, runAttempt }));
    } catch { artifactInvalid = true; }
  }
  const status = valid && !artifactInvalid ? metrics.status : 'incomplete';
  if (!valid) artifact = '';
  const base = [timestamp, 2, 'run', revision, edition, status, runUrl];
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : '';
  const rows = [[...base, valid ? count(metrics.collected) : '', valid ? count(metrics.executed) : '',
    '', '', '', '', '', '', '', '', artifact, ...classification, '', ...metadata]];
  if (!valid) return rows;
  for (const journey of metrics.journeys) {
    const identity = journey.identity;
    rows.push([timestamp, 2, 'journey', revision, edition, status, runUrl, '', '', identity[2], identity[0],
      JSON.stringify(identity[3]), journey.required === true, journey.observed === true,
      journey.outcome, journey.firstAttempt, count(journey.retryCount), '', ...classification, identity[1], ...metadata]);
  }
  return rows;
}

async function main() {
  let metrics = null;
  try { metrics = JSON.parse(readFileSync(process.env.TEST_METRICS_BROWSER, 'utf8')); }
  catch { console.warn('browser-metrics: missing or unreadable evidence; recording incomplete run'); }
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
  const rows = browserRows(metrics, { revision: process.env.GITHUB_SHA || process.env.E2E_REVISION || '',
    edition: process.env.E2E_EDITION || '', runUrl });
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ header: BROWSER_HEADER, rows }, null, 2));
    return;
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\nBrowser lane: **${rows[0][5]}** (${rows[0][4]}). Collected: ${rows[0][7] === '' ? 'unknown' : rows[0][7]}; executed: ${rows[0][8] === '' ? 'unknown' : rows[0][8]}.\n`);
  if (!process.env.GOOGLE_SA_KEY || !process.env.TEST_METRICS_SHEET_ID) {
    console.log('browser-metrics: Google metrics credentials not configured; summary retained locally');
    return;
  }
  const token = await getAccessToken(parseServiceAccountKey(process.env.GOOGLE_SA_KEY));
  await appendRows(token, process.env.TEST_METRICS_SHEET_ID, 'browser_readiness', BROWSER_HEADER, rows);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
