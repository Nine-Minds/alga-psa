import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileExecution } from '../lib/test-execution-evidence.mjs';

const root = '/repo';
function evidence(change = {}) {
  return reconcileExecution({
    root, suite: 'db', revision: 'fixture', exitCode: 0,
    collected: [{ file: '/repo/tests/a.test.ts' }],
    report: { success: true, numTotalTests: 1, testResults: [{ name: '/repo/tests/a.test.ts', status: 'passed', assertionResults: [{ fullName: 'persists', status: 'passed' }] }] },
    ...change,
  });
}
test('complete executed collection passes with normalized identities', () => {
  const result = evidence();
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.expectedFiles, ['tests/a.test.ts']);
  assert.equal(result.counts.passed, 1);
});
test('missing, empty, cancelled and unsuccessful runs cannot be green', () => {
  for (const change of [
    { collected: [] }, { report: null }, { exitCode: null }, { exitCode: 1 },
    { collected: [{ file: '/repo/tests/moved.test.ts' }] },
    { report: { success: true, numTotalTests: 0, testResults: [] } },
  ]) assert.equal(evidence(change).status, 'failed');
});
test('skipped and todo assertions are counted separately but cannot satisfy required execution', () => {
  const report = { success: true, numTotalTests: 3, testResults: [{ name: '/repo/tests/a.test.ts', status: 'passed', assertionResults: [
    { status: 'passed' }, { status: 'skipped' }, { status: 'todo' },
  ] }] };
  assert.equal(evidence({ report }).status, 'failed');
  assert.deepEqual(evidence({ report }).counts, { passed: 1, failed: 0, skipped: 1, todo: 1, pending: 0 });
  report.testResults[0].assertionResults[1].status = 'pending';
  assert.equal(evidence({ report }).status, 'failed');
  report.testResults[0].assertionResults = [{ status: 'skipped' }];
  report.numTotalTests = 1;
  assert.equal(evidence({ report }).status, 'failed');
});
test('collection errors and inconsistent reports are rejected even with successful exit status', () => {
  for (const override of [{ success: false }, { numTotalTests: 2 }, { numRuntimeErrorTestSuites: 1 }]) {
    const report = { success: true, numTotalTests: 1, testResults: [{ name: '/repo/tests/a.test.ts', status: 'passed', assertionResults: [{ status: 'passed' }] }], ...override };
    assert.equal(evidence({ report }).status, 'failed');
  }
});

test('test identities detect a missing or renamed case inside an otherwise passing file', () => {
  const collectedTests = [{ file: '/repo/tests/a.test.ts', name: 'persists' }];
  assert.equal(evidence({ collectedTests }).status, 'passed');
  assert.equal(evidence({ collectedTests: [...collectedTests, { file: '/repo/tests/a.test.ts', name: 'rejects other tenant' }] }).status, 'failed');
  assert.equal(evidence({ collectedTests: [{ file: '/repo/tests/a.test.ts', name: 'renamed' }] }).status, 'failed');
  assert.equal(evidence({ collectedTests: [] }).status, 'failed');
});

test('nested titles and duplicate parameterized names retain their collected cardinality', () => {
  const assertion = { ancestorTitles: ['billing', 'tenant'], title: 'persists', status: 'passed' };
  const entry = { file: '/repo/tests/a.test.ts', name: 'billing > tenant > persists' };
  const report = { success: true, numTotalTests: 2, testResults: [{ name: entry.file, status: 'passed', assertionResults: [assertion, assertion] }] };
  assert.equal(evidence({ collectedTests: [entry, entry], report }).status, 'passed');
  assert.equal(evidence({ collectedTests: [entry], report }).status, 'failed');
});

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
