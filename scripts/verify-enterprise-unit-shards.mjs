#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareExecutionEvidence, reconcileExecution } from './lib/test-execution-evidence.mjs';
import { reconcileTestShards } from './lib/test-sharding.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const suite = 'enterprise-unit';
const input = path.resolve(root, process.argv[2] || 'test-results/enterprise-unit-shards');
const output = path.join(root, 'test-results/enterprise-unit');
const revision = testRevision(root).revision;
const shards = [], failures = [];
try {
  for (const entry of readdirSync(input, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const read = name => JSON.parse(readFileSync(path.join(input, entry.name, `${name}.json`), 'utf8'));
    const evidence = read('evidence');
    const verified = reconcileExecution({ root, suite, revision,
      collected: read('collected'), collectedTests: read('collected-tests'), report: read('results'),
      exitCode: evidence.status === 'passed' ? 0 : 1 });
    failures.push(...verified.failures);
    // Partition coverage and totals must come from the reports we just checked.
    // Otherwise a valid report for a different file can accompany a forged
    // manifest claiming that the assigned partition ran.
    failures.push(...compareExecutionEvidence(evidence, verified, `Shard ${entry.name}`));
    shards.push(evidence);
  }
} catch (error) { failures.push(`Cannot verify required enterprise unit reports: ${error.message}`); }
const aggregate = reconcileTestShards({ shards, suite, revision, mode: 'full',
  total: Number(process.env.WORKSPACE_SHARD_TOTAL || '3'),
  jobResult: process.env.WORKSPACE_JOB_RESULT ?? 'missing' });
aggregate.failures.push(...failures);
aggregate.status = aggregate.failures.length ? 'failed' : 'passed';
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(aggregate, null, 2) + '\n');
for (const failure of aggregate.failures) console.error(failure);
process.exitCode = aggregate.status === 'passed' ? 0 : 1;
