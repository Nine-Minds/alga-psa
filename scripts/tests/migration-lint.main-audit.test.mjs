// A2: the newest 30 migrations on main lint clean, and every exception is an
// in-file annotation (a new violation fails, a stale annotation fails).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

import { run } from '../ci/migration-lint.mjs';
import { lintMigrationSet } from '../lib/migration-lint.mjs';

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

test('quote approval migrations pass safety and filename validation at CI handoff', async (t) => {
  const dir = new URL('../../server/migrations/', import.meta.url);
  const files = fs.readdirSync(dir)
    .filter((name) => /_create_quote_(access_links|decisions)\.cjs$/.test(name))
    .map((name) => ({ name, source: fs.readFileSync(new URL(name, dir), 'utf8') }));
  assert.equal(files.length, 2);

  // Freeze the baseline that exposed the stale access-link migration. Using
  // today's newest migration would eventually reject already-shipped files.
  const existingTables = new Set(['tenants', 'quotes', 'users', 'contacts']);
  const report = lintMigrationSet(files, {
    baseMaxTimestamp: '20261107120100',
    isExistingTable: (name) => existingTables.has(name),
    isExistingFunction: () => false,
  });
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.undecided, []);
  assert.deepEqual(report.stale, []);

  // The safety linter permits future timestamps; ESLint rejects them. Freeze
  // the failing run's clock so this regression cannot disappear with time.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-08T16:46:00Z') });
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
  const results = await eslint.lintFiles(files.map(({ name }) => fileURLToPath(new URL(name, dir))));
  assert.deepEqual(results.flatMap((result) => result.messages.filter((message) => message.severity === 2)), []);
});
