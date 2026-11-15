import assert from 'node:assert/strict';
import test from 'node:test';

import { classifySmokeFailure, environmentMessages } from '../lib/smoke-failure.mjs';

const pdftotextLog = `
 ❯ src/test/integration/invoiceTicketImmutable.integration.test.ts (23 tests | 1 failed)
 FAIL  src/test/integration/invoiceTicketImmutable.integration.test.ts > renders pdf
Error: spawnSync pdftotext ENOENT
 ❯ Object.<anonymous> src/test/integration/invoiceTicketImmutable.integration.test.ts:111:17
 Tests  1 failed | 22 passed (23)
`;

test('pdftotext ENOENT is an environment failure naming the tool', () => {
  const r = classifySmokeFailure(pdftotextLog);
  assert.deepEqual(r, { kind: 'environment', tools: ['pdftotext'] });
  const msgs = environmentMessages(r.tools);
  assert.deepEqual(msgs, ['upgrade-order could not run: pdftotext missing on the runner']);
  assert.ok(!msgs.join('\n').includes('would break'));
});

test('async spawn ENOENT, ANSI colour and shell not-found are recognised; tools de-duplicated', () => {
  const r = classifySmokeFailure('\u001b[31mError: spawn convert ENOENT\u001b[39m\nError: spawn convert ENOENT\nsh: 1: gs: not found\nbash: qpdf: command not found');
  assert.deepEqual(r, { kind: 'environment', tools: ['convert', 'gs', 'qpdf'] });
});

test('an ordinary assertion failure is incompatible', () => {
  const log = `
 FAIL  src/test/integration/foo.integration.test.ts > inserts a row
AssertionError: expected 1 to be 2
error: null value in column "x" of relation "tickets" violates not-null constraint
 Tests  1 failed | 22 passed (23)
`;
  assert.deepEqual(classifySmokeFailure(log), { kind: 'incompatible' });
  assert.deepEqual(classifySmokeFailure(''), { kind: 'incompatible' });
});
