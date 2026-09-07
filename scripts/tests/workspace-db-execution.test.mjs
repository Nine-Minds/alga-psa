import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyWorkspaceDatabase } from '../verify-workspace-db-execution.mjs';

test('database gate independently rejects incomplete evidence and unjustified skips', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'workspace-db-gate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const revision = 'a'.repeat(40), root = '/repo', file = 'packages/billing/example.db.test.ts';
  const write = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value));
  const evidence = { schemaVersion: 1, status: 'passed', selection: { mode: 'full', filters: [] },
    source: { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } } };
  write('evidence.json', evidence);
  write('collected.json', [file]);
  write('collected-tests.json', [{ file, name: 'persists invoice' }]);
  const report = { success: true, numTotalTests: 1, testResults: [{ name: file, status: 'passed', assertionResults: [{ title: 'persists invoice', status: 'passed' }] }] };
  write('results.json', report);
  const input = { root, revision, directory, candidates: [file], changed: ['packages/billing/src/change.ts'], event: 'pull_request', selectorResult: 'success', jobResult: 'success' };
  assert.equal(verifyWorkspaceDatabase(input).status, 'passed');
  for (const jobResult of ['failure', 'cancelled', 'skipped', undefined]) assert.equal(verifyWorkspaceDatabase({ ...input, jobResult }).status, 'failed');
  for (const selectorResult of ['failure', 'cancelled', 'skipped', undefined]) assert.equal(verifyWorkspaceDatabase({ ...input, selectorResult }).status, 'failed');
  assert.equal(verifyWorkspaceDatabase({ ...input, candidates: [...input.candidates, 'packages/billing/new.db.test.ts'] }).status, 'failed');
  assert.equal(verifyWorkspaceDatabase({ ...input, changed: null, jobResult: 'skipped' }).status, 'failed');
  assert.equal(verifyWorkspaceDatabase({ ...input, changed: ['docs/plan.md'], jobResult: 'skipped' }).status, 'not-applicable');
  assert.equal(verifyWorkspaceDatabase({ ...input, changed: [], event: 'schedule', selectorResult: 'skipped' }).status, 'passed');
  assert.equal(verifyWorkspaceDatabase({ ...input, changed: [], event: 'schedule', selectorResult: 'skipped', jobResult: 'skipped' }).status, 'failed');
  evidence.source.after.dirty = true; write('evidence.json', evidence);
  assert.equal(verifyWorkspaceDatabase(input).status, 'failed');
  evidence.source.after.dirty = false; write('evidence.json', evidence);
  report.testResults[0].assertionResults = []; write('results.json', report);
  assert.equal(verifyWorkspaceDatabase(input).status, 'failed');
  writeFileSync(path.join(directory, 'results.json'), '{broken');
  assert.equal(verifyWorkspaceDatabase(input).status, 'failed');
  rmSync(path.join(directory, 'results.json'));
  assert.equal(verifyWorkspaceDatabase(input).status, 'failed');
});
