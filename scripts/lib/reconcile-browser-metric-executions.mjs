import assert from 'node:assert/strict';
import { BROWSER_HEADER } from '../record-browser-metrics.mjs';

const decimal = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
const number = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))
  && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const key = entry => [entry.repository.toLowerCase(), entry.revision, entry.runId, entry.runAttempt, entry.edition].join(':');
const text = value => typeof value === 'string' && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value);
function journeyIdentity(row) {
  if (![row.project_id, row.project, row.file].every(text)) return false;
  try { const titles = JSON.parse(row.journey); return Array.isArray(titles) && titles.length > 0 && titles.every(text); }
  catch { return false; }
}
const bool = value => value === true || value === 'TRUE' || value === 'true';
function runUrl(value) {
  try { const url = new URL(value); const match = /^\/([^/]+\/[^/]+)\/actions\/runs\/([1-9][0-9]*)$/.exec(url.pathname);
    return url.origin === 'https://github.com' && !url.search && !url.hash && match ? { repository: match[1].toLowerCase(), runId: match[2] } : null;
  } catch { return null; }
}
export function reconcileBrowserMetricExecutions(input) {
  assert.equal(input?.schemaVersion, 1, 'Expected reconciliation schema version 1');
  assert.ok(Array.isArray(input.expectedExecutions), 'Expected executions are required');
  const header = input.exportedRows?.header;
  assert.ok(Array.isArray(header) && [18, 20, 25].includes(header.length), 'Expected recognized browser metrics header');
  assert.deepEqual(header, BROWSER_HEADER.slice(0, header.length), 'Expected versioned browser metrics header');
  assert.ok(Array.isArray(input.exportedRows.rows), 'Exported rows are required');
  const seen = new Set();
  const expected = input.expectedExecutions.map(entry => {
    assert.ok(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry?.repository ?? '')
      && /^[a-f0-9]{40}$/.test(entry.revision ?? '') && decimal(entry.runId)
      && Number.isSafeInteger(entry.runAttempt) && entry.runAttempt > 0
      && ['community', 'enterprise'].includes(entry.edition)
      && ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_dispatch'].includes(entry.eventName)
      && ['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(entry.runStatus)
      && (entry.runStatus === 'completed' ? [null, 'success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'startup_failure'].includes(entry.conclusion) : entry.conclusion === null), 'Invalid expected execution');
    const hasRecorder = Object.hasOwn(entry, 'recorderStatus') || Object.hasOwn(entry, 'recorderConclusion');
    if (hasRecorder) assert.ok([null, 'queued', 'in_progress', 'completed', 'pending'].includes(entry.recorderStatus)
      && (entry.recorderStatus === 'completed'
        ? ['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'neutral'].includes(entry.recorderConclusion)
        : entry.recorderConclusion === null), 'Invalid recorder state');
    const selected = { repository: entry.repository.toLowerCase(), revision: entry.revision, runId: entry.runId,
      runAttempt: entry.runAttempt, edition: entry.edition, eventName: entry.eventName, runStatus: entry.runStatus, conclusion: entry.conclusion,
      ...(hasRecorder ? { recorderStatus: entry.recorderStatus, recorderConclusion: entry.recorderConclusion } : {}) };
    assert.ok(!seen.has(key(selected)), 'Duplicate expected execution'); seen.add(key(selected)); return selected;
  }).sort((a,b) => key(a).localeCompare(key(b)));
  const rows = input.exportedRows.rows.map(row => {
    assert.ok(Array.isArray(row) && row.length <= header.length, 'Malformed exported row');
    return Object.fromEntries(BROWSER_HEADER.map((column, index) => [column, row[index] ?? '']));
  });
  const records = expected.map(entry => {
    const related = rows.filter(row => {
      const url = runUrl(row.run_url);
      return url?.repository === entry.repository && url.runId === entry.runId && row.edition === entry.edition;
    });
    const sameAttempt = related.filter(row => number(row.run_attempt) === entry.runAttempt);
    const current = sameAttempt.filter(row => String(row.run_id) === entry.runId && row.tested_sha === entry.revision
      && row.event_name === entry.eventName && number(row.schema_version) === 2);
    const runs = current.filter(row => row.row_kind === 'run');
    const journeys = current.filter(row => row.row_kind === 'journey');
    const issues = [];
    if (sameAttempt.length !== current.length) issues.push('conflicting-export-identity');
    if (runs.length > 1) issues.push('duplicate-run-export');
    if (current.some(row => !['run', 'journey'].includes(row.row_kind))) issues.push('invalid-row-kind');
    const staleAttempts = [...new Set(related.map(row => number(row.run_attempt)).filter(attempt => attempt !== null && attempt !== entry.runAttempt))].sort((a,b)=>a-b);
    const run = runs[0];
    const collected = number(run?.collected), executed = number(run?.executed);
    const journeyKeys = journeys.map(row => JSON.stringify([row.project_id, row.project, row.file, row.journey]));
    const completeConfiguration = [run?.authentication, run?.server_lifecycle].every(text)
      && journeys.every(row => row.authentication === run.authentication && row.server_lifecycle === run.server_lifecycle);
    const completeJourneys = completeConfiguration && journeys.length === collected && new Set(journeyKeys).size === journeys.length
      && journeys.every(row => journeyIdentity(row) && bool(row.required) && bool(row.observed) && row.outcome === 'expected'
        && row.first_attempt === 'passed' && number(row.retry_count) === 0);
    let exportStatus;
    if (issues.length) exportStatus = 'conflicting-export';
    else if (!run) exportStatus = 'missing-export';
    else if (run.lane_status === 'failed') exportStatus = 'failed';
    else if (run.lane_status !== 'passed' || collected === null || collected < 1 || executed !== collected || !completeJourneys) exportStatus = 'incomplete';
    else exportStatus = 'observed-pass';
    const recorderUnsuccessful = Object.hasOwn(entry, 'recorderStatus')
      && !(entry.recorderStatus === 'completed' && entry.recorderConclusion === 'success');
    if (Object.hasOwn(entry, 'recorderStatus')) {
      if (entry.recorderStatus === null) issues.push('recorder-step-absent');
      else if (entry.recorderConclusion === 'skipped') issues.push('export-not-attempted');
      else if (!run && entry.recorderStatus === 'completed') issues.push('export-attempted-but-missing');
      else if (entry.recorderStatus !== 'completed') issues.push('recorder-not-completed');
      else if (entry.recorderConclusion !== 'success') issues.push('recorder-unsuccessful');
    }
    let status;
    if (entry.runStatus !== 'completed') status = 'pending';
    else if (entry.conclusion === 'cancelled') status = 'cancelled';
    else if (entry.conclusion === null) status = 'incomplete';
    else if (entry.conclusion !== 'success') status = 'failed';
    else if (recorderUnsuccessful) status = 'incomplete';
    else status = exportStatus;
    return { key: key(entry), ...entry, status, exportStatus, runExportCount: runs.length, journeyExportCount: journeys.length,
      staleAttempts, issues };
  });
  return { schemaVersion: 1, scope: 'observed-browser-execution-export-reconciliation',
    status: records.length && records.every(record => record.status === 'observed-pass') ? 'passed' : 'incomplete', records,
    limitations: ['Observed executions only; never-created workflows require explicit expectations.', 'Operator-supplied tested revision may have validated merge relationships; this does not prove the actual checkout.', 'An observed metrics pass is not independent artifact, deployment or release-readiness verification.'] };
}
