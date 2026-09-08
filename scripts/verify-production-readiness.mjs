#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readinessRequirements, evaluateProductionReadiness } from './lib/production-readiness.mjs';
import { readChangedFiles, selectIntegration } from './lib/integration-selection.mjs';
import { verifySupportedUpgrade } from './lib/supported-upgrade-evidence.mjs';
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
    if (['supported-upgrade-execution', 'supported-citus-upgrade-execution'].includes(artifact)) {
      if (!selection.shouldRun) {
        artifacts[artifact] = { schemaVersion: 1, revision: source.revision, scope: 'supported-upgrade',
          status: 'not-applicable', reason: selection.reason, failures: [] };
        continue;
      }
      try {
        const directory = path.join(root, 'test-results/readiness-input', artifact);
        const read = name => JSON.parse(readFileSync(path.join(directory, `${name}.json`), 'utf8'));
        const runner = read('runner'), recorded = read('evidence');
        const verified = verifySupportedUpgrade({ revision: source.revision, root, schema: read('schema'),
          collected: read('collected'), report: read('results'), exitCode: runner.exitCode,
          database: runner.database, applicationRevision: runner.applicationRevision,
          expectedBackend: artifact === 'supported-citus-upgrade-execution' ? 'citus' : 'postgres' });
        if (recorded.status !== 'passed' || recorded.revision !== source.revision
          || recorded.source?.before?.dirty !== false || recorded.source?.after?.dirty !== false
          || recorded.source?.before?.revision !== source.revision || recorded.source?.after?.revision !== source.revision) {
          verified.failures.push('Upgrade browser source/evidence is not a clean candidate execution');
          verified.status = 'failed';
        }
        artifacts[artifact] = verified;
      } catch (error) { unreadable.push(`${artifact}: ${error.message}`); }
      continue;
    }
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
