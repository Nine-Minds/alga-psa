#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdditionalWorkspaceTest, repositoryTestFiles } from './lib/test-discovery.mjs';
import { evaluateTemporalGate, temporalRequirements } from './lib/temporal-execution-gate.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.resolve(root, process.argv[2] || 'test-results/temporal-gate-input');
const output = path.join(root, 'test-results/temporal-gate');
const failures = [], bundles = [];
let result;
try {
  const source = testRevision(root);
  if (source.dirty) failures.push('Gate checkout is dirty');
  if (!process.env.GITHUB_SHA || source.revision !== process.env.GITHUB_SHA) failures.push('Gate checkout does not match the candidate GITHUB_SHA');
  const jobResults = JSON.parse(process.env.TEMPORAL_GATE_JOB_RESULTS || '{}');
  const candidates = repositoryTestFiles(root);
  const candidatesBySuite = {};
  for (const { suite, shards } of temporalRequirements) {
    candidatesBySuite[suite] = candidates.filter(file => isAdditionalWorkspaceTest(file, suite));
    for (let shard = 1; shard <= shards; shard++) {
      const artifact = `${suite}-execution`;
      const read = name => JSON.parse(readFileSync(path.join(input, artifact, `${name}.json`), 'utf8'));
      try {
        bundles.push({ suite, evidence: read('evidence'), collected: read('collected'),
          collectedTests: read('collected-tests'), report: read('results') });
      } catch (error) { failures.push(`Missing or unreadable artifact ${artifact}: ${error.message}`); }
    }
  }
  result = evaluateTemporalGate({ root, revision: source.revision, jobResults, candidatesBySuite, bundles });
} catch (error) {
  result = { schemaVersion: 1, scope: 'temporal-tests', status: 'failed', suites: [], failures: [] };
  failures.push(`Cannot evaluate workspace execution: ${error.message}`);
}
result.failures.push(...failures);
result.status = result.failures.length ? 'failed' : 'passed';
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
console.log(`Temporal execution gate: ${result.status}; ${result.suites.filter(suite => suite.status === 'passed').length}/${temporalRequirements.length} suites complete`);
process.exitCode = result.status === 'passed' ? 0 : 1;
