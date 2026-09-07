import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('the CLI verifies artifact files in a clean checkout and writes non-green evidence for missing or malformed inputs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-temporal-gate-'));
  try {
    const write = (file, value) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
    };
    for (const file of ['verify-temporal-execution.mjs', 'lib/workspace-execution-gate.mjs', 'lib/temporal-execution-gate.mjs',
      'lib/test-execution-evidence.mjs', 'lib/test-discovery.mjs', 'lib/test-sharding.mjs', 'lib/test-revision.mjs']) {
      mkdirSync(path.dirname(path.join(root, 'scripts', file)), { recursive: true });
      cpSync(new URL(`../${file}`, import.meta.url), path.join(root, 'scripts', file));
    }
    const fileFor = suite => suite === 'temporal-engine'
      ? 'ee/temporal-workflows/src/workflows/__tests__/tenant-product-upgrade-workflow.test.ts'
      : 'ee/temporal-workflows/src/config/__tests__/behavior.test.ts';
    write('.gitignore', 'test-results/\n');
    for (const { suite, shards } of temporalRequirements) {
      for (let index = 1; index <= shards; index++) {
        write(fileFor(suite), '// Test candidate for execution-report verification.\n');
      }
    }
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Gate fixture', '-c', 'user.email=gate@example.test', 'commit', '--no-gpg-sign', '-qm', 'Gate fixture']);
    const sha = git(['rev-parse', 'HEAD']);
    const input = fixture();
    for (const bundle of input.bundles) {
      const { suite, evidence } = bundle;
      const files = [fileFor(suite)];
      const file = files[evidence.selection.shard.index - 1];
      bundle.collected = [{ file }]; bundle.collectedTests = [{ file, name: 'persists result' }];
      bundle.report.testResults[0].name = file;
      bundle.evidence = { ...evidence,
        ...reconcileExecution({ root, suite, revision: sha, collected: bundle.collected, collectedTests: bundle.collectedTests, report: bundle.report, exitCode: 0 }),
        selection: { ...evidence.selection, allFiles: files },
        source: { before: { revision: sha, dirty: false, changes: [] }, after: { revision: sha, dirty: false, changes: [] } },
      };
      const artifact = `${suite}-execution`;
      for (const [name, value] of Object.entries({ evidence: bundle.evidence, collected: bundle.collected, 'collected-tests': bundle.collectedTests, results: bundle.report })) {
        write(`test-results/temporal-gate-input/${artifact}/${name}.json`, value);
      }
    }
    const run = (extra = {}) => spawnSync(process.execPath, ['scripts/verify-temporal-execution.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, TEMPORAL_GATE_JOB_RESULTS: JSON.stringify(input.jobResults), ...extra },
    });
    const valid = run(); assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'test-results/temporal-gate/aggregate.json'))).status, 'passed');
    assert.equal(run({ GITHUB_SHA: 'b'.repeat(40) }).status, 1);
    assert.equal(run({ TEMPORAL_GATE_JOB_RESULTS: '{broken' }).status, 1);
    const artifact = `test-results/temporal-gate-input/temporal-readiness-execution/results.json`;
    write(artifact, '{broken'); assert.equal(run().status, 1);
    rmSync(path.join(root, artifact)); assert.equal(run().status, 1);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'test-results/temporal-gate/aggregate.json'))).status, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
