import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectVitestInventory } from '../lib/vitest-inventory-collection.mjs';

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
  writeFileSync(path.join(root, 'empty.test.js'), 'export const noCases = true;');
  const empty = collect();
  assert.equal(empty.status, 'failed');
  assert.ok(empty.failures.includes('No registered test cases: empty.test.js'));
  writeFileSync(path.join(root, 'empty.test.js'), 'import "./missing.js";');
  assert.throws(collect, /collection exited/);
});
