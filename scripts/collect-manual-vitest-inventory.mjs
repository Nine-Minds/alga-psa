#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collectVitestInventory } from './lib/vitest-inventory-collection.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = process.cwd();
const output = path.join(root, 'test-results/repository-discovery/manual-vitest');
mkdirSync(output, { recursive: true });
const before = testRevision(root);
const failures = [], collections = [];
const runners = JSON.parse(readFileSync(path.join(root, 'scripts/manual-vitest-runners.json'), 'utf8'));
if (process.argv.length !== 2) throw new Error('Manual discovery always collects all registered manual runners; filters are not allowed.');
for (const runner of runners) {
  console.log(`Collecting ${runner.runner}`);
  try {
    const collection = collectVitestInventory({ root, runner, output });
    collections.push(collection);
    failures.push(...collection.failures);
    console.log(`${runner.runner}: ${collection.files.length} files, ${collection.collectedTests} registered cases`);
  } catch (error) {
    failures.push(error.message);
    collections.push({ runner: runner.runner, owner: runner.owner, runtime: runner.runtime,
      mandatory: runner.mandatory ?? true, status: 'failed', files: [], failures: [error.message] });
  }
}
const after = testRevision(root);
if (before.dirty || after.dirty || before.revision !== after.revision) failures.push('Repository collection requires an unchanged clean checkout');
const result = { schemaVersion: 1, revision: before.revision, sourceRoot: root,
  scope: 'manual-vitest-collection', executionVerified: false,
  status: failures.length ? 'failed' : 'passed', source: { before, after }, collections, failures };
writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
for (const failure of failures) console.error(failure);
process.exitCode = failures.length ? 1 : 0;
