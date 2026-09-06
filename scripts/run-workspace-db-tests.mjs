#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = path.join(root, 'server');
const output = path.join(root, 'test-results/workspace-db');
mkdirSync(output, { recursive: true });
const collectedPath = path.join(output, 'collected.json');
const reportPath = path.join(output, 'results.json');
const testsPath = path.join(output, 'collected-tests.json');
const evidencePath = path.join(output, 'evidence.json');
// Remove stale evidence even if the next process cannot start.
for (const file of [collectedPath, testsPath, reportPath, evidencePath]) writeFileSync(file, 'null\n');
const env = {
  ...process.env,
  REQUIRE_DB: '1', SKIP_DB_TESTS: '', REAL_REDIS: '1',
  // These opt-in suites use an explicit connection contract rather than the
  // regular DB_* helpers. Point both at the same isolated migrated database.
  HOUR_BLOCK_DB_TESTS: '1',
  HOUR_BLOCK_DB_HOST: process.env.DB_HOST || '127.0.0.1',
  HOUR_BLOCK_DB_PORT: process.env.DB_PORT || '5432',
  HOUR_BLOCK_DB_USER: process.env.DB_USER_SERVER || 'app_user',
  HOUR_BLOCK_DB_PASSWORD: process.env.DB_PASSWORD_SERVER || '',
  HOUR_BLOCK_DB_NAME: 'test_database',
  TEST_DB_NAME: 'test_database',
  DB_NAME_SERVER: 'test_database',
  ACCOUNTING_SYNC_DB_TESTS: '1',
  ACCOUNTING_SYNC_DB_HOST: process.env.DB_HOST || '127.0.0.1',
  ACCOUNTING_SYNC_DB_PORT: process.env.DB_PORT || '5432',
  ACCOUNTING_SYNC_DB_USER: process.env.DB_USER_SERVER || 'app_user',
  ACCOUNTING_SYNC_DB_PASSWORD: process.env.DB_PASSWORD_SERVER || '',
  ACCOUNTING_SYNC_DB_NAME: 'test_database',
};
const args = ['--config', 'vitest.workspace-db.config.ts', ...process.argv.slice(2)];
const run = (args) => spawnSync(process.execPath, [path.join(cwd, 'node_modules/vitest/vitest.mjs'), ...args], { cwd, env, stdio: 'inherit' });
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
const collection = run(['list', ...args, '--filesOnly', `--json=${collectedPath}`]);
if (collection.status !== 0) {
  writeFileSync(evidencePath, JSON.stringify({ schemaVersion: 1, suite: 'workspace-db', revision, status: 'failed', failures: ['Collection failed'] }, null, 2));
  process.exit(collection.status || 1);
}
const collected = JSON.parse(readFileSync(collectedPath, 'utf8'));
if (!Array.isArray(collected) || !collected.length) throw new Error('Workspace DB suite collected no files');
const testCollection = run(['list', ...args, `--json=${testsPath}`]);
if (testCollection.status !== 0) {
  writeFileSync(evidencePath, JSON.stringify({ schemaVersion: 1, suite: 'workspace-db', revision, status: 'failed', failures: ['Test collection failed'] }, null, 2));
  process.exit(testCollection.status || 1);
}
const collectedTests = JSON.parse(readFileSync(testsPath, 'utf8'));
console.log(`Workspace DB suite: ${collected.length} required files`);
const result = run(['run', ...args, '--reporter=default', '--reporter=json', `--outputFile.json=${reportPath}`]);
let report;
try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; }
const evidence = reconcileExecution({ collected, collectedTests, report, root, suite: 'workspace-db', revision, exitCode: result.status });
evidence.workingTreeDirty = Boolean(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout?.trim());
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
for (const failure of evidence.failures) console.error(failure);
process.exit(evidence.status === 'passed' ? 0 : 1);
