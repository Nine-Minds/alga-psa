#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { testRevision } from './lib/test-revision.mjs';
import { repositoryTestFiles } from './lib/test-discovery.mjs';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';
import { verifyRepositoryInventory } from './lib/repository-inventory-artifacts.mjs';

const root = process.cwd();
let result;
try {
  const source = testRevision(root);
  if (source.dirty || source.revision !== process.env.GITHUB_SHA) throw new Error('Inventory checkout is dirty or differs from candidate');
  const selection = selectIntegration(readChangedFiles({ cwd: root, base: process.env.TIER1_BASE_SHA, head: source.revision }));
  if (!selection.shouldRun) {
    result = { schemaVersion: 1, revision: source.revision, scope: 'repository-inventory',
      executionVerified: false, status: 'not-applicable', reason: selection.reason, failures: [] };
  } else {
    const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    result = verifyRepositoryInventory({ root, revision: source.revision,
      input: path.join(root, 'test-results/inventory-input'), candidates: repositoryTestFiles(root), full: selection.full,
      manualRunners: read('scripts/manual-vitest-runners.json'), exclusions: read('scripts/node-test-exclusions.json') });
  }
  const jobs = JSON.parse(process.env.INVENTORY_JOBS || '{}');
  if (jobs.selection?.result !== 'success' || jobs.mobile?.result !== 'success') {
    result.failures.push('Inventory selection or mandatory mobile checks did not succeed');
    result.status = 'failed';
  }
} catch (error) {
  result = { schemaVersion: 1, scope: 'repository-inventory', executionVerified: false, status: 'failed', failures: [error.message] };
}
const output = path.join(root, 'test-results/repository-inventory');
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
process.exitCode = ['passed', 'not-applicable'].includes(result.status) ? 0 : 1;
