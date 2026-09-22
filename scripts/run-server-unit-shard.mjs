#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTestFile } from './lib/test-execution-evidence.mjs';
import { partitionTestFiles } from './lib/test-sharding.mjs';
import { testRevision } from './lib/test-revision.mjs';
import { captureServerUnitSource, verifyServerUnitExecution } from './verify-server-unit-execution.mjs';

// One partition of the full server unit suite with coverage. Every shard
// collects the complete inventory, takes its modulo partition (the same
// partitioning the enterprise unit shards use), proves the shard config selects
// exactly that partition, then runs it with a fresh forked process per file.
// The forks run in parallel: per-file recycling keeps files from sharing
// process state, and parallelism is what makes recycling affordable.
// scripts/merge-server-unit-shards.mjs reunites the partitions.
export const serverUnitSelection = ['src/test/unit', '../packages', '../shared', '../ee/packages/workflows/src/actions'];

export function runServerUnitShard({ root, index, total, workers, env = process.env }) {
  const server = path.join(root, 'server');
  const output = path.join(root, 'test-results/server-coverage');
  mkdirSync(output, { recursive: true });
  const file = name => path.join(output, name);
  const paths = {
    collectedAll: file('collected-all.json'), shard: file('shard.json'), shardFiles: file('shard-files.json'),
    collected: file('collected.json'), collectedTests: file('collected-tests.json'), results: file('results.json'),
    blob: file('blob.json'), progress: file('progress.jsonl'), evidence: file('evidence.json'),
  };
  // Remove stale evidence even if the next process cannot start.
  for (const target of Object.values(paths)) writeFileSync(target, 'null\n');
  const runEnv = { ...env, SERVER_UNIT_SHARD_FILES: paths.shardFiles, TEST_PROGRESS_PATH: paths.progress };
  const vitest = args => spawnSync(process.execPath, [path.join(server, 'node_modules/vitest/vitest.mjs'), ...args],
    { cwd: server, env: runEnv, stdio: 'inherit' });
  const shardArgs = ['--config', 'vitest.server-unit-shard.config.ts'];
  const parallelForks = ['--poolOptions.forks.singleFork=false', '--fileParallelism=true', `--maxWorkers=${workers}`];
  const normalized = collected => collected.map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, root)).sort();
  let before;
  let evidence;
  let phase = 'Revision inspection';
  const fail = message => ({ schemaVersion: 1, suite: 'server-unit', revision: before?.revision, status: 'failed',
    failures: [`${phase}: ${message}`], selection: { mode: 'full', filters: [], shard: { index, total } } });
  try {
    before = captureServerUnitSource(root);
    phase = 'File collection';
    if (vitest(['list', ...serverUnitSelection, '--filesOnly', `--json=${paths.collectedAll}`]).status !== 0) throw new Error('Collection failed');
    const allFiles = normalized(JSON.parse(readFileSync(paths.collectedAll, 'utf8')));
    if (!allFiles.length) throw new Error('Server unit suite collected no files');
    phase = 'Partition';
    const assigned = partitionTestFiles(allFiles, index, total);
    writeFileSync(paths.shard, JSON.stringify({ index, total, allFiles, assigned }, null, 2) + '\n');
    writeFileSync(paths.shardFiles, JSON.stringify(assigned.map(entry => path.relative(server, path.join(root, entry)).split(path.sep).join('/'))) + '\n');
    if (vitest(['list', ...shardArgs, '--filesOnly', `--json=${paths.collected}`]).status !== 0) throw new Error('Shard file collection failed');
    const collected = normalized(JSON.parse(readFileSync(paths.collected, 'utf8')));
    if (JSON.stringify(collected) !== JSON.stringify(assigned)) throw new Error('Shard collection differs from its assigned partition');
    phase = 'Test collection';
    if (vitest(['list', ...shardArgs, ...parallelForks, `--json=${paths.collectedTests}`]).status !== 0) throw new Error('Test collection failed');
    console.log(`server-unit shard ${index}/${total}: ${collected.length} of ${allFiles.length} required files`);
    phase = 'Execution';
    // Shards render only the cheap summary; the merge job renders lcov once
    // from the blob coverage maps.
    const result = vitest(['run', ...shardArgs, ...parallelForks,
      '--coverage.enabled=true', '--coverage.reporter=text-summary',
      '--reporter=default', '--reporter=json', '--reporter=blob', `--reporter=${path.join(root, 'scripts/lib/vitest-progress-reporter.mjs')}`,
      `--outputFile.json=${paths.results}`, `--outputFile.blob=${paths.blob}`]);
    phase = 'Execution verification';
    let after;
    let sourceError;
    try { after = testRevision(root); } catch (error) { sourceError = error.message; }
    evidence = verifyServerUnitExecution({ root, revision: before.revision, candidateRevision: env.GITHUB_SHA,
      outcome: result.status === 0 ? 'success' : 'failure', sourceAfter: after, sourceError, sourceDirty: after?.dirty,
      reportPath: paths.results, shard: { index, total, allFiles } });
  } catch (error) {
    evidence = fail(error.message);
    writeFileSync(paths.evidence, JSON.stringify(evidence, null, 2) + '\n');
  }
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const evidence = runServerUnitShard({ root,
    index: Number(process.env.SERVER_UNIT_SHARD_INDEX || '1'),
    total: Number(process.env.SERVER_UNIT_SHARD_TOTAL || '1'),
    workers: Number(process.env.SERVER_UNIT_WORKERS || '4') });
  for (const failure of evidence.failures) console.error(failure);
  console.log(`Server unit shard execution: ${evidence.status}`);
  process.exitCode = evidence.status === 'passed' ? 0 : 1;
}
