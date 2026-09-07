import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeTestFile } from './test-execution-evidence.mjs';
import { reconcileNodeExecution } from './node-test-execution.mjs';

export function readRunnerCollection(collection, manifestDirectory) {
  if (!collection.collectionFile) return collection;
  if (Object.hasOwn(collection, 'files')) throw new Error(`Ambiguous inline and artifact collection: ${collection.runner}`);
  if (typeof collection.sourceRoot !== 'string' || !path.isAbsolute(collection.sourceRoot)) {
    throw new Error(`Artifact collection requires an absolute sourceRoot: ${collection.runner}`);
  }
  const read = file => readFileSync(path.resolve(manifestDirectory, file), 'utf8');
  const raw = read(collection.collectionFile);
  let files;
  if (collection.format === 'node-events') {
    if (!collection.evidenceFile) throw new Error(`Node collection requires evidenceFile: ${collection.runner}`);
    const evidence = JSON.parse(read(collection.evidenceFile));
    const verified = reconcileNodeExecution({ root: collection.sourceRoot, files: evidence.expectedFiles,
      events: raw.split('\n').filter(Boolean).map(line => JSON.parse(line)),
      suite: evidence.suite, revision: evidence.revision, exitCode: evidence.status === 'passed' ? 0 : 1 });
    if (verified.status !== 'passed') throw new Error(`Invalid Node collection ${collection.runner}: ${verified.failures.join('; ')}`);
    files = verified.executedFiles;
  } else {
    if (collection.format && collection.format !== 'file-list') throw new Error(`Unknown collection format: ${collection.format}`);
    files = JSON.parse(raw);
  }
  if (!Array.isArray(files)) throw new Error(`Collection artifact is not a file list: ${collection.runner}`);
  return { ...collection, files: files.map(entry => normalizeTestFile(typeof entry === 'string' ? entry : entry.file, collection.sourceRoot)) };
}
