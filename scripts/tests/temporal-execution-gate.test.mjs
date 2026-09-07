import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTemporalGate, temporalRequirements } from '../lib/temporal-execution-gate.mjs';
import { reconcileExecution } from '../lib/test-execution-evidence.mjs';

function fixture() {
  const root = '/repo', revision = 'a'.repeat(40), bundles = [], candidatesBySuite = {}, jobResults = {};
  for (const { suite, job } of temporalRequirements) {
    const file = `${suite}/behavior.test.ts`;
    const collected = [{ file: `${root}/${file}` }];
    const collectedTests = [{ file: `${root}/${file}`, name: 'persists result' }];
    const report = { success: true, numTotalTests: 1, testResults: [{ name: `${root}/${file}`, status: 'passed', assertionResults: [{ title: 'persists result', status: 'passed' }] }] };
    const evidence = reconcileExecution({ root, revision, suite, collected, collectedTests, report, exitCode: 0 });
    evidence.source = { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } };
    evidence.workingTreeDirty = false;
    evidence.selection = { mode: 'full', filters: [], allFiles: [file], shard: { index: 1, total: 1 } };
    bundles.push({ suite, collected, collectedTests, report, evidence });
    candidatesBySuite[suite] = [file]; jobResults[job] = { result: 'success' };
  }
  return { root, revision, bundles, candidatesBySuite, jobResults };
}
test('both Temporal lanes require matching raw execution, collection and successful jobs', () => {
  const result = evaluateTemporalGate(fixture());
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  assert.equal(result.suites.length, 2);
});
test('Temporal aggregate rejects missing jobs, bundles, assertions, new uncollected files and dirty source', () => {
  for (const mutate of [
    input => { delete input.jobResults['engine-tests']; },
    input => { input.jobResults['fast-readiness'].result = 'skipped'; },
    input => { input.jobResults['engine-tests'].result = 'cancelled'; },
    input => { input.bundles.pop(); },
    input => { input.bundles[0].report.testResults[0].assertionResults = []; },
    input => { input.bundles[1].evidence.source.after.dirty = true; },
    input => { input.candidatesBySuite['temporal-engine'].push('new.test.ts'); },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(evaluateTemporalGate(input).status, 'failed');
  }
});
