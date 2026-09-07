#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCandidateExecutionBundle } from './lib/candidate-execution-artifacts.mjs';
import { evaluateCandidateExecution } from './lib/candidate-execution-gate.mjs';
import { repositoryTestFiles, isAdditionalWorkspaceTest } from './lib/test-discovery.mjs';
import { testRevision } from './lib/test-revision.mjs';

// Consumer-owned minimum: never infer required files from producer reports.
const runtimeFiles = [
  'ee/temporal-workflows/src/__tests__/integration/workflowInvocationPersistence.integration.test.ts',
  'server/src/test/integration/invoiceTicketImmutable.integration.test.ts',
];
const tenantFiles = [
  'ee/temporal-workflows/src/__tests__/e2e/tenant-creation-workflow.e2e.test.ts',
  'ee/temporal-workflows/src/db/__tests__/database-connection.integration.test.ts',
  'ee/temporal-workflows/src/activities/__tests__/user-activities-simple.test.ts',
  'ee/temporal-workflows/src/activities/__tests__/tenant-activities.test.ts',
  'ee/temporal-workflows/src/db/__tests__/product-upgrade-operations.integration.test.ts',
  'ee/temporal-workflows/src/db/__tests__/tenant-setup-idempotency.integration.test.ts',
];

export function verifyCitusExecution({ root, revision, directory, candidates, jobResult }) {
  const requirements = [
    { id: 'citus-runtime', format: 'vitest', candidates: runtimeFiles },
    { id: 'temporal-database', format: 'vitest', candidates: [...new Set([
      ...tenantFiles, ...candidates.filter(file => isAdditionalWorkspaceTest(file, 'temporal-database')),
    ])] },
  ];
  const failures = [];
  const bundles = [];
  for (const requirement of requirements) {
    try {
      bundles.push(readCandidateExecutionBundle({ ...requirement,
        directory: path.join(directory, requirement.id), sourceRoot: root, outcome: jobResult }));
    } catch (error) { failures.push(`${requirement.id}: Cannot read execution artifacts: ${error.message}`); }
  }
  const result = evaluateCandidateExecution({ root, revision, requirements, bundles });
  result.scope = 'citus-execution';
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
    result = verifyCitusExecution({ root, revision: source.revision,
      directory: path.join(root, 'test-results/citus-input'), candidates: repositoryTestFiles(root),
      jobResult: process.env.CITUS_JOB_RESULT });
  } catch (error) {
    result = { schemaVersion: 1, scope: 'citus-execution', status: 'failed', failures: [error.message] };
  }
  const output = path.join(root, 'test-results/citus-gate');
  mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
  for (const failure of result.failures) console.error(failure);
  process.exitCode = result.status === 'passed' ? 0 : 1;
}
