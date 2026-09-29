#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCandidateExecutionBundle } from './lib/candidate-execution-artifacts.mjs';
import { evaluateCandidateExecution } from './lib/candidate-execution-gate.mjs';
import { repositoryTestFiles, isWorkspaceDbTest } from './lib/test-discovery.mjs';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';
import { testRevision } from './lib/test-revision.mjs';

export function verifyWorkspaceDatabase({ root, revision, directory, candidates, changed, event, selectorResult, jobResult }) {
  const failures = [];
  if (selectorResult !== 'success' && !(event === 'schedule' && selectorResult === 'skipped')) failures.push('Change selector did not succeed');
  const required = event === 'schedule' || selectIntegration(changed).shouldRun;
  let result = { schemaVersion: 1, revision, scope: 'workspace-db-execution', status: 'not-applicable',
    reason: 'Independent diff contains only documentation or identical revisions', results: [], failures: [] };
  if (!required) {
    if (jobResult !== 'skipped') failures.push(`Expected skipped database job, received ${jobResult}`);
  } else {
    try {
      const bundle = readCandidateExecutionBundle({ id: 'workspace-db', format: 'vitest', directory, sourceRoot: root, outcome: jobResult });
      result = evaluateCandidateExecution({ root, revision,
        requirements: [{ id: 'workspace-db', format: 'vitest', candidates }], bundles: [bundle] });
      result.scope = 'workspace-db-execution';
    } catch (error) { failures.push(`Cannot verify database artifacts: ${error.message}`); }
  }
  result.failures.push(...failures);
  if (result.failures.length) result.status = 'failed';
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let result;
  try {
    const source = testRevision(root);
    if (source.dirty || source.revision !== process.env.GITHUB_SHA) throw new Error('Gate checkout is dirty or differs from candidate');
    result = verifyWorkspaceDatabase({ root, revision: source.revision,
      directory: path.join(root, 'test-results/workspace-db-input'),
      candidates: repositoryTestFiles(root).filter(isWorkspaceDbTest),
      changed: readChangedFiles({ cwd: root, base: process.env.TIER1_BASE_SHA, head: source.revision }),
      event: process.env.GITHUB_EVENT_NAME, selectorResult: process.env.DB_SELECTOR_RESULT, jobResult: process.env.DB_JOB_RESULT });
  } catch (error) { result = { schemaVersion: 1, scope: 'workspace-db-execution', status: 'failed', failures: [error.message] }; }
  const output = path.join(root, 'test-results/workspace-db-gate');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
  for (const failure of result.failures) console.error(failure);
  process.exitCode = ['passed', 'not-applicable'].includes(result.status) ? 0 : 1;
}
