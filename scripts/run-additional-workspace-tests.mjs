#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { isAdditionalWorkspaceTest, reconcileDiscovery, repositoryTestFiles } from './lib/test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';
import { partitionTestFiles } from './lib/test-sharding.mjs';
import { normalizeTestFile } from './lib/test-execution-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const suite = process.argv[2];
const settings = {
  'api-e2e': { directory: 'server', config: 'vitest.api-e2e.config.ts' },
  'temporal-readiness': { directory: 'ee/temporal-workflows', config: 'vitest.readiness.config.ts' },
  'temporal-database': { directory: 'ee/temporal-workflows', config: 'vitest.database.config.ts' },
  'temporal-engine': { directory: 'ee/temporal-workflows', config: 'vitest.engine.config.ts' },
  'nx-tooling': { directory: '.', config: 'tools/nx-tests/vitest.config.ts' },
  'ui-kit-showcase': { directory: 'ee/extensions/samples/ui-kit-showcase', config: 'vitest.config.ts',
    vitest: 'ee/extensions/samples/ui-kit-showcase/node_modules/vitest/vitest.mjs' },
  'workspace-unit': { directory: 'server', config: 'vitest.workspace-unit.config.ts' },
  'workspace-runtime': { directory: 'server', config: 'vitest.workspace-runtime.config.ts' },
  'server-colocated': { directory: 'server', config: 'vitest.server-colocated.config.ts' },
  'enterprise-unit': { directory: 'ee/server', config: 'vitest.unit.config.ts' },
  'enterprise-integration': { directory: 'ee/server', config: 'vitest.integration.config.ts' },
  'ai-gateway': { directory: 'services/ai-gateway', config: 'vitest.config.ts' },
}[suite];
if (!settings) throw new Error('Unknown workspace suite');
const cwd = path.join(root, settings.directory);
const shardIndex = Number(process.env.WORKSPACE_SHARD_INDEX || '1');
const shardTotal = Number(process.env.WORKSPACE_SHARD_TOTAL || '1');
const output = path.join(root, 'test-results', suite, ...(shardTotal > 1 ? [`shard-${shardIndex}`] : []));
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
  ...(suite === 'temporal-readiness' ? { TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP: '1' } : {}),
  ...(suite === 'enterprise-integration'
    ? { REQUIRE_DB: '1', SKIP_DB_TESTS: '', REAL_REDIS: '1', APP_ENV: 'test',
        TEST_DB_NAME: 'alga_ee_integration_test', DB_NAME_SERVER: 'alga_ee_integration_test',
        HUDU_TEST_DB_NAME: 'alga_ee_integration_test' }
    : suite === 'temporal-database'
      ? { REQUIRE_DB: '1', SKIP_DB_TESTS: '', TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP: '1' }
      : { SKIP_DB_TESTS: '1', DB_USER_ADMIN: '', DB_PASSWORD_ADMIN: '' }),
  TEST_PROGRESS_PATH: path.join(output, 'progress.jsonl'),
};
const filters = process.argv.slice(3);
if (filters.some((filter) => filter.startsWith('-'))) throw new Error('Only file filters are supported');
let args = ['--config', settings.config, ...filters];
const run = (args) => spawnSync(process.execPath, [path.join(root, settings.vitest ?? 'server/node_modules/vitest/vitest.mjs'), ...args], { cwd, env, stdio: 'inherit' });
let allFiles = [];
let before;
let evidence;
let mergedMigrations;
let phase = 'Revision inspection';
try {
  if (filters.length && shardTotal > 1) throw new Error('Sharded execution cannot use file filters');
  before = testRevision(root);
  if (suite === 'temporal-database' && (!env.DB_NAME_SERVER || !env.DB_USER_ADMIN || !env.DB_PASSWORD_ADMIN
    || !(env.DB_HOST_ADMIN || env.DB_HOST) || !(env.DB_PORT_ADMIN || env.DB_PORT))) {
    throw new Error('Temporal database tests require an explicit migrated database and admin connection');
  }
  if (suite === 'enterprise-integration') {
    phase = 'Enterprise database configuration';
    if (['DB_HOST', 'DB_PORT', 'DB_USER_ADMIN', 'DB_PASSWORD_ADMIN', 'DB_USER_SERVER', 'DB_PASSWORD_SERVER']
      .some(key => !env[key]?.trim())) {
      throw new Error('Enterprise integration requires explicit DB_HOST, DB_PORT and admin/application DB credentials');
    }
    const databaseUrl = new URL(`postgresql://${env.DB_HOST}:${env.DB_PORT}/${env.TEST_DB_NAME}`);
    databaseUrl.username = env.DB_USER_SERVER;
    databaseUrl.password = env.DB_PASSWORD_SERVER;
    env.DATABASE_URL = databaseUrl.href;
    env.TEST_DATABASE_URL = databaseUrl.href;
    phase = 'Enterprise migration workspace';
    // Match setup/entrypoint.sh: EE files overlay CE collisions. Keep the
    // directory under server/ so migration-relative helpers and resources work.
    mergedMigrations = mkdtempSync(path.join(root, 'server/.ee-combined-migrations-'));
    cpSync(path.join(root, 'server/migrations'), mergedMigrations, { recursive: true });
    cpSync(path.join(root, 'ee/server/migrations'), mergedMigrations, { recursive: true, force: true });
    env.TEST_MIGRATIONS_DIR = mergedMigrations;
  }
  if (suite === 'ai-gateway') {
    phase = 'Service database configuration';
    let database;
    try { database = new URL(env.AI_GATEWAY_TEST_DATABASE_URL); } catch { /* handled below */ }
    if (!database || !['postgres:', 'postgresql:'].includes(database.protocol)
      || !/^\/[a-z0-9_]+_test$/.test(database.pathname)) {
      throw new Error('AI_GATEWAY_TEST_DATABASE_URL must point to a dedicated PostgreSQL database whose name ends in _test');
    }
  }
  phase = 'File collection';
  const collection = run(['list', ...args, '--filesOnly', `--json=${collectedPath}`]);
  if (collection.status !== 0) throw new Error(`Collection failed (exit ${collection.status})`);
  let collected = JSON.parse(readFileSync(collectedPath, 'utf8'));
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
  allFiles = collected.map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root)).sort();
  const assigned = partitionTestFiles(allFiles, shardIndex, shardTotal);
  if (shardTotal > 1) {
    args = [...args.slice(0, 2), ...assigned.map(file => path.join(root, file))];
    const shardCollection = run(['list', ...args, '--filesOnly', `--json=${collectedPath}`]);
    if (shardCollection.status !== 0) throw new Error('Shard file collection failed');
    collected = JSON.parse(readFileSync(collectedPath, 'utf8'));
    const actual = collected.map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(assigned)) throw new Error('Shard collection differs from its assigned partition');
  }
  phase = 'Test collection';
  const testCollection = run(['list', ...args, `--json=${testsPath}`]);
  if (testCollection.status !== 0) throw new Error(`Test collection failed (exit ${testCollection.status})`);
  const collectedTests = JSON.parse(readFileSync(testsPath, 'utf8'));
  console.log(`${suite} suite: ${collected.length} required files`);
  phase = 'Execution';
  const result = run(['run', ...args, '--reporter=default', '--reporter=json', `--reporter=${path.join(root, 'scripts/lib/vitest-progress-reporter.mjs')}`, `--outputFile.json=${reportPath}`]);
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; }
  evidence = reconcileExecution({ collected, collectedTests, report, root, suite, revision: before.revision, exitCode: result.status });
} catch (error) {
  evidence = { schemaVersion: 1, suite, revision: before?.revision, status: 'failed', failures: [`${phase}: ${error.message}`] };
} finally {
  if (mergedMigrations) rmSync(mergedMigrations, { recursive: true, force: true });
}
evidence.selection = { mode: filters.length ? 'filtered' : 'full', filters, allFiles, shard: { index: shardIndex, total: shardTotal } };
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
