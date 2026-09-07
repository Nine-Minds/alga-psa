import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyServerUnitExecution } from '../verify-server-unit-execution.mjs';

test('unit file artifacts must reconcile completely at the candidate revision', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'unit-evidence-'));
  const directory = path.join(root, 'test-results/server-coverage');
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(root, 'server'));
  const file = path.join(root, 'server/src/test/unit/example.test.ts');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '// fixture identity\n');
  const write = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value));
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
