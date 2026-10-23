import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectVitestInventory } from '../lib/vitest-inventory-collection.mjs';
import { readRunnerCollection } from '../lib/read-runner-collection.mjs';
import { isAdditionalWorkspaceTest, reconcileDiscovery } from '../lib/test-discovery.mjs';

test('Temporal readiness collects the maintenance fan-out behavioral regression', t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const output = mkdtempSync(path.join(tmpdir(), 'temporal-maintenance-inventory-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const file = 'ee/temporal-workflows/src/activities/__tests__/maintenance-fanout-activities.test.ts';
  const collection = collectVitestInventory({
    root,
    output,
    runner: {
      runner: 'temporal-readiness',
      cwd: 'ee/temporal-workflows',
      cli: 'server/node_modules/vitest/vitest.mjs',
      config: 'vitest.readiness.config.ts',
      filters: ['src/activities/__tests__/maintenance-fanout-activities.test.ts'],
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

test('real Vitest inventory loads cases without executing bodies and rejects empty or broken modules', t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'vitest-inventory-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'vitest.config.mjs'),
    'export default { test: { globals: true, include: ["*.test.js"] } };');
  const runner = { runner: 'fixture', cwd: '.',
    cli: fileURLToPath(new URL('../../server/node_modules/vitest/vitest.mjs', import.meta.url)),
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
