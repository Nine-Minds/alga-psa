#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { testRevision } from './lib/test-revision.mjs';
import { reconcileDiscovery } from './lib/test-discovery.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(root, 'server');
const files = [
  'ee/temporal-workflows/src/__tests__/integration/workflowInvocationPersistence.integration.test.ts',
  'server/src/test/integration/invoiceTicketImmutable.integration.test.ts',
];
const output = path.join(root, 'test-results/citus-runtime');
mkdirSync(output, { recursive: true });
const save = (name, value) => writeFileSync(path.join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
for (const name of ['collected', 'collected-tests', 'results', 'evidence', 'discovery']) save(name, null);
let evidence;
try {
  if (process.argv.length !== 2) throw new Error('Citus runtime requires complete execution without CLI filters');
  if (process.env.TEST_DB_BACKEND !== 'citus') throw new Error('This gate requires TEST_DB_BACKEND=citus');
  const before = testRevision(root);
  const run = args => spawnSync(process.execPath, [path.join(server, 'node_modules/vitest/vitest.mjs'),
    ...args], { cwd: server, stdio: 'inherit' });
  const selection = files.map(file => path.relative(server, path.join(root, file)));
  const fileCollection = run(['list', ...selection, '--filesOnly', `--json=${path.join(output, 'collected.json')}`]);
  if (fileCollection.status !== 0) throw new Error('Citus runtime file collection failed');
  const collected = JSON.parse(readFileSync(path.join(output, 'collected.json'), 'utf8'));
  const discovery = reconcileDiscovery({ root, candidates: files,
    collections: [{ runner: 'citus-runtime', status: 'passed', files: collected }] });
  save('discovery', discovery);
  if (discovery.status !== 'passed') throw new Error(discovery.failures.join('\n'));
  const collection = run(['list', ...selection, `--json=${path.join(output, 'collected-tests.json')}`]);
  if (collection.status !== 0) throw new Error('Citus runtime collection failed');
  const collectedTests = JSON.parse(readFileSync(path.join(output, 'collected-tests.json'), 'utf8'));
  if (!Array.isArray(collectedTests) || !collectedTests.length) throw new Error('Citus runtime collection is empty');
  const result = run(['run', ...selection, '--no-file-parallelism', '--coverage.enabled=false', '--reporter=default', '--reporter=json',
    `--outputFile.json=${path.join(output, 'results.json')}`]);
  const report = JSON.parse(readFileSync(path.join(output, 'results.json'), 'utf8'));
  evidence = reconcileExecution({ collected, collectedTests, report, root, suite: 'citus-runtime',
    revision: before.revision, exitCode: result.status });
  const after = testRevision(root);
  evidence.source = { before, after };
  evidence.workingTreeDirty = before.dirty || after.dirty;
  evidence.selection = { mode: 'full', filters: [] };
  if (before.revision !== after.revision) evidence.failures.push('Repository revision changed during Citus execution');
  evidence.status = evidence.failures.length ? 'failed' : 'passed';
} catch (error) {
  evidence = { schemaVersion: 1, suite: 'citus-runtime', status: 'failed', failures: [error.message] };
}
save('evidence', evidence);
for (const failure of evidence.failures) console.error(failure);
process.exitCode = evidence.status === 'passed' ? 0 : 1;
