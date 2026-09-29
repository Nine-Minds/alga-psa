#!/usr/bin/env node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareExecutionEvidence, reconcileExecution } from './lib/test-execution-evidence.mjs';
import { reconcileTestShards } from './lib/test-sharding.mjs';
import { repositoryTestFiles } from './lib/test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results/integration-aggregate');
const total = Number(process.env.INTEGRATION_SHARD_TOTAL || '1');
const failures = [], shards = [], reports = [], verifiedReports = [];
let result;
let notApplicable = false;
try {
  const source = testRevision(root);
  if (source.dirty || source.revision !== process.env.GITHUB_SHA) throw new Error('Integration gate checkout is dirty or differs from candidate');
  if (!['true', 'false'].includes(process.env.INTEGRATION_FULL)) throw new Error('Missing or invalid integration coverage selection');
  const selectionResult = process.env.INTEGRATION_SELECTION_RESULT;
  if (selectionResult !== 'success' && !(process.env.INTEGRATION_EVENT === 'schedule' && selectionResult === 'skipped')) {
    throw new Error(`Integration change selection did not succeed: ${selectionResult || 'missing'}`);
  }
  const independentlySelected = selectIntegration(readChangedFiles({ cwd: root, base: process.env.TIER1_BASE_SHA?.trim(), head: source.revision }));
  if (process.env.INTEGRATION_FULL === 'false' && !independentlySelected.shouldRun && process.env.INTEGRATION_JOB_RESULT === 'skipped') {
    notApplicable = true;
    result = { schemaVersion: 1, suite: 'integration', revision: source.revision, status: 'not-applicable',
      reason: independentlySelected.reason, failures: [], expectedFiles: [], executedFiles: [] };
  } else {
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
        verifiedReports.push(verified);
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
    let required = candidates;
    if (process.env.INTEGRATION_FULL !== 'true') {
      const base = process.env.TIER1_BASE_SHA?.trim();
      const decision = selectIntegration(readChangedFiles({ cwd: root, base, head: source.revision }));
      if (!decision.full) {
        required = candidates.filter(file => floor.some(entry => file === entry || file.startsWith(`${entry}/`)));
        if (decision.shouldRun) {
          const temporary = mkdtempSync(path.join(tmpdir(), 'alga-gate-affected-'));
          try {
            const collectedPath = path.join(temporary, 'files.json');
            const collection = spawnSync(process.execPath, [path.join(root, 'server/node_modules/vitest/vitest.mjs'),
              'list', '--filesOnly', '--changed', base, 'src/test/integration',
              '../ee/temporal-workflows/src/__tests__/integration', `--json=${collectedPath}`],
            { cwd: path.join(root, 'server'), encoding: 'utf8', timeout: 120_000 });
            if (collection.status !== 0) throw new Error(collection.stderr || 'Affected collection failed');
            const collected = JSON.parse(readFileSync(collectedPath, 'utf8'));
            if (!Array.isArray(collected)) throw new Error('Missing affected collection');
            for (const entry of collected) {
              if (typeof entry.file !== 'string') throw new Error('Missing affected file identity');
              const file = path.relative(root, path.resolve(root, 'server', entry.file)).split(path.sep).join('/');
              if (!candidates.includes(file)) throw new Error(`Unknown affected integration file: ${file}`);
              required.push(file);
            }
          } catch (error) {
            // Match the runner's safe widening when its import graph is unavailable.
            console.warn(`Independent affected collection unavailable; requiring all integration files: ${error.message}`);
            required = candidates;
          } finally { rmSync(temporary, { recursive: true, force: true }); }
        }
      }
    }
    for (const file of required) if (!result.executedFiles.includes(file)) failures.push(`Missing mandatory integration file: ${file}`);
    for (const file of result.executedFiles) if (!candidates.includes(file)) failures.push(`Unexpected integration file: ${file}`);
    if (!required.length) failures.push('Mandatory integration inventory is empty');
  }
} catch (error) { result = { schemaVersion: 1, status: 'failed', failures: [] }; failures.push(error.message); }
result.expectedTests = verifiedReports.flatMap(evidence => evidence.expectedTests);
result.executedTests = verifiedReports.flatMap(evidence => evidence.executedTests);
result.failures.push(...failures);
result.status = result.failures.length ? 'failed' : notApplicable ? 'not-applicable' : 'passed';
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
const combined = { success: result.status !== 'failed', executionCompleteness: result.status === 'passed' ? 'complete' : notApplicable ? 'not-applicable' : 'incomplete',
  testResults: reports.flatMap(report => report?.testResults || []) };
for (const key of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites', 'numRuntimeErrorTestSuites']) {
  combined[key] = reports.reduce((sum, report) => sum + (report?.[key] || 0), 0);
}
writeFileSync(path.join(output, 'results.json'), JSON.stringify(combined, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
process.exitCode = result.status === 'failed' ? 1 : 0;
