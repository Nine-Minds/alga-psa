import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WORKFLOW_HEALTH_HEADER, WORKFLOW_HEALTH_TAB, buildWorkflowHealthRow, recordWorkflowHealth, summarizeDetails }
  from '../record-workflow-health.mjs';

const ENV = {
  GITHUB_WORKFLOW: 'Reconcile browser metrics exports', GITHUB_RUN_ID: '36602556039', GITHUB_RUN_ATTEMPT: '2',
  GITHUB_EVENT_NAME: 'workflow_run', GITHUB_SHA: 'db49335267', GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'Nine-Minds/alga-psa', GOOGLE_SA_KEY: '{}', TEST_METRICS_SHEET_ID: 'sheet',
};
const NOW = new Date('2026-09-29T17:06:38Z');

test('summarizes the collector failure and the reconcile issues into one row', () => {
  const documents = [
    { phase: 'sheet-metadata', code: 'sheet-row-limit-exceeded', rowCount: 19091 },
    { status: 'incomplete', records: [
      { issues: ['tested-revision-unknown', 'artifact-stale-attempt'] }, { issues: ['tested-revision-unknown'] }] },
  ];
  assert.deepEqual(summarizeDetails(documents),
    { phase: 'sheet-metadata', code: 'sheet-row-limit-exceeded', status: 'incomplete', issues: ['tested-revision-unknown', 'artifact-stale-attempt'] });
  const row = buildWorkflowHealthRow({ env: ENV, documents, now: NOW });
  assert.equal(row.length, WORKFLOW_HEALTH_HEADER.length);
  assert.deepEqual(row, ['2026-09-29T17:06:38.000Z', 'Reconcile browser metrics exports', 'failure',
    'https://github.com/Nine-Minds/alga-psa/actions/runs/36602556039/attempts/2', '2', 'workflow_run', 'db49335267',
    'sheet-metadata', 'sheet-row-limit-exceeded', 'incomplete', 'tested-revision-unknown, artifact-stale-attempt', 1]);
});

test('a run with no detail files still records the failure', () => {
  const row = buildWorkflowHealthRow({ env: { ...ENV, GITHUB_WORKFLOW: 'Browser metrics retention' }, documents: [null], now: NOW });
  assert.equal(row[1], 'Browser metrics retention');
  assert.equal(row[2], 'failure');
  assert.deepEqual(row.slice(7, 11), ['', '', '', '']);
});

test('records one row in the workflow_health tab and tolerates unreadable detail files', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workflow-health-'));
  const readable = path.join(directory, 'collection.json');
  writeFileSync(readable, JSON.stringify({ phase: 'sheet-index', code: 'invalid-sheet-range' }));
  const broken = path.join(directory, 'broken.json');
  writeFileSync(broken, '{not json');
  const appends = [];
  const result = await recordWorkflowHealth({ env: ENV, files: [readable, broken, path.join(directory, 'absent.json')],
    token: 'sheets-token', now: NOW, log: () => {},
    append: async (token, sheetId, tab, header, rows) => { appends.push({ token, sheetId, tab, header, rows }); } });
  assert.equal(result.recorded, true);
  assert.equal(appends.length, 1);
  assert.equal(appends[0].tab, WORKFLOW_HEALTH_TAB);
  assert.equal(appends[0].token, 'sheets-token');
  assert.deepEqual(appends[0].header, WORKFLOW_HEALTH_HEADER);
  assert.deepEqual(appends[0].rows[0].slice(7, 9), ['sheet-index', 'invalid-sheet-range']);
});

test('skips without credentials instead of failing the notice step', async () => {
  let appended = false;
  const result = await recordWorkflowHealth({ env: { ...ENV, GOOGLE_SA_KEY: '' }, log: () => {},
    append: async () => { appended = true; } });
  assert.equal(result.recorded, false);
  assert.equal(appended, false);
});
