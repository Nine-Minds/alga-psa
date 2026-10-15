import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readCandidateExecutionBundle } from '../lib/candidate-execution-artifacts.mjs';
import { evaluateCandidateExecution } from '../lib/candidate-execution-gate.mjs';

test('downloaded Vitest artifacts reconcile across distinct producer and gate checkout roots', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-artifacts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceRoot = '/home/runner/work/project/project', revision = 'a'.repeat(40);
  const file = `${sourceRoot}/server/example.test.ts`;
  const write = (name, data) => writeFileSync(path.join(directory, name), JSON.stringify(data));
  const evidence = { schemaVersion: 1, status: 'passed', source: {
    before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] },
  }, selection: { mode: 'full', filters: [] } };
  write('evidence.json', evidence);
  write('collected.json', [{ file }]);
  write('collected-tests.json', [{ file, name: 'persists' }]);
  write('custom-report.json', { success: true, numTotalTests: 1, testResults: [{ name: file, status: 'passed',
    assertionResults: [{ title: 'persists', status: 'passed' }] }] });
  const descriptor = { id: 'unit', format: 'vitest', directory, sourceRoot, outcome: 'success', files: { report: 'custom-report.json' } };
  const verify = () => evaluateCandidateExecution({ root: '/different/gate/checkout', revision,
    requirements: [{ id: 'unit', format: 'vitest', candidates: ['server/example.test.ts'] }],
    bundles: [readCandidateExecutionBundle(descriptor)] });
  assert.equal(verify().status, 'passed');
  descriptor.outcome = 'cancelled';
  assert.equal(verify().status, 'failed');
  descriptor.outcome = 'success';
  evidence.status = 'failed'; write('evidence.json', evidence);
  assert.equal(verify().status, 'failed');
  evidence.status = 'passed'; write('evidence.json', evidence);
  write('collected-tests.json', [{ file, name: 'never executed' }]);
  assert.equal(verify().status, 'failed');
  rmSync(path.join(directory, 'custom-report.json'));
  assert.throws(() => readCandidateExecutionBundle(descriptor), /ENOENT/);
});

test('artifact reader rejects unknown evidence schemas and missing producer roots', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-invalid-artifacts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => readCandidateExecutionBundle({ id: 'unit', directory }), /producer checkout root/);
  writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({ schemaVersion: 999 }));
  assert.throws(() => readCandidateExecutionBundle({ id: 'unit', directory, sourceRoot: '/repo' }), /Unsupported execution evidence/);
});

test('a filtered or unspecified run cannot become full execution through an empty filter list', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'candidate-selection-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const file of ['collected.json', 'collected-tests.json', 'results.json']) {
    writeFileSync(path.join(directory, file), '[]');
  }
  writeFileSync(path.join(directory, 'events.jsonl'), '');
  for (const format of ['vitest', 'playwright', 'node-events']) {
    for (const mode of ['filtered', 'affected', undefined]) {
      writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({
        schemaVersion: 1, status: 'passed', selection: { mode, filters: [] },
      }));
      assert.throws(() => readCandidateExecutionBundle({ id: 'required', format, directory, sourceRoot: '/repo' }), /full selection/);
    }
  }
});
