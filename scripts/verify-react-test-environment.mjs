#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repositoryTestFiles } from './lib/test-discovery.mjs';
import { reconcileReactTestEnvironments } from './lib/react-test-environment.mjs';

// Run from the repository being audited. Every tracked (or newly written) test
// in the server unit and colocated lanes that value-imports React must be
// claimed by a jsdom glob or carry its own @vitest-environment docblock.
const root = process.cwd();
const [outputPath = 'test-results/react-test-environment.json'] = process.argv.slice(2);
let result;
try {
  result = reconcileReactTestEnvironments({ root, files: repositoryTestFiles(root) });
  if (!result.tests.length) result.failures.push('React test inventory is empty');
  result.status = result.failures.length ? 'failed' : 'passed';
} catch (error) {
  result = { schemaVersion: 1, scope: 'react-test-environment', status: 'failed', tests: [], failures: [error.message] };
}
const output = path.resolve(root, outputPath);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
console.log(`React test environment: ${result.status} (${result.tests.length} React tests)`);
process.exitCode = result.status === 'passed' ? 0 : 1;
