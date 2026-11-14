import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digestTestFile, findTestFiles, renderDigest } from '../lib/test-digest.mjs';

const VITEST_SOURCE = `/**
 * Invoice timing integration (2026-09-01)
 * Covers due dates across period boundaries.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { generateInvoice } from '@alga-psa/billing/actions';
const helpers = require('./helpers/invoices');

vi.mock('@alga-psa/auth', () => ({ getCurrentUser: vi.fn() }));

const describeDb = await describeWithDb();

describeDb('invoice timing', () => {
  it('T001: generates a draft for the due period', async () => {
    await db('invoices').insert({ tenant });
    const rows = await knex.raw(\`SELECT * FROM invoice_charges WHERE tenant = ? \`, [tenant]);
    await trx.table('service_catalog').where({ tenant });
  });
  it.skip('T002: pending', async () => {});
  test(\`T003: \${label} interpolated title\`, () => {});
});
`;

const PLAYWRIGHT_SOURCE = `import { test as authenticatedTest, expect } from '../fixtures/auth';
const test = authenticatedTest.extend({});
test.describe('portal billing', () => {
  test('portal user downloads the finalized invoice', async ({ page, database }) => {
    await page.goto('/client-portal/billing?tab=invoices');
    await expect.poll(async () => (await database('invoices').where({ tenant })).length).toBe(1);
  });
});
`;

test('vitest digest captures titles, imports, mocks, tables and the header comment', () => {
  const digest = digestTestFile('server/src/test/integration/invoiceTiming.integration.test.ts', VITEST_SOURCE);
  assert.equal(digest.kind, 'vitest');
  assert.match(digest.header, /^Invoice timing integration/);
  assert.deepEqual(digest.suites, ['invoice timing']);
  assert.deepEqual(digest.tests.map(t => t.title), ['T001: generates a draft for the due period', 'T002: pending', 'T003: ${label} interpolated title']);
  assert.equal(digest.tests[0].line, 15);
  assert.ok(digest.imports.includes('server/test-utils/dbConfig'), 'relative imports resolve to repository paths');
  assert.ok(digest.imports.includes('@alga-psa/billing/actions'));
  assert.ok(digest.imports.includes('server/src/test/integration/helpers/invoices'), 'require() counts as an import');
  assert.deepEqual(digest.mocks, ['@alga-psa/auth']);
  assert.deepEqual(digest.tables, ['invoices', 'service_catalog', 'invoice_charges']);
});

test('playwright digest is per-test aware and records routes', () => {
  const digest = digestTestFile('e2e-tests/tests/portal-billing.spec.ts', PLAYWRIGHT_SOURCE);
  assert.equal(digest.kind, 'playwright');
  assert.deepEqual(digest.suites, ['portal billing']);
  assert.deepEqual(digest.tests.map(t => t.title), ['portal user downloads the finalized invoice']);
  assert.deepEqual(digest.routes, ['/client-portal/billing']);
  assert.deepEqual(digest.tables, ['invoices']);
  const rendered = renderDigest(digest, { includeTests: false });
  assert.equal(rendered.tests, undefined);
  assert.equal(rendered.description, undefined, 'empty fields are omitted');
  assert.deepEqual(rendered.routes_visited, ['/client-portal/billing']);
});

test('findTestFiles walks directories without git, skips node_modules and accepts explicit files', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'test-digest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['a/one.test.ts', 'a/nested/two.integration.test.ts', 'a/node_modules/skip.test.ts', 'a/helper.ts', 'b/three.spec.ts']) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), '');
  }
  assert.deepEqual(findTestFiles(root, ['a', 'missing']), ['a/nested/two.integration.test.ts', 'a/one.test.ts']);
  assert.deepEqual(findTestFiles(root, ['b/three.spec.ts'], /\.spec\.ts$/), ['b/three.spec.ts']);
});
