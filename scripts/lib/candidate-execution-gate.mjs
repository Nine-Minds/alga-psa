import path from 'node:path';
import { reconcileExecution } from './test-execution-evidence.mjs';
import { reconcileNodeExecution } from './node-test-execution.mjs';
import { reconcilePlaywrightExecution, playwrightTests } from './playwright-execution-evidence.mjs';

// Requirements and tracked candidates must come from the consuming checkout,
// independently of downloaded reports. Unsupported formats fail closed until
// their raw-report adapter is implemented.
export function evaluateCandidateExecution({ root, revision, requirements, bundles }) {
  const failures = [];
  const results = [];
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) failures.push('Invalid candidate revision');
  if (!Array.isArray(requirements) || !requirements.length) failures.push('No mandatory execution requirements');
  if (!Array.isArray(bundles)) failures.push('Missing execution bundles');
  requirements = Array.isArray(requirements) ? requirements : [];
  bundles = Array.isArray(bundles) ? bundles : [];
  const seen = new Set();
  for (const requirement of requirements ?? []) {
    const { id, format, candidates } = requirement ?? {};
    const problems = [];
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) problems.push('Missing or duplicate requirement identity');
    seen.add(id);
    const selected = (bundles ?? []).filter(bundle => bundle?.id === id);
    if (selected.length !== 1) problems.push(`Expected one execution bundle, received ${selected.length}`);
    const bundle = selected[0];
    let verified;
    if (bundle) {
      if (bundle.producerStatus !== undefined && bundle.producerStatus !== 'passed') problems.push(`Producer verification: ${bundle.producerStatus}`);
      if (bundle.outcome !== 'success') problems.push(`Required job: ${bundle.outcome ?? 'missing'}`);
      for (const phase of ['before', 'after']) {
        const source = bundle.source?.[phase];
        if (source?.revision !== revision || source?.dirty !== false || !Array.isArray(source?.changes) || source.changes.length) {
          problems.push(`Source ${phase} is missing, stale or dirty`);
        }
      }
      if (!Array.isArray(bundle.filters) || bundle.filters.length) problems.push('Missing selection or filtered execution');
      try {
        const executionRoot = bundle.sourceRoot ?? root;
        if (typeof executionRoot !== 'string' || !path.isAbsolute(executionRoot)) throw new Error('Invalid producer checkout root');
        if (format === 'vitest') {
          if (!Array.isArray(bundle.collectedTests) || !bundle.collectedTests.length) problems.push('Missing assertion collection');
          verified = reconcileExecution({ ...bundle, root: executionRoot, revision, suite: id, exitCode: bundle.outcome === 'success' ? 0 : 1 });
        } else if (format === 'playwright') {
          verified = reconcilePlaywrightExecution({ ...bundle, root: executionRoot, revision, exitCode: bundle.outcome === 'success' ? 0 : 1 });
          verified.expectedFiles = [...new Set(playwrightTests(bundle.collected, executionRoot).map(test => test.file))];
        } else if (format === 'node-events') {
          verified = reconcileNodeExecution({ root: executionRoot, revision, suite: id, files: candidates, events: bundle.events,
            exitCode: bundle.outcome === 'success' ? 0 : 1 });
        } else {
          problems.push(`Unsupported execution format: ${format}`);
        }
        if (verified) problems.push(...verified.failures);
      } catch (error) { problems.push(`Cannot verify execution: ${error.message}`); }
    }
    if (!Array.isArray(candidates) || !candidates.length || new Set(candidates).size !== candidates.length) {
      problems.push('Missing, empty or duplicate candidate inventory');
    } else if (verified) {
      const collected = new Set(verified.expectedFiles);
      for (const file of candidates) if (!collected.has(file)) problems.push(`Uncollected candidate: ${file}`);
      for (const file of collected) if (!candidates.includes(file)) problems.push(`Unexpected collected file: ${file}`);
    }
    results.push({ id, status: problems.length ? 'failed' : 'passed', counts: verified?.counts, failures: problems });
    failures.push(...problems.map(problem => `${id}: ${problem}`));
  }
  for (const bundle of bundles ?? []) if (!seen.has(bundle?.id)) failures.push(`Unexpected bundle: ${bundle?.id}`);
  return { schemaVersion: 1, revision, scope: 'candidate-execution', status: failures.length ? 'failed' : 'passed', results, failures };
}
