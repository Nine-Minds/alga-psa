#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(root, 'server');
const files = [
  'ee/temporal-workflows/src/__tests__/integration/workflowInvocationPersistence.integration.test.ts',
  'server/src/test/integration/invoiceTicketImmutable.integration.test.ts',
];
const output = path.join(root, 'test-results/citus-runtime');
mkdirSync(output, { recursive: true });
const save = (name, value) => writeFileSync(path.join(output, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
for (const name of ['collected-tests', 'results', 'evidence']) save(name, null);
const collected = files.map(file => ({ file: path.join(root, file) }));
save('collected', collected);
let evidence;
try {
  if (process.env.TEST_DB_BACKEND !== 'citus') throw new Error('This gate requires TEST_DB_BACKEND=citus');
  const before = testRevision(root);
  const run = args => spawnSync(process.execPath, [path.join(server, 'node_modules/vitest/vitest.mjs'),
    ...args], { cwd: server, stdio: 'inherit' });
  const selection = collected.map(entry => path.relative(server, entry.file));
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
  if (before.revision !== after.revision) evidence.failures.push('Repository revision changed during Citus execution');
  evidence.status = evidence.failures.length ? 'failed' : 'passed';
} catch (error) {
  evidence = { schemaVersion: 1, suite: 'citus-runtime', status: 'failed', failures: [error.message] };
}
save('evidence', evidence);
for (const failure of evidence.failures) console.error(failure);
process.exitCode = evidence.status === 'passed' ? 0 : 1;
