#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileDiscovery, repositoryTestFiles } from './lib/test-discovery.mjs';
import { normalizeTestFile, reconcileExecution } from './lib/test-execution-evidence.mjs';
import { testRevision } from './lib/test-revision.mjs';
import { partitionTestFiles } from './lib/test-sharding.mjs';
import { requiredInfrastructureFiles } from './lib/infrastructure-selection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cwd = path.join(root, 'server');
const mode = process.env.INFRA_MODE || 'full';
const index = Number(process.env.INFRA_SHARD_INDEX || '1');
const total = Number(process.env.INFRA_SHARD_TOTAL || '1');
const output = path.join(root, 'test-results/infrastructure');
mkdirSync(output, { recursive: true });
const files = Object.fromEntries(['all-files', 'collected', 'collected-tests', 'results', 'discovery', 'evidence'].map(name => [name, path.join(output, `${name}.json`)]));
const save = (name, data) => writeFileSync(files[name], JSON.stringify(data, null, 2) + '\n');
const read = name => JSON.parse(readFileSync(files[name], 'utf8'));
for (const file of Object.values(files)) writeFileSync(file, 'null\n');
const env = { ...process.env, REQUIRE_DB: '1', SKIP_DB_TESTS: '', REAL_REDIS: '1' };
const run = args => spawnSync(process.execPath, [path.join(cwd, 'node_modules/vitest/vitest.mjs'), ...args], { cwd, env, stdio: 'inherit' });
let before;
let evidence;
let allFiles = [];
try {
  if (!['full', 'tier1'].includes(mode) || process.argv.length > 2) throw new Error('Use INFRA_MODE=full|tier1 and INFRA_SHARD_INDEX/TOTAL to select infrastructure coverage');
  before = testRevision(root);
  const collection = run(['list', 'src/test/infrastructure', '--filesOnly', `--json=${files['all-files']}`]);
  if (collection.status !== 0) throw new Error(`Infrastructure file collection failed (exit ${collection.status})`);
  const candidates = repositoryTestFiles(root).filter(file => file.startsWith('server/src/test/infrastructure/'));
  const discovery = reconcileDiscovery({ root, candidates,
    collections: [{ runner: 'infrastructure', status: 'passed', files: read('all-files') }],
  });
  save('discovery', discovery);
  if (discovery.status !== 'passed') throw new Error(discovery.failures.join('\n'));
  const complete = read('all-files').map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root)).sort();
  allFiles = requiredInfrastructureFiles(complete, mode);
  const selected = partitionTestFiles(allFiles, index, total);
  const filters = selected.map(file => path.join(root, file));
  // Use explicit file partitions: Vitest 3's --list --filesOnly ignores --shard.
  const filtered = run(['list', ...filters, '--filesOnly', `--json=${files.collected}`]);
  if (filtered.status !== 0) throw new Error('Infrastructure shard collection failed');
  const actual = read('collected').map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(selected)) throw new Error('Runner file filters did not collect the exact assigned partition');
  const testCollection = run(['list', ...filters, `--json=${files['collected-tests']}`]);
  if (testCollection.status !== 0) throw new Error('Infrastructure test collection failed');
  const result = run(['run', ...filters, '--coverage.enabled=false', '--reporter=default', '--reporter=json', `--outputFile.json=${files.results}`]);
  let report;
  try { report = read('results'); } catch { report = null; }
  evidence = reconcileExecution({ root, suite: 'infrastructure', revision: before.revision, exitCode: result.status,
    collected: read('collected'), collectedTests: read('collected-tests'), report });
} catch (error) {
  evidence = { schemaVersion: 1, suite: 'infrastructure', revision: before?.revision, status: 'failed', failures: [error.message] };
}
evidence.selection = { mode, allFiles, shard: { index, total } };
try {
  const after = testRevision(root);
  evidence.source = { before, after };
  evidence.workingTreeDirty = Boolean(before?.dirty || after.dirty);
  if (before?.revision !== after.revision) {
    evidence.status = 'failed';
    evidence.failures.push('Repository revision changed during infrastructure testing');
  }
} catch (error) {
  evidence.status = 'failed'; evidence.failures.push(error.message);
}
save('evidence', evidence);
for (const failure of evidence.failures) console.error(failure);
process.exit(evidence.status === 'passed' ? 0 : 1);
