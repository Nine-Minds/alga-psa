// A2: the newest 30 migrations on main lint clean, and every exception is an
// in-file annotation (a new violation fails, a stale annotation fails).
import assert from 'node:assert/strict';
import test from 'node:test';

import { run } from '../ci/migration-lint.mjs';

const LAST = 30;

test(`newest ${LAST} migrations: no violations, no undecided findings, no stale annotations`, () => {
  const { exit, report } = run(['--last', String(LAST)]);
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.undecided, []);
  assert.deepEqual(report.stale, []);
  assert.equal(exit, 0);
  assert.equal(report.filesScanned, LAST);
});

test('every honoured annotation carries a reason of at least 12 characters', () => {
  const { report } = run(['--last', String(LAST)]);
  assert.ok(report.allowed.length > 0, 'the audit window is expected to need annotations');
  for (const a of report.allowed) assert.ok(a.reason.replace(/\s/g, '').length >= 12, `${a.file}:${a.line}`);
});
