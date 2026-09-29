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
  // The inventory proves every tracked test is collectable by a runner in THIS
  // run. The integration and infrastructure lanes only execute their full
  // shard matrices when the change selection is `full`; on a Tier-1 selection
  // (a change inside the reliable import graph) they deliberately run a single
  // partial shard, so repository-wide discoverability cannot be proven here.
  // Report an explicit not-applicable verdict with the selection reason rather
  // than failing on shards this run was never meant to execute, or silently
  // claiming a partial collection is a complete inventory. Full-coverage runs
  // (out-of-graph changes, unknown changes, main/nightly) still reconcile every
  // candidate.
  if (!selection.full) {
    result = { schemaVersion: 1, revision: source.revision, scope: 'repository-inventory',
      executionVerified: false, status: 'not-applicable', reason: selection.reason, failures: [] };
  } else {
    const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    result = verifyRepositoryInventory({ root, revision: source.revision,
      input: path.join(root, 'test-results/inventory-input'), candidates: repositoryTestFiles(root),
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
