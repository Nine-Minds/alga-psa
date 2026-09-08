#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readinessRequirements, evaluateProductionReadiness } from './lib/production-readiness.mjs';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';
import { testRevision } from './lib/test-revision.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let result;
try {
  const source = testRevision(root);
  if (source.dirty || source.revision !== process.env.GITHUB_SHA) throw new Error('Readiness checkout is dirty or differs from candidate');
  const artifacts = {}, unreadable = [];
  const changed = readChangedFiles({ cwd: root, base: process.env.TIER1_BASE_SHA, head: source.revision });
  const jobs = JSON.parse(process.env.READINESS_JOBS || '{}');
  const selection = selectIntegration(changed);
  for (const { artifact, revisionSuffix, conditionalWorkflow, job } of readinessRequirements) {
    if (conditionalWorkflow && !selection.shouldRun && jobs[job]?.result === 'skipped') continue;
    const name = artifact + (revisionSuffix ? `-${source.revision}` : '');
    try { artifacts[artifact] = JSON.parse(readFileSync(path.join(root, 'test-results/readiness-input', name, 'aggregate.json'), 'utf8')); }
    catch (error) { unreadable.push(`${artifact}: ${error.message}`); }
  }
  result = evaluateProductionReadiness({ revision: source.revision,
    changed, jobs, artifacts });
  result.failures.push(...unreadable);
  if (result.failures.length) result.status = 'failed';
} catch (error) { result = { schemaVersion: 1, scope: 'production-regression-readiness', status: 'failed', failures: [error.message] }; }
const directory = path.join(root, 'test-results/production-readiness');
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'aggregate.json'), JSON.stringify(result, null, 2) + '\n');
for (const failure of result.failures) console.error(failure);
process.exitCode = result.status === 'passed' ? 0 : 1;
