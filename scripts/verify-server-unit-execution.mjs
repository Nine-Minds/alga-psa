#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { testRevision } from './lib/test-revision.mjs';

export function verifyServerUnitExecution({ root, revision, outcome, sourceDirty = false, candidateRevision, sourceError, sourceAfter }) {
  const directory = path.join(root, 'test-results/server-coverage');
  let evidence;
  try {
    const read = file => JSON.parse(readFileSync(file, 'utf8'));
    evidence = reconcileExecution({ root, revision, suite: 'server-unit',
      exitCode: outcome === 'success' ? 0 : 1,
      collected: read(path.join(directory, 'collected.json')),
      collectedTests: read(path.join(directory, 'collected-tests.json')),
      report: read(path.join(root, 'server/test-results.json')),
    });
  } catch (error) {
    evidence = { schemaVersion: 1, suite: 'server-unit', revision, status: 'failed', failures: [error.message] };
  }
  let before;
  try { before = JSON.parse(readFileSync(path.join(directory, 'source-before.json'), 'utf8')); }
  catch (error) { evidence.failures.push(`Missing unit source capture: ${error.message}`); }
  const after = sourceAfter ?? { revision, dirty: sourceDirty, changes: sourceDirty ? [{ file: 'unknown' }] : [] };
  evidence.source = { before, after };
  evidence.workingTreeDirty = before?.dirty !== false || after.dirty !== false;
  evidence.selection = { mode: 'full', filters: [] };
  for (const [phase, source] of Object.entries(evidence.source)) {
    if (source?.revision !== candidateRevision || source?.dirty !== false || !Array.isArray(source?.changes) || source.changes.length) {
      evidence.failures.push(`Unit source ${phase} is missing, stale or dirty`);
    }
  }
  if (sourceError) evidence.failures.push(`Cannot inspect unit checkout: ${sourceError}`);
  if (sourceDirty) evidence.failures.push('Unit checkout changed before execution verification');
  if (!candidateRevision || revision !== candidateRevision) evidence.failures.push('Unit checkout does not match candidate revision');
  evidence.status = evidence.failures.length ? 'failed' : 'passed';
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

export function runServerUnitVerification(root, env = process.env) {
  let source;
  let sourceError;
  try { source = testRevision(root); }
  catch (error) { sourceError = error.message; }
  return verifyServerUnitExecution({ root, revision: source?.revision, sourceDirty: source?.dirty,
    sourceError, sourceAfter: source, candidateRevision: env.GITHUB_SHA, outcome: env.SERVER_UNIT_RUN_OUTCOME });
}

export function captureServerUnitSource(root) {
  const source = testRevision(root);
  const directory = path.join(root, 'test-results/server-coverage');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'source-before.json'), JSON.stringify(source, null, 2) + '\n');
  if (source.dirty) throw new Error('Unit checkout is dirty before collection');
  return source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (process.argv[2] === '--capture-source') {
    captureServerUnitSource(root);
  } else {
    const evidence = runServerUnitVerification(root);
    for (const failure of evidence.failures) console.error(failure);
    console.log(`Server unit execution: ${evidence.status}`);
    process.exitCode = evidence.status === 'passed' ? 0 : 1;
  }
}
