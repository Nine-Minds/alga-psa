#!/usr/bin/env node
/**
 * Emit-site guard for workflow events (alga0002106, plan step E).
 * See scripts/lib/workflow-event-emit-sites.mjs for the rules. Exits 1 on any violation.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeWorkflowEventEmitSites } from './lib/workflow-event-emit-sites.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const started = Date.now();
const { violations, stats } = analyzeWorkflowEventEmitSites(repoRoot);

if (violations.length > 0) {
  console.error(`check-workflow-event-emit-sites: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.code}]  ${v.message}`);
  console.error('\nSee docs/plans/2026-10-10-workflow-event-emitter-schema-contract-test-plan.md (step E).');
  process.exit(1);
}
console.log(
  `check-workflow-event-emit-sites: OK (${stats.productFiles} product files, ${stats.catalogSize} catalogued events, ` +
    `${stats.registeredFunctions} registry-reachable functions, ${Date.now() - started}ms)`
);
