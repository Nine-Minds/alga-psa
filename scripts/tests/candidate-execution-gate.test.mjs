import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidateExecution } from '../lib/candidate-execution-gate.mjs';

function fixture() {
  const root = '/repo', revision = 'a'.repeat(40);
  const source = { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } };
  const browser = () => ({ config: { rootDir: root }, errors: [], stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ file: 'browser.spec.ts', title: 'persists invoice', tests: [{ projectId: 'ce', projectName: 'ce',
      expectedStatus: 'passed', status: 'expected', results: [{ retry: 0, status: 'passed' }] }] }] }] });
  return { root, revision, requirements: [
    { id: 'unit', format: 'vitest', candidates: ['unit.test.ts'] },
    { id: 'browser-ce', format: 'playwright', candidates: ['browser.spec.ts'] },
  ], bundles: [
    { id: 'unit', source: structuredClone(source), filters: [], outcome: 'success',
      collected: ['unit.test.ts'], collectedTests: [{ file: 'unit.test.ts', name: 'persists result' }],
      report: { success: true, numTotalTests: 1, testResults: [{ name: 'unit.test.ts', status: 'passed', assertionResults: [{ title: 'persists result', status: 'passed' }] }] } },
    { id: 'browser-ce', source: structuredClone(source), filters: [], outcome: 'success', collected: browser(), report: browser() },
  ] };
}

test('candidate gate reconciles raw unit and browser outcomes together', () => {
  const result = evaluateCandidateExecution(fixture());
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  assert.equal(result.results.length, 2);
});

test('success claims cannot hide missing, cancelled, skipped, stale or filtered required work', () => {
  for (const mutate of [
    x => x.bundles.pop(),
    x => { x.bundles[0].outcome = 'cancelled'; },
    x => { x.bundles[1].outcome = 'skipped'; },
    x => { x.bundles[0].source.before.revision = 'b'.repeat(40); },
    x => { x.bundles[1].source.after.changes = [{ file: 'changed' }]; },
    x => { x.bundles[0].filters = ['one-case']; },
    x => { x.bundles[0].report.testResults[0].assertionResults = []; },
    x => { x.bundles[0].collectedTests = []; },
    x => { x.requirements[0].candidates.push('new.test.ts'); },
    x => { x.bundles[1].report.suites[0].specs[0].tests[0].results[0].retry = 1; },
    x => { x.bundles[1].report.suites = []; },
  ]) {
    const input = fixture(); mutate(input);
    const result = evaluateCandidateExecution(input);
    assert.equal(result.status, 'failed');
    assert.ok(result.failures.length);
  }
});

test('empty requirements, duplicate bundles and unsupported formats cannot satisfy the gate', () => {
  for (const mutate of [
    x => { x.requirements = []; },
    x => { x.bundles.push(structuredClone(x.bundles[0])); },
    x => { x.requirements.push(structuredClone(x.requirements[0])); },
    x => { x.requirements[0].format = 'unverified'; },
    x => { x.requirements[1].candidates = []; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(evaluateCandidateExecution(input).status, 'failed');
  }
});

test('malformed inputs produce a failed decision instead of bypassing verification', () => {
  for (const values of [ { requirements: {} }, { bundles: {} }, { requirements: [null] }, { revision: '' } ]) {
    assert.equal(evaluateCandidateExecution({ ...fixture(), ...values }).status, 'failed');
  }
});

test('candidate gate checks actual Node registrations and terminal events', async t => {
  const { mkdtempSync, writeFileSync, rmSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'candidate-node-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'behavior.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('arithmetic', () => assert.equal(2 + 2, 4));");
  const reporter = fileURLToPath(new URL('../lib/node-test-reporter.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, 'behavior.test.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  assert.equal(run.status, 0, run.stderr);
  const input = fixture();
  input.root = root;
  input.requirements = [{ id: 'node', format: 'node-events', candidates: ['behavior.test.mjs'] }];
  input.bundles = [{ id: 'node', source: input.bundles[0].source, filters: [], outcome: 'success',
    events: run.stdout.trim().split('\n').map(line => JSON.parse(line)) }];
  const result = evaluateCandidateExecution(input);
  assert.equal(result.status, 'passed', result.failures.join('\n'));
  input.bundles[0].events = input.bundles[0].events.filter(event => event.type !== 'test:pass');
  assert.equal(evaluateCandidateExecution(input).status, 'failed');
});
