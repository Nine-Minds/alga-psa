import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectVitestInventory, hasCurrentManualRunnerReview } from '../lib/vitest-inventory-collection.mjs';
import { readRunnerCollection } from '../lib/read-runner-collection.mjs';
import { isAdditionalWorkspaceTest, reconcileDiscovery } from '../lib/test-discovery.mjs';

test('manual Vitest runner reviews remain valid through their stated expiry date', t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const runners = JSON.parse(readFileSync(path.join(root, 'scripts/manual-vitest-runners.json'), 'utf8'));
  const today = new Date('2026-11-08T00:00:00Z');
  const manualRunners = runners.filter(runner => runner.mandatory === false);

  assert.ok(manualRunners.length > 0);
  for (const runner of manualRunners) {
    assert.equal(hasCurrentManualRunnerReview(runner, today), true, `${runner.runner} review must be current`);
  }
  assert.equal(hasCurrentManualRunnerReview({ reason: 'reviewed', issue: 'issue', expires: '2026-11-07' }, today), false);
  assert.equal(hasCurrentManualRunnerReview({ reason: 'reviewed', issue: 'issue', expires: '2026-11-08' }, today), true);
  assert.equal(hasCurrentManualRunnerReview({ reason: 'reviewed', issue: 'issue', expires: '2026-11-09' }, today), true);
});

test('renewed email and invoice reviews collect real cases after the previous deadline', t => {
  // The workspace DB job passed all test bodies, then failed manual collection
  // when these reviews reached their deadline at midnight UTC on November 8.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-09T01:54:56Z') });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = mkdtempSync(path.join(tmpdir(), 'renewed-manual-inventory-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const runners = JSON.parse(readFileSync(path.join(root, 'scripts/manual-vitest-runners.json'), 'utf8'));

  for (const name of ['legacy-email-review', 'invoice-visual-review']) {
    const runner = runners.find(entry => entry.runner === name);
    assert.ok(runner, `Missing manual runner: ${name}`);
    assert.throws(() => collectVitestInventory({ root, output,
      runner: { ...runner, expires: '2026-11-08' } }), /unexpired review/);

    const collection = collectVitestInventory({ root, runner, output,
      env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: '0', REQUIRE_DB: '' } });
    assert.equal(collection.status, 'passed', collection.failures.join('\n'));
    assert.equal(collection.mandatory, false);
    assert.deepEqual([...collection.files].sort(), runner.filters.map(file => `${runner.cwd}/${file}`).sort());
    assert.ok(collection.collectedTests >= collection.files.length);
    if (name === 'invoice-visual-review') {
      const cases = JSON.parse(readFileSync(path.join(collection.collectionDirectory, 'collected-tests.json'), 'utf8'));
      assert.ok(cases.every(entry => entry.skipped), 'Unavailable DB must remain visible as skipped cases');
    }
    const discovery = reconcileDiscovery({ root, candidates: collection.files, collections: [collection] });
    assert.equal(discovery.status, 'passed', discovery.failures.join('\n'));
  }
});

for (const name of ['maintenance-fanout-activities', 'tenant-deletion-prepaid-block-order', 'worker-email-resolution']) {
  test(`Temporal readiness collects the ${name} behavioral regression`, t => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const output = mkdtempSync(path.join(tmpdir(), 'temporal-readiness-inventory-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const filter = `src/activities/__tests__/${name}.test.ts`;
    const file = `ee/temporal-workflows/${filter}`;
    const collection = collectVitestInventory({
      root,
      output,
      runner: {
        runner: 'temporal-readiness',
        cwd: 'ee/temporal-workflows',
        cli: 'node_modules/vitest/vitest.mjs',
        config: 'vitest.readiness.config.ts',
        filters: [filter],
        owner: 'Temporal workflows',
        runtime: 'Node with activity doubles',
        env: { TEMPORAL_TEST_SKIP_ENV_BOOTSTRAP: '1' },
      },
    });

    assert.equal(collection.status, 'passed');
    assert.deepEqual(collection.files, [file]);
    assert.ok(collection.collectedTests > 0);
    assert.equal(isAdditionalWorkspaceTest(file, 'temporal-readiness'), true);
    const discovery = reconcileDiscovery({ root, candidates: [file], collections: [collection] });
    assert.equal(discovery.status, 'passed', discovery.failures.join('\n'));
  });
}

test('real Vitest inventory loads cases without executing bodies and rejects empty or broken modules', t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'vitest-inventory-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'vitest.config.mjs'),
    'export default { test: { globals: true, include: ["*.test.js"] } };');
  const runner = { runner: 'fixture', cwd: '.',
    cli: fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url)),
    config: 'vitest.config.mjs', owner: 'Fixture maintainer', runtime: 'Node' };
  const collect = () => collectVitestInventory({ root, runner, output: path.join(root, 'reports') });
  assert.throws(() => collectVitestInventory({ root, output: path.join(root, 'reports'),
    runner: { ...runner, mandatory: false } }), /unexpired review/);
  assert.throws(() => collectVitestInventory({ root, output: path.join(root, 'reports'),
    runner: { ...runner, mandatory: false, reason: 'Manual fixture', issue: 'fixture-1', expires: '2000-01-01' } }), /unexpired review/);
  const reviewedRunner = { ...runner, mandatory: false, reason: 'Manual fixture', issue: 'fixture-1', expires: '2026-11-08' };
  writeFileSync(path.join(root, 'base.test.js'),
    'beforeAll(() => { throw new Error("hook must not execute") }); test("must only collect", () => { throw new Error("body must not execute") });');
  const expiresToday = collectVitestInventory({ root, output: path.join(root, 'reports'),
    runner: reviewedRunner, now: new Date('2026-11-08T00:00:00Z') });
  assert.equal(expiresToday.status, 'passed');
  assert.doesNotThrow(() => collectVitestInventory({ root, output: path.join(root, 'reports'), runner: reviewedRunner,
    now: new Date('2026-11-08T00:00:00Z') }));
  assert.doesNotThrow(() => collectVitestInventory({ root, output: path.join(root, 'reports'),
    runner: { ...reviewedRunner, expires: '2026-11-09' }, now: new Date('2026-11-08T23:59:59Z') }));
  assert.throws(() => collectVitestInventory({ root, output: path.join(root, 'reports'),
    runner: reviewedRunner, now: new Date('2026-11-09T00:00:00Z') }), /unexpired review/);
  // Exercise the production default clock as well as the injected clock above.
  const OriginalDate = globalThis.Date;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : ['2026-11-08T12:00:00Z'])); }
    static now() { return OriginalDate.parse('2026-11-08T12:00:00Z'); }
  };
  try {
    const expiresToday = collectVitestInventory({ root, output: path.join(root, 'reports'),
      runner: { ...runner, mandatory: false, reason: 'Manual fixture', issue: 'fixture-1', expires: '2026-11-08' } });
    assert.equal(expiresToday.status, 'passed');
    assert.throws(() => collectVitestInventory({ root, output: path.join(root, 'reports'),
      runner: { ...runner, mandatory: false, reason: 'Manual fixture', issue: 'fixture-1', expires: '2026-11-07' } }), /unexpired review/);
  } finally {
    globalThis.Date = OriginalDate;
  }
  const valid = collect();
  assert.equal(valid.status, 'passed');
  assert.deepEqual(valid.files, ['base.test.js']);
  assert.equal(valid.collectedTests, 1);
  const artifact = { runner: 'fixture', format: 'vitest', sourceRoot: root,
    collectionFile: 'reports/fixture/collected.json', casesFile: 'reports/fixture/collected-tests.json' };
  assert.deepEqual(readRunnerCollection(artifact, root).files, ['base.test.js']);
  writeFileSync(path.join(root, 'skipped.test.js'),
    'describe.skip("unavailable service", () => { test("registered case", () => { throw new Error("body must not execute") }); });');
  const skipped = collect();
  assert.equal(skipped.status, 'passed', skipped.failures.join('\n'));
  assert.deepEqual([...skipped.files].sort(), ['base.test.js', 'skipped.test.js']);
  assert.equal(skipped.collectedTests, 2);
  assert.deepEqual([...readRunnerCollection(artifact, root).files].sort(), ['base.test.js', 'skipped.test.js']);
  const cases = JSON.parse(readFileSync(path.join(root, artifact.casesFile), 'utf8'));
  assert.equal(cases.find(entry => entry.file.endsWith('/skipped.test.js')).skipped, true);
  assert.equal(cases.find(entry => entry.file.endsWith('/base.test.js')).skipped, false);
  rmSync(path.join(root, 'skipped.test.js'));
  writeFileSync(path.join(root, 'empty.test.js'), 'export const noCases = true;');
  const empty = collect();
  assert.equal(empty.status, 'failed');
  assert.ok(empty.failures.includes('No registered test cases: empty.test.js'));
  assert.throws(() => readRunnerCollection(artifact, root), /No registered test cases: empty.test.js/);
  writeFileSync(path.join(root, artifact.collectionFile), JSON.stringify(['empty.test.js']));
  writeFileSync(path.join(root, artifact.casesFile), JSON.stringify([{ file: 'outside.test.js', name: 'extra' },
    { file: 'empty.test.js', name: 'present' }]));
  assert.throws(() => readRunnerCollection(artifact, root), /Case outside file collection: outside.test.js/);
  writeFileSync(path.join(root, 'empty.test.js'), 'import "./missing.js";');
  assert.throws(collect, /collection exited/);
});
