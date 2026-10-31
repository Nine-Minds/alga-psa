#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { isWorkspaceDbTest, reconcileDiscovery, repositoryTestFiles } from './lib/test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = path.join(root, 'server');
const output = path.join(root, 'test-results/workspace-db');
mkdirSync(output, { recursive: true });
const collectedPath = path.join(output, 'collected.json');
const reportPath = path.join(output, 'results.json');
const testsPath = path.join(output, 'collected-tests.json');
const evidencePath = path.join(output, 'evidence.json');
const discoveryPath = path.join(output, 'discovery.json');
const databaseName = process.env.TEST_DB_NAME || process.env.DB_NAME_SERVER || 'test_database';
// Remove stale evidence even if the next process cannot start.
for (const file of [collectedPath, testsPath, reportPath, evidencePath, discoveryPath]) writeFileSync(file, 'null\n');
const env = {
  ...process.env,
  REQUIRE_DB: '1', SKIP_DB_TESTS: '', REAL_REDIS: '1',
  // These opt-in suites use an explicit connection contract rather than the
  // regular DB_* helpers. Point them at the same isolated migrated database.
  HOUR_BLOCK_DB_TESTS: '1',
  HOUR_BLOCK_DB_HOST: process.env.DB_HOST || '127.0.0.1',
  HOUR_BLOCK_DB_PORT: process.env.DB_PORT || '5432',
  // Migration up/down creates and drops its marker table, so use the same
  // schema owner as the migration runner. Application credentials intentionally
  // lack CREATE on public in CI; normal action tests still use app_user.
  HOUR_BLOCK_DB_USER: process.env.DB_USER_ADMIN || 'postgres',
  HOUR_BLOCK_DB_PASSWORD: process.env.DB_PASSWORD_ADMIN || '',
  HOUR_BLOCK_DB_NAME: databaseName,
  TEST_DB_NAME: databaseName,
  DB_NAME_SERVER: databaseName,
  // App-credential opt-in suites share one connection contract under their own prefix.
  ...Object.fromEntries(['ACCOUNTING_SYNC', 'OUTBOUND_DIAG', 'INVOICE_LIFECYCLE', 'CONTRACT_LINE_SAVE'].flatMap((prefix) => [
    [`${prefix}_DB_TESTS`, '1'],
    [`${prefix}_DB_HOST`, process.env.DB_HOST || '127.0.0.1'],
    [`${prefix}_DB_PORT`, process.env.DB_PORT || '5432'],
    [`${prefix}_DB_USER`, process.env.DB_USER_SERVER || 'app_user'],
    [`${prefix}_DB_PASSWORD`, process.env.DB_PASSWORD_SERVER || ''],
    [`${prefix}_DB_NAME`, databaseName],
  ])),
};
const args = ['--config', 'vitest.workspace-db.config.ts', ...process.argv.slice(2)];
const run = (args) => spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), ...args], { cwd, env, stdio: 'inherit' });
const filters = process.argv.slice(2);
let before;
let evidence;
let phase = 'Revision inspection';
try {
  before = testRevision(root);
  phase = 'File collection';
  const collection = run(['list', ...args, '--filesOnly', `--json=${collectedPath}`]);
  if (collection.status !== 0) throw new Error(`Collection failed (exit ${collection.status})`);
  const collected = JSON.parse(readFileSync(collectedPath, 'utf8'));
  if (!Array.isArray(collected) || !collected.length) throw new Error('Workspace DB suite collected no files');
  // A full invocation checks the repository independently of the runner's
  // globs. A developer's explicit file filter is recorded as partial coverage.
  const candidates = filters.length
    ? collected.map((entry) => typeof entry === 'string' ? entry : entry.file)
    : repositoryTestFiles(root).filter(isWorkspaceDbTest);
  phase = 'Discovery reconciliation';
  const discovery = reconcileDiscovery({ root, candidates, collections: [{ runner: 'workspace-db', status: 'passed', files: collected }] });
  writeFileSync(discoveryPath, JSON.stringify(discovery, null, 2) + '\n');
  if (discovery.status !== 'passed') throw new Error(discovery.failures.join('\n'));
  phase = 'Test collection';
  const testCollection = run(['list', ...args, `--json=${testsPath}`]);
  if (testCollection.status !== 0) throw new Error(`Test collection failed (exit ${testCollection.status})`);
  const collectedTests = JSON.parse(readFileSync(testsPath, 'utf8'));
  console.log(`Workspace DB suite: ${collected.length} required files`);
  phase = 'Execution';
  const result = run(['run', ...args, '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`]);
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; }
  evidence = reconcileExecution({ collected, collectedTests, report, root, suite: 'workspace-db', revision: before.revision, exitCode: result.status });
} catch (error) {
  evidence = { schemaVersion: 1, suite: 'workspace-db', revision: before?.revision, status: 'failed', failures: [`${phase}: ${error.message}`] };
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
