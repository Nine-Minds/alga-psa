import { test } from 'node:test';
import { testCounts } from '../record-test-metrics.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../', import.meta.url));
test('actual integration runner partitions, executes and rejects missing or stale shard evidence', { timeout: 120_000 }, t => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-integration-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  for (const file of ['scripts/run-tier1-integration.mjs', 'scripts/verify-integration-shards.mjs',
    'scripts/lib/integration-selection.mjs', 'scripts/lib/test-discovery.mjs', 'scripts/lib/test-execution-evidence.mjs', 'scripts/lib/test-revision.mjs', 'scripts/lib/test-sharding.mjs']) {
    write(file, readFileSync(path.join(source, file), 'utf8'));
  }
  write('.gitignore', 'node_modules\ntest-results/\nserver/test-results-integration.json\n');
  write('server/vitest.config.mjs', `export default ${JSON.stringify({ test: { globals: true, include: ['src/test/integration/**/*.test.ts'], fileParallelism: false, maxWorkers: 1 } })};`);
  const files = ['billing/invoices/invoiceDueDate.test.ts', 'billing/invoices/manualInvoice.test.ts',
    'billing/tax/taxRoundingBehavior.test.ts', 'billing/credits/creditApplication.test.ts', 'extra.test.ts'];
  for (const file of files) write(`server/src/test/integration/${file}`, "test('observes the result', () => expect(2 + 3).toBe(5));\n");
  write('server/src/amount.ts', 'export const amount = () => 5;\n');
  write('server/src/test/integration/extra.test.ts', "import { amount } from '../../amount'; test('observes affected behavior', () => expect(amount()).toBeGreaterThan(0));\n");
  write('server/src/test/integration/tier1.manifest.json', JSON.stringify({ paths: ['src/test/integration/billing/invoices/invoiceDueDate.test.ts'] }));
  symlinkSync(path.join(source, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'CI fixture');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const run = (script, index = 1, mode = 'full', total = 3, base = '') => spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, CI: '1', TIER1_BASE_SHA: base, GITHUB_SHA: git('rev-parse', 'HEAD').trim(), INTEGRATION_FULL: String(mode === 'full'), INTEGRATION_JOB_RESULT: 'success', INTEGRATION_SHARD_INDEX: String(index), INTEGRATION_SHARD_TOTAL: String(total) },
  });
  const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  for (const index of [1, 2, 3]) {
    const result = run('run-tier1-integration.mjs', index);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const evidence = read('test-results/integration/evidence.json');
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.workingTreeDirty, false);
    assert.equal(evidence.expectedFiles.length, index === 3 ? 1 : 2);
    cpSync(path.join(root, 'test-results/integration'), path.join(root, `test-results/integration-shards/server-integration-shard-${index}`), { recursive: true });
  }
  let combined = run('verify-integration-shards.mjs');
  assert.equal(combined.status, 0, combined.stdout + combined.stderr);
  assert.equal(read('test-results/integration-aggregate/aggregate.json').counts.passed, 5);

  const metrics = () => testCounts(read('test-results/integration-aggregate/results.json'), read('test-results/integration-aggregate/aggregate.json'), git('rev-parse', 'HEAD').trim());
  assert.equal(metrics().runStatus, 'complete');
  assert.equal(metrics().passed, 5);
  assert.equal(metrics().passPct, 100);
  const duplicateDirectory = path.join(root, 'test-results/integration-shards/unexpected-shard');
  mkdirSync(duplicateDirectory);
  assert.equal(run('verify-integration-shards.mjs').status, 1);
  assert.equal(metrics().runStatus, 'partial');
  assert.equal(metrics().passPct, '');
  rmSync(duplicateDirectory, { recursive: true });
  const reportFile = 'test-results/integration-shards/server-integration-shard-1/results.json';
  const originalReport = read(reportFile);
  write(reportFile, JSON.stringify({ ...originalReport, testResults: [] }));
  assert.equal(run('verify-integration-shards.mjs').status, 1);
  write(reportFile, JSON.stringify(originalReport));
  const last = 'test-results/integration-shards/server-integration-shard-3/evidence.json';
  const original = read(last);
  write(last, JSON.stringify({ ...original, revision: 'stale' }));
  assert.equal(run('verify-integration-shards.mjs').status, 1);
  write(last, JSON.stringify({ ...original, source: { ...original.source, after: { ...original.source.after, changes: [{ file: 'changed.ts' }] } } }));
  assert.equal(run('verify-integration-shards.mjs').status, 1);
  write(last, JSON.stringify(original));
  assert.equal(run('verify-integration-shards.mjs').status, 0);
  rmSync(path.join(root, 'test-results/integration-shards/server-integration-shard-3'), { recursive: true });
  assert.equal(run('verify-integration-shards.mjs').status, 1);
  // A valid, passing floor-only report cannot conceal an affected suite.
  const base = git('rev-parse', 'HEAD').trim();
  write('server/src/amount.ts', 'export const amount = () => 6;\n');
  git('add', '.'); git('commit', '-qm', 'change runtime dependency');
  const head = git('rev-parse', 'HEAD').trim();
  rmSync(path.join(root, 'test-results/integration-shards'), { recursive: true });
  const archive = () => {
    rmSync(path.join(root, 'test-results/integration-shards'), { recursive: true, force: true });
    cpSync(path.join(root, 'test-results/integration'), path.join(root, 'test-results/integration-shards/server-integration-shard-1'), { recursive: true });
  };
  const floorOnly = run('run-tier1-integration.mjs', 1, 'selected', 1, head);
  assert.equal(floorOnly.status, 0, floorOnly.stdout + floorOnly.stderr);
  archive();
  assert.equal(run('verify-integration-shards.mjs', 1, 'selected', 1, head).status, 0);
  const omitted = run('verify-integration-shards.mjs', 1, 'selected', 1, base);
  assert.equal(omitted.status, 1);
  assert.match(omitted.stderr, /Missing mandatory integration file: server\/src\/test\/integration\/extra.test.ts/);
  assert.equal(run('verify-integration-shards.mjs', 1, 'selected', 1, 'missing-base').status, 1);
  const affected = run('run-tier1-integration.mjs', 1, 'selected', 1, base);
  assert.equal(affected.status, 0, affected.stdout + affected.stderr);
  archive();
  const verifiedAffected = run('verify-integration-shards.mjs', 1, 'selected', 1, base);
  assert.equal(verifiedAffected.status, 0, verifiedAffected.stdout + verifiedAffected.stderr);
  assert.equal(read('test-results/integration-aggregate/aggregate.json').counts.passed, 2);
  unlinkSync(path.join(root, 'server/node_modules'));
  const unavailableGraph = run('verify-integration-shards.mjs', 1, 'selected', 1, base);
  assert.equal(unavailableGraph.status, 1);
  assert.match(unavailableGraph.stderr, /Independent affected collection unavailable/);
  assert.match(unavailableGraph.stderr, /Missing mandatory integration file/);
});
