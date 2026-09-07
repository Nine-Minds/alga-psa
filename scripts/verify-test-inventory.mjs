#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repositoryTestFiles, reconcileDiscovery } from './lib/test-discovery.mjs';
import { normalizeTestFile } from './lib/test-execution-evidence.mjs';

// Run from the repository being audited. Inputs must contain actual runner
// collection, not reconstructed include globs. Never filter the Git inventory
// to known suite directories: that would hide newly orphaned tests.
const root = process.cwd();
const [manifestPath, outputPath = 'test-results/repository-inventory.json'] = process.argv.slice(2);
let result;
try {
  if (!manifestPath) throw new Error('Usage: verify-test-inventory.mjs <collection-manifest.json> [output.json]');
  const manifest = JSON.parse(readFileSync(path.resolve(root, manifestPath), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported collection manifest schema');
  if (!Array.isArray(manifest.collections)) throw new Error('Missing runner collections');
  const collections = manifest.collections.map(collection => {
    if (!collection.collectionFile) return collection;
    if (Object.hasOwn(collection, 'files')) throw new Error(`Ambiguous inline and artifact collection: ${collection.runner}`);
    if (typeof collection.sourceRoot !== 'string' || !path.isAbsolute(collection.sourceRoot)) {
      throw new Error(`Artifact collection requires an absolute sourceRoot: ${collection.runner}`);
    }
    const artifact = path.resolve(path.dirname(path.resolve(root, manifestPath)), collection.collectionFile);
    const files = JSON.parse(readFileSync(artifact, 'utf8'));
    if (!Array.isArray(files)) throw new Error(`Collection artifact is not a file list: ${collection.runner}`);
    return { ...collection, files: files.map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, collection.sourceRoot)) };
  });
  const failures = [];
  for (const collection of collections) {
    if (typeof collection.owner !== 'string' || !collection.owner.trim()
      || typeof collection.runtime !== 'string' || !collection.runtime.trim()
      || typeof collection.mandatory !== 'boolean') {
      failures.push(`Runner requires owner, runtime and mandatory status: ${collection.runner}`);
    }
  }
  result = reconcileDiscovery({ root, candidates: repositoryTestFiles(root),
    collections, exclusions: manifest.exclusions ?? [] });
  result.scope = 'repository';
  result.runners = collections.map(({ runner, owner, runtime, mandatory, collectionFile, sourceRoot }) => ({ runner, owner, runtime, mandatory, collectionFile, sourceRoot }));
  result.failures.push(...failures);
  result.status = result.failures.length ? 'failed' : 'passed';
} catch (error) {
  result = { schemaVersion: 1, scope: 'repository', status: 'failed', failures: [error.message] };
}
const output = path.resolve(root, outputPath);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
console.log(`Repository test discovery: ${result.status}`);
process.exitCode = result.status === 'passed' ? 0 : 1;
