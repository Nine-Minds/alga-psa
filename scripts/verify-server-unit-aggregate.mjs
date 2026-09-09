#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCandidateExecutionBundle } from './lib/candidate-execution-artifacts.mjs';
import { evaluateCandidateExecution } from './lib/candidate-execution-gate.mjs';
import { repositoryTestFiles } from './lib/test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';

export function isServerUnitCandidate(file) {
  return /^(server\/src\/test\/unit|packages|shared|ee\/packages\/workflows\/src\/actions)\//.test(file)
    && /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
    && !/(^|\/)node_modules\//.test(file)
    && !/\.db\.test\.[cm]?[jt]sx?$/.test(file);
}

export function verifyServerUnitAggregate({ root, revision, directory, candidates, jobResult }) {
  const failures = [];
  const bundles = [];
  try {
    bundles.push(readCandidateExecutionBundle({ id: 'server-unit', format: 'vitest', directory,
      sourceRoot: root, outcome: jobResult, files: {
        evidence: 'test-results/server-coverage/evidence.json',
        collected: 'test-results/server-coverage/collected.json',
        collectedTests: 'test-results/server-coverage/collected-tests.json', report: 'server/test-results.json',
      } }));
  } catch (error) { failures.push(`Cannot read server unit artifacts: ${error.message}`); }
  const result = evaluateCandidateExecution({ root, revision,
    requirements: [{ id: 'server-unit', format: 'vitest', candidates: candidates.filter(isServerUnitCandidate) }], bundles });
  result.scope = 'server-unit-execution';
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
    result = verifyServerUnitAggregate({ root, revision: source.revision,
      directory: path.join(root, 'test-results/server-unit-input'), candidates: repositoryTestFiles(root),
      jobResult: process.env.SERVER_UNIT_JOB_RESULT });
  } catch (error) { result = { schemaVersion: 1, scope: 'server-unit-execution', status: 'failed', failures: [error.message] }; }
  const output = path.join(root, 'test-results/server-unit-gate');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
  for (const failure of result.failures) console.error(failure);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}
