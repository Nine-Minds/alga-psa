import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  declaredEnvironment, importsReact, isGatedReactTestLane, reconcileReactTestEnvironments,
} from '../lib/react-test-environment.mjs';
import { JSDOM_EXTRA_FILES, NODE_PINNED_FILES, matchesJsdomGlob } from '../lib/jsdom-test-globs.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/react-env/', import.meta.url));
const fixture = (name) => readFileSync(path.join(fixtures, `${name}.fixture`), 'utf8');

// Every case maps a repository path onto one of the fixture sources, so the
// rule is exercised against real file text rather than inline strings.
const reconcile = (cases) => reconcileReactTestEnvironments({
  root: fixtures,
  files: cases.map(([file]) => file),
  read: (file) => fixture(new Map(cases).get(file)),
});

test('a React test outside every jsdom glob and without a docblock fails the gate', () => {
  const result = reconcile([['packages/tickets/src/lib/ticketPanel.test.ts', 'renders-with-react']]);
  assert.equal(result.status, 'failed');
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /React test runs under node: packages\/tickets\/src\/lib\/ticketPanel\.test\.ts/);
  assert.match(result.failures[0], /JSDOM_EXTRA_FILES/);
  assert.deepEqual(result.tests, [{ file: 'packages/tickets/src/lib/ticketPanel.test.ts', environment: null, covered: false }]);
});

test('the jsdom globs and an explicit docblock both satisfy the gate', () => {
  const result = reconcile([
    // .tsx is claimed by the first glob.
    ['packages/tickets/src/lib/ticketPanel.test.tsx', 'renders-with-react'],
    // A non-JSX suite beside its components is claimed by the second glob.
    ['packages/ui/src/components/treeSelect.test.ts', 'uses-next-navigation'],
    // Anything else needs to say so itself.
    ['packages/scheduling/tests/timeSheetTable.feedback.test.ts', 'renders-with-react-docblock'],
    // Colocated server suites are in scope too.
    ['server/src/components/billing/invoiceCard.test.tsx', 'renders-with-react'],
  ]);
  assert.deepEqual(result.failures, []);
  assert.equal(result.status, 'passed');
  assert.equal(result.tests.length, 4);
  assert.deepEqual(result.tests.map(({ covered }) => covered), [true, true, false, true]);
  assert.equal(result.tests[2].environment, 'jsdom');
});

test('non-React suites and out-of-lane suites are not gated', () => {
  const result = reconcile([
    // Imports only a React type, so it needs no browser environment.
    ['packages/billing/src/lib/formatInvoiceTotal.test.ts', 'no-react'],
    // Temporal, e2e, appliance and DB lanes keep their own environments.
    ['ee/temporal-workflows/src/activities/__tests__/render.test.ts', 'renders-with-react'],
    ['server/src/test/e2e/api/tickets.e2e.test.ts', 'renders-with-react'],
    ['packages/tickets/src/lib/ticketPanel.db.test.ts', 'renders-with-react'],
  ]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.tests, []);
});

test('the lane predicate covers the server unit selection and the colocated lane', () => {
  for (const file of [
    'server/src/test/unit/app/msp/tickets/page.test.tsx',
    'packages/ui/src/components/GoogleIcon.test.tsx',
    'shared/workflow/actions/__tests__/notify.test.ts',
    'ee/packages/workflows/src/actions/__tests__/emit.test.ts',
    'server/src/components/settings/general/UserManagement.test.tsx',
    'server/src/test/setupHelpers.test.ts',
  ]) assert.equal(isGatedReactTestLane(file), true, file);

  for (const file of [
    'server/src/test/unit/app/msp/tickets/page.db.test.tsx',
    'server/src/test/integration/tickets.test.ts',
    'ee/server/src/__tests__/unit/licensing.test.ts',
    'services/email-service/src/inbound.test.ts',
    'packages/ui/node_modules/react/index.test.js',
    'packages/ui/src/components/GoogleIcon.tsx',
  ]) assert.equal(isGatedReactTestLane(file), false, file);
});

test('the React import rule reads value imports only', () => {
  for (const source of [
    "import React from 'react';",
    "import { render } from '@testing-library/react';",
    "import 'react-dom/client';",
    "const { useRouter } = require('next/navigation');",
    "const nav = await import('next/navigation');",
    "import ReactDOM from 'react-dom/server';",
  ]) assert.equal(importsReact(source), true, source);

  for (const source of [
    "import type { ReactNode } from 'react';",
    "// react is not imported here\nimport { it } from 'vitest';",
    "import { reactive } from 'reactive-store';",
    "import { buildReactionSummary } from './reactions';",
  ]) assert.equal(importsReact(source), false, source);
});

test('only the docblock at the head of the file declares an environment', () => {
  assert.equal(declaredEnvironment('/** @vitest-environment jsdom */\nimport x from "y";'), 'jsdom');
  assert.equal(declaredEnvironment('/** @vitest-environment node */'), 'node');
  assert.equal(declaredEnvironment(`${'x'.repeat(2100)}\n// @vitest-environment jsdom`), null);
  assert.equal(declaredEnvironment('import x from "y";'), null);
});

test('the shared rule claims the glob members, the named extras and nothing pinned', () => {
  assert.equal(matchesJsdomGlob('packages/tickets/src/components/Dashboard.test.tsx'), true);
  assert.equal(matchesJsdomGlob('packages/ui/src/components/panels/vitals.spec.mts'), true);
  assert.equal(matchesJsdomGlob('server/src/test/unit/billing/usage.test.ts'), false);
  for (const file of JSDOM_EXTRA_FILES) assert.equal(matchesJsdomGlob(file), true, file);
  for (const file of NODE_PINNED_FILES) assert.equal(matchesJsdomGlob(file), false, file);
});
