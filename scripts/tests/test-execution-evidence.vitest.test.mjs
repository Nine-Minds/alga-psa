import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileExecution } from '../lib/test-execution-evidence.mjs';

test('real Vitest omitted TODO/skip registrations remain failures without claiming unexpected execution', async t => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'vitest-todo-evidence-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'vitest.config.mjs'), 'export default { test: { globals: true, include: ["*.test.js"], maxWorkers: 1, fileParallelism: false } };');
  writeFileSync(path.join(directory, 'cases.test.js'), 'test("executed",()=>{}); test.todo("policy undecided"); test.skip("intentionally skipped",()=>{});');
  const cli = fileURLToPath(new URL('../../server/node_modules/vitest/vitest.mjs', import.meta.url));
  const launch = args => spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', timeout: 30_000 });
  const collection = launch(['list', '--json=collected.json']);
  assert.equal(collection.status, 0, collection.stderr);
  const execution = launch(['run', '--reporter=json', '--outputFile=results.json']);
  assert.equal(execution.status, 0, execution.stderr);
  const collectedTests = JSON.parse(readFileSync(path.join(directory, 'collected.json')));
  const report = JSON.parse(readFileSync(path.join(directory, 'results.json')));
  assert.deepEqual(collectedTests.map(entry => entry.name), ['executed']);
  const reconcile = selected => reconcileExecution({ root: directory, suite: 'fixture', revision: 'fixture', exitCode: execution.status,
    collected: [{ file: path.join(directory, 'cases.test.js') }], collectedTests: selected, report });
  const result = reconcile(collectedTests);
  assert.equal(result.status, 'failed');
  assert.equal(result.counts.passed, 1); assert.equal(result.counts.todo, 1);
  assert.equal(result.counts.skipped + result.counts.pending, 1);
  assert.equal(result.executedTests.length, 3, 'retain every reported identity including non-executed registrations');
  assert.ok(result.failures.some(failure => failure.startsWith('todo:')));
  assert.ok(result.failures.some(failure => /^(skipped|pending):/.test(failure)));
  assert.ok(!result.failures.some(failure => failure.startsWith('Unexpected executed test:')));
  // An actually executed assertion omitted from independent collection is still a mismatch.
  for (const status of ['passed', 'failed']) {
    report.testResults[0].assertionResults.find(assertion => assertion.title === 'executed').status = status;
    const missing = reconcile([{ file: path.join(directory, 'cases.test.js'), name: 'different required case' }]);
    assert.equal(missing.status, 'failed');
    assert.ok(missing.failures.some(failure => failure.startsWith('Unexpected executed test:') && failure.includes('executed')));
  }
});
