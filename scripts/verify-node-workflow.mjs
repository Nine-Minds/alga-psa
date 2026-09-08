#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryTestFiles, isNodeToolingTest, isApplianceNodeTest, reconcileDiscovery } from './lib/test-discovery.mjs';
import { reconcileNodeExecution } from './lib/node-test-execution.mjs';
import { discoverBrowserTests } from './lib/browser-test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';

export function verifyNodeWorkflow({ root, revision, input, jobs }) {
  const failures = [], results = [];
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) failures.push('Invalid candidate revision');
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  const candidates = repositoryTestFiles(root);
  for (const [job, artifact, predicate] of [
    ['node-tooling', 'node-tooling', isNodeToolingTest],
    ['appliance', 'appliance-node', isApplianceNodeTest],
    ['browser-discovery', 'browser-discovery', null],
  ]) {
    const problems = [];
    let verified;
    try {
      if (jobs?.[job]?.result !== 'success') problems.push(`Required job: ${jobs?.[job]?.result ?? 'missing'}`);
      const directory = path.join(input, `${artifact}-${revision}`);
      const evidence = read(path.join(directory, 'evidence.json'));
      if (evidence.status !== 'passed' || !Array.isArray(evidence.failures) || evidence.failures.length) problems.push('Producer verification failed or malformed');
      if (!path.isAbsolute(evidence.sourceRoot ?? '')) throw new Error('Missing producer checkout root');
      for (const source of predicate ? [evidence.source?.before, evidence.source?.after] : [evidence.sourceBefore, evidence.sourceAfter]) {
        if (source?.revision !== revision || source.dirty !== false || !Array.isArray(source.changes) || source.changes.length) problems.push('Missing, stale or dirty source evidence');
      }
      if (predicate) {
        if (evidence.selection?.mode !== 'full') problems.push('Required Node selection is not full');
        const selected = candidates.filter(predicate);
        const exclusions = job === 'node-tooling' ? read(path.join(root, 'scripts/node-test-exclusions.json')) : [];
        const files = selected.filter(file => !exclusions.some(exclusion => exclusion.file === file));
        const events = readFileSync(path.join(directory, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        verified = reconcileNodeExecution({ root: evidence.sourceRoot, revision, suite: job, files, events, exitCode: 0 });
        const discovery = reconcileDiscovery({ root, candidates: selected, exclusions,
          collections: [{ runner: job, status: verified.status, files: verified.executedFiles }] });
        problems.push(...discovery.failures);
      } else {
        const runners = ['server-legacy', 'enterprise-legacy', 'enterprise-deploy', 'production-community', 'production-enterprise'];
        verified = discoverBrowserTests(root, runners.map(runner => ({ runner, exitCode: 0,
          report: read(path.join(directory, `${runner}.json`)) })), evidence.sourceRoot);
      }
      problems.push(...verified.failures);
    } catch (error) { problems.push(`Cannot verify artifacts: ${error.message}`); }
    results.push({ id: job, status: problems.length ? 'failed' : 'passed', counts: verified?.counts,
      executionVerified: predicate !== null, failures: problems });
    failures.push(...problems.map(problem => `${job}: ${problem}`));
  }
  return { schemaVersion: 1, scope: 'node-workflow', revision, status: failures.length ? 'failed' : 'passed', results, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let result;
  try {
    const source = testRevision(root);
    if (source.dirty || source.revision !== process.env.GITHUB_SHA) throw new Error('Gate checkout is dirty or differs from candidate');
    result = verifyNodeWorkflow({ root, revision: source.revision, input: path.join(root, 'test-results/node-workflow-input'),
      jobs: JSON.parse(process.env.NODE_WORKFLOW_JOBS || '{}') });
  } catch (error) { result = { schemaVersion: 1, scope: 'node-workflow', status: 'failed', failures: [error.message] }; }
  const output = path.join(root, 'test-results/node-workflow-gate');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
  for (const failure of result.failures) console.error(failure);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}
