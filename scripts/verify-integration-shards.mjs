#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareExecutionEvidence, reconcileExecution } from './lib/test-execution-evidence.mjs';
import { reconcileTestShards } from './lib/test-sharding.mjs';
import { repositoryTestFiles } from './lib/test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results/integration-aggregate');
const total = Number(process.env.INTEGRATION_SHARD_TOTAL || '1');
const failures = [], shards = [], reports = [];
let result;
try {
  const source = testRevision(root);
  if (source.dirty || source.revision !== process.env.GITHUB_SHA) throw new Error('Integration gate checkout is dirty or differs from candidate');
  if (!['true', 'false'].includes(process.env.INTEGRATION_FULL)) throw new Error('Missing or invalid integration coverage selection');
  const directories = readdirSync(path.join(root, 'test-results/integration-shards'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  const expectedDirectories = Array.from({ length: Number.isInteger(total) && total > 0 ? total : 0 }, (_, index) => `server-integration-shard-${index + 1}`);
  for (const directory of directories) if (!expectedDirectories.includes(directory)) failures.push(`Unexpected integration shard directory: ${directory}`);
  if (!Number.isInteger(total) || total < 1) throw new Error('Invalid shard count');
  for (let index = 1; index <= total; index++) {
    try {
      const directory = path.join(root, 'test-results/integration-shards', `server-integration-shard-${index}`);
      const read = name => JSON.parse(readFileSync(path.join(directory, `${name}.json`), 'utf8'));
      const evidence = read('evidence');
      const report = read('results');
      reports.push(report);
      const verified = reconcileExecution({ root, suite: 'integration', revision: source.revision,
        collected: read('collected'), collectedTests: read('collected-tests'), report, exitCode: evidence.status === 'passed' ? 0 : 1 });
      failures.push(...verified.failures, ...compareExecutionEvidence(evidence, verified, `Shard ${index}`));
      if (evidence.source?.before?.dirty !== false || evidence.source?.after?.dirty !== false || evidence.workingTreeDirty !== false) failures.push(`Shard ${index} source is dirty or missing`);
      for (const phase of ['before', 'after']) {
        const changes = evidence.source?.[phase]?.changes;
        if (!Array.isArray(changes) || changes.length) failures.push(`Shard ${index} source ${phase} changes are missing or nonempty`);
      }
      if (!Array.isArray(evidence.selection?.filters) || evidence.selection.filters.length) failures.push(`Shard ${index} has missing or filtered execution selection`);
      shards.push(evidence);
    } catch (error) { failures.push(`Shard ${index}: ${error.message}`); }
  }
  result = reconcileTestShards({ shards, suite: 'integration', revision: source.revision, mode: 'selected', total,
    jobResult: process.env.INTEGRATION_JOB_RESULT || 'missing' });
  const candidates = repositoryTestFiles(root).filter(file => file.startsWith('server/src/test/integration/') || file.startsWith('ee/temporal-workflows/src/__tests__/integration/'));
  const manifest = JSON.parse(readFileSync(path.join(root, 'server/src/test/integration/tier1.manifest.json'), 'utf8'));
  const floor = manifest.paths.map(file => path.relative(root, path.resolve(root, 'server', file)).split(path.sep).join('/'));
  const required = process.env.INTEGRATION_FULL === 'true' ? candidates : candidates.filter(file => floor.some(entry => file === entry || file.startsWith(`${entry}/`)));
  for (const file of required) if (!result.executedFiles.includes(file)) failures.push(`Missing mandatory integration file: ${file}`);
  for (const file of result.executedFiles) if (!candidates.includes(file)) failures.push(`Unexpected integration file: ${file}`);
  if (!required.length) failures.push('Mandatory integration inventory is empty');
} catch (error) { result = { schemaVersion: 1, status: 'failed', failures: [] }; failures.push(error.message); }
result.failures.push(...failures);
result.status = result.failures.length ? 'failed' : 'passed';
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
const combined = { success: result.status === 'passed', executionCompleteness: result.status === 'passed' ? 'complete' : 'incomplete',
  testResults: reports.flatMap(report => report?.testResults || []) };
for (const key of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites', 'numRuntimeErrorTestSuites']) {
  combined[key] = reports.reduce((sum, report) => sum + (report?.[key] || 0), 0);
}
writeFileSync(path.join(output, 'results.json'), JSON.stringify(combined, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
process.exitCode = result.status === 'passed' ? 0 : 1;
