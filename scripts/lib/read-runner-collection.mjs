import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeTestFile } from './test-execution-evidence.mjs';
import { reconcileNodeExecution } from './node-test-execution.mjs';
import { playwrightTests } from './playwright-execution-evidence.mjs';

export function readRunnerCollection(collection, manifestDirectory) {
  if (!collection.collectionFile) return collection;
  if (Object.hasOwn(collection, 'files')) throw new Error(`Ambiguous inline and artifact collection: ${collection.runner}`);
  if (typeof collection.sourceRoot !== 'string' || !path.isAbsolute(collection.sourceRoot)) {
    throw new Error(`Artifact collection requires an absolute sourceRoot: ${collection.runner}`);
  }
  const read = file => readFileSync(path.resolve(manifestDirectory, file), 'utf8');
  const raw = read(collection.collectionFile);
  let files;
  if (collection.format === 'playwright') {
    files = [...new Set(playwrightTests(JSON.parse(raw), collection.sourceRoot).map(test => test.file))];
    if (!files.length) throw new Error(`Empty Playwright collection: ${collection.runner}`);
  } else if (collection.format === 'node-events') {
    if (!collection.evidenceFile) throw new Error(`Node collection requires evidenceFile: ${collection.runner}`);
    const evidence = JSON.parse(read(collection.evidenceFile));
    const verified = reconcileNodeExecution({ root: collection.sourceRoot, files: evidence.expectedFiles,
      events: raw.split('\n').filter(Boolean).map(line => JSON.parse(line)),
      suite: evidence.suite, revision: evidence.revision, exitCode: evidence.status === 'passed' ? 0 : 1 });
    if (verified.status !== 'passed') throw new Error(`Invalid Node collection ${collection.runner}: ${verified.failures.join('; ')}`);
    files = verified.executedFiles;
  } else if (collection.format === 'vitest') {
    if (!collection.casesFile) throw new Error(`Vitest collection requires casesFile: ${collection.runner}`);
    files = JSON.parse(raw);
    const cases = JSON.parse(read(collection.casesFile));
    if (!Array.isArray(files) || !files.length || !Array.isArray(cases) || !cases.length) {
      throw new Error(`Empty Vitest collection: ${collection.runner}`);
    }
    const normalize = entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, collection.sourceRoot);
    const fileSet = new Set(files.map(normalize));
    if (fileSet.size !== files.length) throw new Error(`Duplicate Vitest file: ${collection.runner}`);
    const registered = new Set(cases.map(entry => {
      if (typeof entry.name !== 'string' || !entry.name.trim()) throw new Error(`Invalid Vitest case: ${collection.runner}`);
      return normalize(entry);
    }));
    for (const file of fileSet) if (!registered.has(file)) throw new Error(`No registered test cases: ${file}`);
    for (const file of registered) if (!fileSet.has(file)) throw new Error(`Case outside file collection: ${file}`);
  } else {
    if (collection.format && collection.format !== 'file-list') throw new Error(`Unknown collection format: ${collection.format}`);
    files = JSON.parse(raw);
  }
  if (!Array.isArray(files)) throw new Error(`Collection artifact is not a file list: ${collection.runner}`);
  return { ...collection, files: files.map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, collection.sourceRoot)) };
}
