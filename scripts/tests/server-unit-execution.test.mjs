import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyServerUnitExecution, runServerUnitVerification, captureServerUnitSource } from '../verify-server-unit-execution.mjs';

test('unit file artifacts must reconcile completely at the candidate revision', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'unit-evidence-'));
  const directory = path.join(root, 'test-results/server-coverage');
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(root, 'server'));
  const file = path.join(root, 'server/src/test/unit/example.test.ts');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '// fixture identity\n');
  const write = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value));
  write('source-before.json', { revision: 'candidate', dirty: false, changes: [] });
  write('collected.json', [{ file }]);
  write('collected-tests.json', [{ file, name: 'persists data' }]);
  const report = { success: true, numTotalTests: 1, testResults: [{ name: file, status: 'passed',
    assertionResults: [{ fullName: 'persists data', status: 'passed' }] }] };
  const writeReport = value => writeFileSync(path.join(root, 'server/test-results.json'), JSON.stringify(value));
  const verify = patch => verifyServerUnitExecution({ root, revision: 'candidate', candidateRevision: 'candidate', outcome: 'success', ...patch });
  try {
    writeReport(report);
    assert.equal(verify().status, 'passed');
    for (const patch of [{ outcome: 'cancelled' }, { outcome: 'skipped' }, { outcome: undefined },
      { sourceDirty: true }, { candidateRevision: 'different' }, { candidateRevision: undefined }]) {
      assert.equal(verify(patch).status, 'failed');
    }
    for (const source of [null, { revision: 'old', dirty: false, changes: [] }, { revision: 'candidate', dirty: true, changes: [] }]) {
      write('source-before.json', source);
      assert.equal(verify().status, 'failed');
    }
    write('source-before.json', { revision: 'candidate', dirty: false, changes: [] });
    write('collected-tests.json', [{ file, name: 'persists data' }, { file, name: 'missing case' }]);
    assert.equal(verify().status, 'failed');
    write('collected-tests.json', [{ file, name: 'persists data' }]);
    report.testResults[0].assertionResults[0].status = 'pending';
    writeReport(report);
    assert.equal(verify().status, 'failed');
    rmSync(path.join(root, 'server/test-results.json'));
    assert.equal(verify().status, 'failed');
    assert.equal(JSON.parse(readFileSync(path.join(directory, 'evidence.json'), 'utf8')).status, 'failed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unavailable checkout metadata still writes failed execution evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'unit-missing-checkout-'));
  try {
    const result = runServerUnitVerification(root, { GITHUB_SHA: 'candidate', SERVER_UNIT_RUN_OUTCOME: 'success' });
    assert.equal(result.status, 'failed');
    assert.ok(result.failures.some(message => message.includes('Cannot inspect unit checkout')));
    const persisted = JSON.parse(readFileSync(path.join(root, 'test-results/server-coverage/evidence.json'), 'utf8'));
    assert.equal(persisted.status, 'failed');
    assert.deepEqual(persisted.failures, result.failures);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unit source capture records the real checkout and rejects dirty starts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'unit-source-capture-'));
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '-q']);
    writeFileSync(path.join(root, '.gitignore'), 'test-results/\n');
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--no-gpg-sign', '-qm', 'fixture']);
    const clean = captureServerUnitSource(root);
    assert.equal(clean.revision, git(['rev-parse', 'HEAD']));
    assert.equal(clean.dirty, false);
    writeFileSync(path.join(root, 'changed.txt'), 'changed');
    assert.throws(() => captureServerUnitSource(root), /dirty before collection/);
    const persisted = JSON.parse(readFileSync(path.join(root, 'test-results/server-coverage/source-before.json'), 'utf8'));
    assert.equal(persisted.dirty, true);
    assert.ok(persisted.changes.some(change => change.file === 'changed.txt'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
