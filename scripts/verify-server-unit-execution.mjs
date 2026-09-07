#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileExecution } from './lib/test-execution-evidence.mjs';
import { testRevision } from './lib/test-revision.mjs';

export function verifyServerUnitExecution({ root, revision, outcome, sourceDirty = false, candidateRevision }) {
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
  if (sourceDirty) evidence.failures.push('Unit checkout changed before execution verification');
  if (!candidateRevision || revision !== candidateRevision) evidence.failures.push('Unit checkout does not match candidate revision');
  evidence.status = evidence.failures.length ? 'failed' : 'passed';
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = testRevision(root);
  const evidence = verifyServerUnitExecution({ root, revision: source.revision, sourceDirty: source.dirty,
    candidateRevision: process.env.GITHUB_SHA, outcome: process.env.SERVER_UNIT_RUN_OUTCOME });
  for (const failure of evidence.failures) console.error(failure);
  console.log(`Server unit execution: ${evidence.status}`);
  process.exitCode = evidence.status === 'passed' ? 0 : 1;
}
