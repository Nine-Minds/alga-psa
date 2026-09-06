import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWorkspaceGate, workspaceRequirements } from '../lib/workspace-execution-gate.mjs';
import { reconcileExecution } from '../lib/test-execution-evidence.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const revision = 'a'.repeat(40);
function fixture() {
  const root = '/repo', bundles = [], candidatesBySuite = {}, jobResults = {};
  for (const { suite, job, shards } of workspaceRequirements) {
    jobResults[job] = { result: 'success' };
    const files = Array.from({ length: shards }, (_, index) => `${suite}/case-${index + 1}.test.ts`);
    candidatesBySuite[suite] = files;
    for (const [index, file] of files.entries()) {
      const collected = [{ file: `${root}/${file}` }];
      const collectedTests = [{ file: `${root}/${file}`, name: 'persists customer result' }];
      const report = { success: true, numTotalTests: 1, testResults: [{ name: `${root}/${file}`, status: 'passed',
        assertionResults: [{ title: 'persists customer result', status: 'passed' }] }] };
      const evidence = reconcileExecution({ root, suite, revision, collected, collectedTests, report, exitCode: 0 });
      evidence.selection = { mode: 'full', filters: [], allFiles: files, shard: { index: index + 1, total: shards } };
      evidence.source = { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } };
      evidence.workingTreeDirty = false;
      bundles.push({ suite, collected, collectedTests, report, evidence });
    }
  }
  jobResults['enterprise-unit-complete'] = { result: 'success' };
  // Cross the same serialization boundary as uploaded JSON artifacts.
  return JSON.parse(JSON.stringify({ root, revision, jobResults, candidatesBySuite, bundles }));
}

test('complete independent inventory, raw reports and successful jobs pass together', () => {
  const result = evaluateWorkspaceGate(fixture());
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  assert.equal(result.suites.length, 8);
  assert.equal(result.suites.reduce((sum, suite) => sum + suite.counts.passed, 0), 10);
});

test('missing, failed, cancelled and skipped prerequisites cannot be hidden by passing artifacts', () => {
  for (const job of Object.keys(fixture().jobResults)) {
    for (const state of ['failure', 'cancelled', 'skipped', undefined]) {
      const input = fixture(); input.jobResults[job] = state ? { result: state } : undefined;
      const result = evaluateWorkspaceGate(input);
      assert.equal(result.status, 'failed');
      assert.ok(result.failures.some(failure => failure.includes(`Required job ${job}`)));
    }
  }
});

test('missing or duplicate suites and EE partitions fail independently of matrix success', () => {
  for (const index of [0, 6, 8]) {
    const missing = fixture(); missing.bundles.splice(index, 1);
    assert.equal(evaluateWorkspaceGate(missing).status, 'failed');
    const duplicate = fixture(); duplicate.bundles.push(structuredClone(duplicate.bundles[index]));
    assert.equal(evaluateWorkspaceGate(duplicate).status, 'failed');
  }
});

test('stale source, dirty source, filtered runs and unknown provenance are rejected', () => {
  for (const mutate of [
    input => { input.revision = 'b'.repeat(40); },
    input => { input.bundles[0].evidence.revision = 'b'.repeat(40); },
    input => { input.bundles[0].evidence.source.after.revision = 'b'.repeat(40); },
    input => { input.bundles[0].evidence.source.before.dirty = true; },
    input => { input.bundles[0].evidence.source.after.changes = [{ file: 'edited.ts' }]; },
    input => { delete input.bundles[0].evidence.source; },
    input => { delete input.bundles[0].evidence.workingTreeDirty; },
    input => { input.bundles[0].evidence.selection.mode = 'filtered'; },
    input => { input.bundles[0].evidence.selection.filters = ['one-file']; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(evaluateWorkspaceGate(input).status, 'failed');
  }
});

test('a newly unmatched or moved tracked test fails even when every uploaded manifest passes', () => {
  const added = fixture(); added.candidatesBySuite['workspace-unit'].push('workspace-unit/new.test.ts');
  const result = evaluateWorkspaceGate(added);
  assert.equal(result.status, 'failed');
  assert.ok(result.failures.some(failure => failure.includes('No runner collects test: workspace-unit/new.test.ts')));
  const moved = fixture(); moved.candidatesBySuite['workspace-unit'][0] = 'workspace-unit/moved.test.ts';
  assert.equal(evaluateWorkspaceGate(moved).status, 'failed');
  const empty = fixture(); empty.candidatesBySuite['workspace-unit'] = [];
  assert.equal(evaluateWorkspaceGate(empty).status, 'failed');
});

test('raw skip, todo, failed, truncated and absent reports override a passing manifest', () => {
  for (const mutate of [
    bundle => { bundle.report.testResults[0].assertionResults[0].status = 'skipped'; },
    bundle => { bundle.report.testResults[0].assertionResults[0].status = 'todo'; },
    bundle => { bundle.report.testResults[0].assertionResults[0].status = 'failed'; },
    bundle => { bundle.report.testResults[0].assertionResults = []; },
    bundle => { bundle.report.numTotalTests = 2; },
    bundle => { bundle.report = null; },
    bundle => { bundle.collectedTests = []; },
    bundle => { delete bundle.collectedTests; },
    bundle => { bundle.evidence.counts.passed = 100; },
  ]) {
    const input = fixture(); mutate(input.bundles[0]);
    assert.equal(evaluateWorkspaceGate(input).status, 'failed');
  }
});

test('a valid report for another file cannot authorize a claimed partition', () => {
  const input = fixture(), bundle = input.bundles.at(-1);
  bundle.report.testResults[0].name = '/repo/enterprise-unit/different.test.ts';
  bundle.collected[0].file = bundle.report.testResults[0].name;
  bundle.collectedTests[0].file = bundle.report.testResults[0].name;
  const result = evaluateWorkspaceGate(input);
  assert.equal(result.status, 'failed');
  assert.ok(result.failures.some(failure => failure.includes('disagrees with its raw report')));
});

test('the CLI verifies artifact files in a clean checkout and writes non-green evidence for missing or malformed inputs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-workspace-gate-'));
  try {
    const write = (file, value) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
    };
    for (const file of ['verify-workspace-execution.mjs', 'lib/workspace-execution-gate.mjs',
      'lib/test-execution-evidence.mjs', 'lib/test-discovery.mjs', 'lib/test-sharding.mjs', 'lib/test-revision.mjs']) {
      mkdirSync(path.dirname(path.join(root, 'scripts', file)), { recursive: true });
      cpSync(new URL(`../${file}`, import.meta.url), path.join(root, 'scripts', file));
    }
    const directories = {
      'workspace-unit': 'services/email-service/src', 'workspace-runtime': 'services/workflow-worker/src',
      'server-colocated': 'server/src/lib', 'nx-tooling': 'tools/nx-tests',
      'ui-kit-showcase': 'ee/extensions/samples/ui-kit-showcase/test',
      'enterprise-integration': 'ee/server/src/__tests__/integration',
      'ai-gateway': 'services/ai-gateway/src/test', 'enterprise-unit': 'ee/server/src/__tests__/unit',
    };
    write('.gitignore', 'test-results/\n');
    for (const { suite, shards } of workspaceRequirements) {
      for (let index = 1; index <= shards; index++) {
        write(`${directories[suite]}/case-${index}${suite === 'workspace-runtime' ? '.integration' : ''}.test.ts`, '// Test candidate for execution-report verification.\n');
      }
    }
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-q']); git(['add', '.']);
    git(['-c', 'user.name=Gate fixture', '-c', 'user.email=gate@example.test', 'commit', '--no-gpg-sign', '-qm', 'Gate fixture']);
    const sha = git(['rev-parse', 'HEAD']);
    const input = fixture();
    for (const bundle of input.bundles) {
      const { suite, evidence } = bundle;
      const suffix = suite === 'workspace-runtime' ? '.integration.test.ts' : '.test.ts';
      const files = evidence.selection.allFiles.map((_, index) => `${directories[suite]}/case-${index + 1}${suffix}`);
      const file = files[evidence.selection.shard.index - 1];
      bundle.collected = [{ file }]; bundle.collectedTests = [{ file, name: 'persists customer result' }];
      bundle.report.testResults[0].name = file;
      bundle.evidence = { ...evidence,
        ...reconcileExecution({ root, suite, revision: sha, collected: bundle.collected, collectedTests: bundle.collectedTests, report: bundle.report, exitCode: 0 }),
        selection: { ...evidence.selection, allFiles: files },
        source: { before: { revision: sha, dirty: false, changes: [] }, after: { revision: sha, dirty: false, changes: [] } },
      };
      const artifact = evidence.selection.shard.total > 1 ? `${suite}-shard-${evidence.selection.shard.index}` : `${suite}-${sha}`;
      for (const [name, value] of Object.entries({ evidence: bundle.evidence, collected: bundle.collected, 'collected-tests': bundle.collectedTests, results: bundle.report })) {
        write(`test-results/workspace-gate-input/${artifact}/${name}.json`, value);
      }
    }
    const run = (extra = {}) => spawnSync(process.execPath, ['scripts/verify-workspace-execution.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, WORKSPACE_GATE_JOB_RESULTS: JSON.stringify(input.jobResults), ...extra },
    });
    const valid = run(); assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'test-results/workspace-gate/aggregate.json'))).status, 'passed');
    assert.equal(run({ GITHUB_SHA: 'b'.repeat(40) }).status, 1);
    assert.equal(run({ WORKSPACE_GATE_JOB_RESULTS: '{broken' }).status, 1);
    const artifact = `test-results/workspace-gate-input/workspace-unit-${sha}/results.json`;
    write(artifact, '{broken'); assert.equal(run().status, 1);
    rmSync(path.join(root, artifact)); assert.equal(run().status, 1);
    assert.equal(JSON.parse(readFileSync(path.join(root, 'test-results/workspace-gate/aggregate.json'))).status, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
