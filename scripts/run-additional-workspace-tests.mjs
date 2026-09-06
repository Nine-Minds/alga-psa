#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { isAdditionalWorkspaceTest, reconcileDiscovery, repositoryTestFiles } from './lib/test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = path.join(root, 'server');
const suite = process.argv[2];
if (!['workspace-unit', 'workspace-runtime'].includes(suite)) throw new Error('Usage: node scripts/run-additional-workspace-tests.mjs workspace-unit|workspace-runtime [file filters]');
const output = path.join(root, 'test-results', suite);
mkdirSync(output, { recursive: true });
const collectedPath = path.join(output, 'collected.json');
const reportPath = path.join(output, 'results.json');
const testsPath = path.join(output, 'collected-tests.json');
const evidencePath = path.join(output, 'evidence.json');
const discoveryPath = path.join(output, 'discovery.json');
// Remove stale evidence even if the next process cannot start.
for (const file of [collectedPath, testsPath, reportPath, evidencePath, discoveryPath, path.join(output, 'progress.jsonl')]) writeFileSync(file, 'null\n');
const env = {
  ...process.env,
  SKIP_DB_TESTS: '1', DB_USER_ADMIN: '', DB_PASSWORD_ADMIN: '',
  TEST_PROGRESS_PATH: path.join(output, 'progress.jsonl'),
};
const filters = process.argv.slice(3);
if (filters.some((filter) => filter.startsWith('-'))) throw new Error('Only file filters are supported');
const args = ['--config', `vitest.${suite}.config.ts`, ...filters];
const run = (args) => spawnSync(process.execPath, [path.join(cwd, 'node_modules/vitest/vitest.mjs'), ...args], { cwd, env, stdio: 'inherit' });
let before;
let evidence;
let phase = 'Revision inspection';
try {
  before = testRevision(root);
  phase = 'File collection';
  const collection = run(['list', ...args, '--filesOnly', `--json=${collectedPath}`]);
  if (collection.status !== 0) throw new Error(`Collection failed (exit ${collection.status})`);
  const collected = JSON.parse(readFileSync(collectedPath, 'utf8'));
  if (!Array.isArray(collected) || !collected.length) throw new Error(`${suite} suite collected no files`);
  // A full invocation checks the repository independently of the runner's
  // globs. A developer's explicit file filter is recorded as partial coverage.
  const candidates = filters.length
    ? collected.map((entry) => typeof entry === 'string' ? entry : entry.file)
    : repositoryTestFiles(root).filter((file) => isAdditionalWorkspaceTest(file, suite));
  phase = 'Discovery reconciliation';
  const discovery = reconcileDiscovery({ root, candidates, collections: [{ runner: suite, status: 'passed', files: collected }] });
  writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2) + '\n');
  if (discovery.status !== 'passed') throw new Error(discovery.failures.join('\n'));
  phase = 'Test collection';
  const testCollection = run(['list', ...args, `--json=${testsPath}`]);
  if (testCollection.status !== 0) throw new Error(`Test collection failed (exit ${testCollection.status})`);
  const collectedTests = JSON.parse(readFileSync(testsPath, 'utf8'));
  console.log(`${suite} suite: ${collected.length} required files`);
  phase = 'Execution';
  const result = run(['run', ...args, '--reporter=default', '--reporter=json', '--reporter=../scripts/lib/vitest-progress-reporter.mjs', `--outputFile.json=${reportPath}`]);
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; }
  evidence = reconcileExecution({ collected, collectedTests, report, root, suite, revision: before.revision, exitCode: result.status });
} catch (error) {
  evidence = { schemaVersion: 1, suite, revision: before?.revision, status: 'failed', failures: [`${phase}: ${error.message}`] };
}
evidence.selection = { mode: filters.length ? 'filtered' : 'full', filters };
try {
  const after = testRevision(root);
  evidence.source = { before, after };
  evidence.workingTreeDirty = Boolean(before?.dirty || after.dirty);
  if (before?.revision !== after.revision) {
    evidence.status = 'failed';
    evidence.failures.push('Repository revision changed during testing');
  }
} catch (error) {
  evidence.status = 'failed';
  evidence.failures.push(error.message);
}
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
for (const failure of evidence.failures) console.error(failure);
process.exit(evidence.status === 'passed' ? 0 : 1);
