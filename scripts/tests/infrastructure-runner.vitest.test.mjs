import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../', import.meta.url));
test('actual infrastructure runner partitions, executes and rejects missing or stale shard evidence', { timeout: 120_000 }, t => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-infrastructure-runner-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  for (const file of ['scripts/run-infrastructure-tests.mjs', 'scripts/verify-infrastructure-shards.mjs',
    'scripts/lib/test-discovery.mjs', 'scripts/lib/test-execution-evidence.mjs', 'scripts/lib/test-revision.mjs', 'scripts/lib/test-sharding.mjs',
    'scripts/lib/infrastructure-selection.mjs']) {
    write(file, readFileSync(path.join(source, file), 'utf8'));
  }
  write('.gitignore', 'node_modules/\ntest-results/\n');
  write('server/vitest.config.mjs', `export default ${JSON.stringify({ test: { globals: true, include: ['src/test/infrastructure/**/*.test.ts'], fileParallelism: false, maxWorkers: 1 } })};`);
  const files = ['billing/invoices/invoiceDueDate.test.ts', 'billing/invoices/manualInvoice.test.ts',
    'billing/invoices/billingInvoiceGeneration_tax.test.ts',
    'billing/tax/taxRoundingBehavior.test.ts', 'billing/credits/creditApplication.test.ts', 'extra.test.ts'];
  for (const file of files) write(`server/src/test/infrastructure/${file}`, "test('observes the result', () => expect(2 + 3).toBe(5));\n");
  symlinkSync(path.join(source, 'server/node_modules'), path.join(root, 'server/node_modules'), 'dir');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'CI fixture');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const run = (script, index = 1, mode = 'full', total = 3, environment = {}) => spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, CI: '1', GITHUB_SHA: git('rev-parse', 'HEAD').trim(), INFRA_JOB_RESULT: 'success', INFRA_MODE: mode, INFRA_SHARD_INDEX: String(index), INFRA_SHARD_TOTAL: String(total), ...environment },
  });
  const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  for (const index of [1, 2, 3]) {
    const result = run('run-infrastructure-tests.mjs', index);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const evidence = read('test-results/infrastructure/evidence.json');
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.workingTreeDirty, false);
    assert.equal(evidence.expectedFiles.length, 2);
    cpSync(path.join(root, 'test-results/infrastructure'), path.join(root, `test-results/infrastructure-shards/shard-${index}`), { recursive: true });
  }
  let combined = run('verify-infrastructure-shards.mjs');
  assert.equal(combined.status, 0, combined.stdout + combined.stderr);
  assert.equal(read('test-results/infrastructure/aggregate.json').counts.passed, 6);
  assert.equal(read('test-results/infrastructure/results.json').executionCompleteness, 'complete');

  const rawFiles = ['collected', 'collected-tests', 'results'];
  const originals = rawFiles.map(file => read(`test-results/infrastructure-shards/shard-1/${file}.json`));
  // A passing report for shard 2 must not substantiate shard 1's manifest.
  for (const file of rawFiles) {
    cpSync(path.join(root, `test-results/infrastructure-shards/shard-2/${file}.json`),
      path.join(root, `test-results/infrastructure-shards/shard-1/${file}.json`));
  }
  assert.equal(run('verify-infrastructure-shards.mjs').status, 1);
  assert.equal(read('test-results/infrastructure/results.json').executionCompleteness, 'incomplete');
  rawFiles.forEach((file, index) => write(`test-results/infrastructure-shards/shard-1/${file}.json`, JSON.stringify(originals[index])));
  assert.equal(run('verify-infrastructure-shards.mjs').status, 0);

  const last = 'test-results/infrastructure-shards/shard-3/evidence.json';
  const original = read(last);
  write(last, JSON.stringify({ ...original, revision: 'different-revision' }));
  combined = run('verify-infrastructure-shards.mjs');
  assert.equal(combined.status, 1);
  assert.equal(read('test-results/infrastructure/results.json').executionCompleteness, 'incomplete');
  write(last, JSON.stringify(original));
  rmSync(path.join(root, 'test-results/infrastructure-shards/shard-3'), { recursive: true });
  assert.equal(run('verify-infrastructure-shards.mjs').status, 1);
  assert.equal(read('test-results/infrastructure/results.json').executionCompleteness, 'incomplete');

  const tier1 = run('run-infrastructure-tests.mjs', 1, 'tier1', 1);
  assert.equal(tier1.status, 0, tier1.stdout + tier1.stderr);
  assert.equal(read('test-results/infrastructure/evidence.json').counts.passed, 5);
  assert.ok(read('test-results/infrastructure/evidence.json').expectedFiles.includes(
    'server/src/test/infrastructure/billing/invoices/billingInvoiceGeneration_tax.test.ts'));
  // These are genuine passing reports for every Tier-1 file. Relabelling the
  // set as "full" must not let its own manifest hide the extra repository test.
  rmSync(path.join(root, 'test-results/infrastructure-shards'), { recursive: true, force: true });
  const reducedDirectory = 'test-results/infrastructure-shards/shard-1';
  cpSync(path.join(root, 'test-results/infrastructure'), path.join(root, reducedDirectory), { recursive: true });
  const reducedEvidence = read(`${reducedDirectory}/evidence.json`);
  write(`${reducedDirectory}/evidence.json`, JSON.stringify({ ...reducedEvidence,
    selection: { ...reducedEvidence.selection, mode: 'full' } }));
  assert.equal(run('verify-infrastructure-shards.mjs', 1, 'full', 1).status, 1);
  assert.equal(read('test-results/infrastructure/results.json').executionCompleteness, 'incomplete');
  write(`${reducedDirectory}/evidence.json`, JSON.stringify(reducedEvidence));
  assert.equal(run('verify-infrastructure-shards.mjs', 1, 'tier1', 1).status, 0);

  for (const mutation of [
    { ...reducedEvidence, workingTreeDirty: true },
    { ...reducedEvidence, source: { ...reducedEvidence.source, before: { ...reducedEvidence.source.before, dirty: true } } },
    { ...reducedEvidence, source: { ...reducedEvidence.source, after: { ...reducedEvidence.source.after, changes: [{ file: 'runtime.ts' }] } } },
  ]) {
    write(`${reducedDirectory}/evidence.json`, JSON.stringify(mutation));
    assert.equal(run('verify-infrastructure-shards.mjs', 1, 'tier1', 1).status, 1);
    assert.equal(read('test-results/infrastructure/results.json').executionCompleteness, 'incomplete');
  }
  write(`${reducedDirectory}/evidence.json`, JSON.stringify(reducedEvidence));
  for (const environment of [{ GITHUB_SHA: 'f'.repeat(40) }, { GITHUB_SHA: '' }, { INFRA_MODE: 'unknown' }, { INFRA_JOB_RESULT: 'failure' }]) {
    assert.equal(run('verify-infrastructure-shards.mjs', 1, 'tier1', 1, environment).status, 1);
  }
  write('changed-runtime.ts', 'export const changed = true;\n');
  assert.equal(run('verify-infrastructure-shards.mjs', 1, 'tier1', 1).status, 1);
  assert.equal(read('test-results/infrastructure/results.json').executionCompleteness, 'incomplete');
  rmSync(path.join(root, 'changed-runtime.ts'));
  assert.equal(run('verify-infrastructure-shards.mjs', 1, 'tier1', 1).status, 0);
  write('server/src/test/infrastructure/omitted.spec.ts', "test('new test', () => expect(true).toBe(true));\n");
  assert.equal(run('run-infrastructure-tests.mjs', 1, 'tier1', 1).status, 1);
  assert.deepEqual(read('test-results/infrastructure/discovery.json').unmatched, ['server/src/test/infrastructure/omitted.spec.ts']);
});
