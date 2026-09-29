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

test('CLI reconciles clean candidate artifacts and replaces stale passing verdicts on failure', async t => {
  const { cpSync, mkdirSync, readFileSync } = await import('node:fs');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const root = mkdtempSync(path.join(tmpdir(), 'workspace-db-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  cpSync(new URL('../lib', import.meta.url), path.join(root, 'scripts/lib'), { recursive: true });
  cpSync(new URL('../verify-workspace-db-execution.mjs', import.meta.url), path.join(root, 'scripts/verify-workspace-db-execution.mjs'));
  write('.gitignore', 'test-results/\n');
  const candidate = 'packages/billing/src/example.db.test.ts';
  write(candidate, '// Candidate used by the gate artifact fixture.\n');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = () => {
    git(['add', '.']);
    git(['-c', 'user.name=Gate fixture', '-c', 'user.email=gate@example.test', 'commit', '--no-gpg-sign', '-qm', 'Fixture revision']);
    return git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q']);
  const revision = commit();
  const source = { revision, dirty: false, changes: [] };
  const directory = 'test-results/workspace-db-input';
  write(`${directory}/evidence.json`, { schemaVersion: 1, status: 'passed', selection: { mode: 'full', filters: [] }, source: { before: source, after: source } });
  write(`${directory}/collected.json`, [candidate]);
  write(`${directory}/collected-tests.json`, [{ file: candidate, name: 'persists' }]);
  const report = { success: true, numTotalTests: 1, testResults: [{ name: candidate, status: 'passed', assertionResults: [{ title: 'persists', status: 'passed' }] }] };
  write(`${directory}/results.json`, report);
  const run = (env = {}) => {
    const child = spawnSync(process.execPath, ['scripts/verify-workspace-db-execution.mjs'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, GITHUB_SHA: revision, GITHUB_EVENT_NAME: 'pull_request', TIER1_BASE_SHA: '', DB_SELECTOR_RESULT: 'success', DB_JOB_RESULT: 'success', ...env },
    });
    const result = JSON.parse(readFileSync(path.join(root, 'test-results/workspace-db-gate/aggregate.json'), 'utf8'));
    return { child, result };
  };
  const valid = run(); assert.equal(valid.child.status, 0, valid.child.stderr); assert.equal(valid.result.status, 'passed');
  write(`${directory}/results.json`, '{broken');
  const malformed = run(); assert.equal(malformed.child.status, 1); assert.equal(malformed.result.status, 'failed');
  write(`${directory}/results.json`, report);
  assert.equal(run({ GITHUB_SHA: 'b'.repeat(40) }).result.status, 'failed');
  write('uncommitted.md', 'dirty');
  assert.equal(run().result.status, 'failed');
  rmSync(path.join(root, 'uncommitted.md'));
  write('docs/change.md', 'Documentation only');
  const docsRevision = commit();
  const docs = run({ GITHUB_SHA: docsRevision, TIER1_BASE_SHA: revision, DB_JOB_RESULT: 'skipped' });
  assert.equal(docs.child.status, 0, docs.child.stderr); assert.equal(docs.result.status, 'not-applicable');
  assert.equal(run({ GITHUB_SHA: docsRevision, TIER1_BASE_SHA: revision, DB_JOB_RESULT: 'skipped', DB_SELECTOR_RESULT: 'failure' }).result.status, 'failed');
  write('packages/billing/src/new.db.test.ts', '// Newly tracked required test\n');
  const next = commit();
  const stale = run({ GITHUB_SHA: next, TIER1_BASE_SHA: docsRevision });
  assert.equal(stale.child.status, 1); assert.equal(stale.result.status, 'failed');
  assert.ok(stale.result.failures.some(failure => failure.includes('Uncollected candidate')));
});
