#!/usr/bin/env node
import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { appendRows, getAccessToken, parseServiceAccountKey } from './record-test-metrics.mjs';

export const BROWSER_HEADER = ['timestamp_utc', 'schema_version', 'row_kind', 'tested_sha', 'edition',
  'lane_status', 'run_url', 'collected', 'executed', 'project', 'file', 'journey', 'required',
  'observed', 'outcome', 'first_attempt', 'retry_count', 'artifact_manifest'];

export function browserRows(metrics, { revision = '', edition = '', runUrl = '', timestamp = new Date().toISOString() } = {}) {
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
  const status = valid ? metrics.status : 'incomplete';
  const base = [timestamp, 2, 'run', revision, edition, status, runUrl];
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : '';
  const artifact = valid && metrics.artifactManifest ? JSON.stringify(metrics.artifactManifest) : '';
  const rows = [[...base, valid ? count(metrics.collected) : '', valid ? count(metrics.executed) : '',
    '', '', '', '', '', '', '', '', artifact]];
  if (!valid) return rows;
  for (const journey of metrics.journeys) {
    const identity = journey.identity;
    rows.push([timestamp, 2, 'journey', revision, edition, status, runUrl, '', '', identity[2], identity[0],
      JSON.stringify(identity[3]), journey.required === true, journey.observed === true,
      journey.outcome, journey.firstAttempt, count(journey.retryCount), '']);
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
