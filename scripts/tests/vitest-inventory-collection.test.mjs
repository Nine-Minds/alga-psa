import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectVitestInventory } from '../lib/vitest-inventory-collection.mjs';
import { readRunnerCollection } from '../lib/read-runner-collection.mjs';
import { isAdditionalWorkspaceTest, reconcileDiscovery } from '../lib/test-discovery.mjs';

test('renewed email and invoice reviews collect real cases after the previous deadline', t => {
  // The workspace DB job passed all test bodies, then failed manual collection
  // when these reviews reached their deadline at midnight UTC on November 8.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-08T01:54:56Z') });
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = mkdtempSync(path.join(tmpdir(), 'renewed-manual-inventory-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const runners = JSON.parse(readFileSync(path.join(root, 'scripts/manual-vitest-runners.json'), 'utf8'));

  for (const name of ['legacy-email-review', 'invoice-visual-review']) {
    const runner = runners.find(entry => entry.runner === name);
    assert.ok(runner, `Missing manual runner: ${name}`);
    assert.throws(() => collectVitestInventory({ root, output,
      runner: { ...runner, expires: '2026-11-08' } }), /unexpired review/);

    const collection = collectVitestInventory({ root, runner, output });
    assert.equal(collection.status, 'passed', collection.failures.join('\n'));
    assert.equal(collection.mandatory, false);
    assert.deepEqual([...collection.files].sort(), runner.filters.map(file => `${runner.cwd}/${file}`).sort());
    assert.ok(collection.collectedTests >= collection.files.length);
    const discovery = reconcileDiscovery({ root, candidates: collection.files, collections: [collection] });
    assert.equal(discovery.status, 'passed', discovery.failures.join('\n'));
  }
});

for (const name of ['maintenance-fanout-activities', 'tenant-deletion-prepaid-block-order']) {
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
  writeFileSync(path.join(root, 'base.test.js'),
    'test("must only collect", () => { throw new Error("body must not execute") });');
  const valid = collect();
  assert.equal(valid.status, 'passed');
  assert.deepEqual(valid.files, ['base.test.js']);
  assert.equal(valid.collectedTests, 1);
  const artifact = { runner: 'fixture', format: 'vitest', sourceRoot: root,
    collectionFile: 'reports/fixture/collected.json', casesFile: 'reports/fixture/collected-tests.json' };
  assert.deepEqual(readRunnerCollection(artifact, root).files, ['base.test.js']);
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
