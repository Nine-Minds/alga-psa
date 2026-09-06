#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareExecutionEvidence, reconcileExecution } from './lib/test-execution-evidence.mjs';
import { reconcileTestShards } from './lib/test-sharding.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.resolve(root, process.argv[2] || 'test-results/infrastructure-shards');
const output = path.join(root, 'test-results/infrastructure');
mkdirSync(output, { recursive: true });
const total = Number(process.env.INFRA_SHARD_TOTAL || '1');
const mode = process.env.INFRA_MODE || 'full';
const jobResult = process.env.INFRA_JOB_RESULT ?? (process.env.GITHUB_ACTIONS === 'true' ? 'missing' : 'success');
const revision = testRevision(root).revision;
const shards = [];
const reports = [];
const failures = [];
const verifiedReports = [];
let reportsMatchEvidence = true;
try {
  for (const directory of readdirSync(input, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    try {
      const read = name => JSON.parse(readFileSync(path.join(input, directory.name, `${name}.json`), 'utf8'));
      const evidence = read('evidence');
      const report = read('results');
      // Recompute the assertion evidence from raw reports; do not trust a passed label alone.
      const verified = reconcileExecution({ root, suite: 'infrastructure', revision,
        collected: read('collected'), collectedTests: read('collected-tests'), report, exitCode: evidence.status === 'passed' ? 0 : 1 });
      if (verified.status !== 'passed') failures.push(...verified.failures);
      const mismatches = compareExecutionEvidence(evidence, verified, `Shard ${directory.name}`);
      if (mismatches.length) reportsMatchEvidence = false;
      failures.push(...mismatches);
      verifiedReports.push(verified);
      shards.push(evidence);
      reports.push(report);
    } catch (error) { failures.push(`Cannot read shard ${directory.name}: ${error.message}`); }
  }
} catch (error) { failures.push(`Cannot read required infrastructure evidence: ${error.message}`); }
const aggregate = reconcileTestShards({ shards, suite: 'infrastructure', revision, mode, total, jobResult });
aggregate.failures.push(...failures);
aggregate.status = aggregate.failures.length ? 'failed' : 'passed';
writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(aggregate, null, 2) + '\n');
// Preserve the existing full-suite scorecard as one row rather than three partial rows.
const identities = entries => JSON.stringify((entries || []).map(entry => JSON.stringify(entry)).sort());
const complete = reportsMatchEvidence && jobResult === 'success' && shards.length === total && new Set(shards.map(shard => shard.selection?.shard?.index)).size === total
  && aggregate.expectedFiles.length > 0
  && identities(aggregate.expectedFiles) === identities(aggregate.executedFiles)
  && shards.every(shard => shard.revision === revision && shard.source?.before?.revision === revision && shard.source?.after?.revision === revision
    && shard.selection?.mode === mode && shard.selection?.shard?.total === total)
  && verifiedReports.every(evidence => evidence.expectedTests.length > 0
    && identities(evidence.expectedTests) === identities(evidence.executedTests) && evidence.counts.pending === 0);
const combined = { success: aggregate.status === 'passed', executionCompleteness: complete ? 'complete' : 'incomplete',
  testResults: reports.flatMap(report => report?.testResults || []), startTime: reports.length ? Math.min(...reports.map(report => report.startTime || Date.now())) : Date.now() };
for (const key of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites', 'numRuntimeErrorTestSuites']) {
  combined[key] = reports.reduce((sum, report) => sum + (report?.[key] || 0), 0);
}
writeFileSync(path.join(output, 'results.json'), JSON.stringify(combined, null, 2) + '\n');
for (const failure of aggregate.failures) console.error(failure);
process.exit(aggregate.status === 'passed' ? 0 : 1);
