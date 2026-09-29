#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareExecutionEvidence, reconcileExecution } from './lib/test-execution-evidence.mjs';
import { reconcileTestShards } from './lib/test-sharding.mjs';
import { testRevision } from './lib/test-revision.mjs';

// Reunites the server unit shards into the single full-selection bundle that
// scripts/verify-server-unit-execution.mjs and the aggregate gate already
// consume: every partition is re-verified against its raw report, the
// partitions must tile the shared inventory exactly, and the merged collection
// manifests plus blob coverage maps are laid out for `vitest --merge-reports`.
export function mergeServerUnitShards({ root, input, total, jobResult, revision }) {
  const suite = 'server-unit';
  const output = path.join(root, 'test-results/server-coverage');
  const blobs = path.join(root, 'test-results/server-unit-blobs');
  mkdirSync(output, { recursive: true });
  mkdirSync(blobs, { recursive: true });
  const failures = [];
  const shards = [];
  const merged = { collected: [], collectedTests: [], progress: [] };
  let sourceBefore = null;
  try {
    const entries = readdirSync(input, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    if (!entries.length) throw new Error('No shard directories');
    for (const name of entries) {
      const directory = path.join(input, name);
      const read = file => JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
      const evidence = read('evidence.json');
      const index = evidence?.selection?.shard?.index;
      const label = `Shard ${index ?? name}`;
      try {
        const collected = read('collected.json');
        const collectedTests = read('collected-tests.json');
        const report = read('results.json');
        const verified = reconcileExecution({ root, suite, revision, collected, collectedTests, report,
          exitCode: evidence.status === 'passed' ? 0 : 1 });
        failures.push(...verified.failures);
        // Partition and totals must come from the reports just checked, so a
        // valid report for another partition cannot accompany a forged manifest.
        failures.push(...compareExecutionEvidence(evidence, verified, label));
        merged.collected.push(...collected);
        merged.collectedTests.push(...collectedTests);
        const blob = path.join(directory, 'blob.json');
        if (!existsSync(blob)) failures.push(`${label} has no blob report`);
        else copyFileSync(blob, path.join(blobs, `blob-${index ?? name}.json`));
        const progress = path.join(directory, 'progress.jsonl');
        if (existsSync(progress)) merged.progress.push(readFileSync(progress, 'utf8').replace(/\n?$/, '\n'));
        sourceBefore ??= evidence.source?.before ?? null;
      } catch (error) { failures.push(`${label}: ${error.message}`); }
      shards.push(evidence);
    }
  } catch (error) { failures.push(`Cannot read server unit shard reports: ${error.message}`); }
  const aggregate = reconcileTestShards({ shards, suite, revision, mode: 'full', total, jobResult });
  aggregate.failures.push(...failures);
  aggregate.status = aggregate.failures.length ? 'failed' : 'passed';
  // The same layout a single full run leaves behind, so the existing
  // verifier and aggregate read the merged bundle unchanged.
  writeFileSync(path.join(output, 'collected.json'), JSON.stringify(merged.collected) + '\n');
  writeFileSync(path.join(output, 'collected-tests.json'), JSON.stringify(merged.collectedTests) + '\n');
  writeFileSync(path.join(output, 'source-before.json'), JSON.stringify(sourceBefore, null, 2) + '\n');
  writeFileSync(path.join(output, 'progress.jsonl'), merged.progress.join(''));
  writeFileSync(path.join(output, 'shard-aggregate.json'), JSON.stringify(aggregate, null, 2) + '\n');
  return aggregate;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const aggregate = mergeServerUnitShards({ root,
    input: path.resolve(root, process.argv[2] || 'test-results/server-unit-shards'),
    total: Number(process.env.SERVER_UNIT_SHARD_TOTAL || '1'),
    jobResult: process.env.SERVER_UNIT_JOB_RESULT ?? 'missing',
    revision: testRevision(root).revision });
  for (const failure of aggregate.failures) console.error(failure);
  console.log(`Server unit shards: ${aggregate.status}`);
  process.exitCode = aggregate.status === 'passed' ? 0 : 1;
}
