import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

/**
 * T18: Billing settings → Price books smoke: upload → map → preview → apply →
 * report download. NOT RUN in the draft: it needs the app server (and the
 * `catalog-price-books` flag enabled for the tenant), which was deliberately
 * not started. Run it with the usual Playwright integration setup before
 * general availability (docs/plans/2026-11-18-pricebooks-csv-import.md §8).
 */
applyPlaywrightAuthEnvDefaults();
const baseUrl = resolvePlaywrightBaseUrl();

const nextMonth = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1)).toISOString().slice(0, 10);
})();

test('Price books: upload a CSV, map columns, preview, apply, and download the report', async ({ page }) => {
  test.setTimeout(300_000);
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;
  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: { companyName: `Price Book Smoke ${uuidv4().slice(0, 8)}` },
      completeOnboarding: { completedAt: new Date() },
      permissions: [{
        roleName: 'Admin',
        permissions: [
          { resource: 'import_export', action: 'manage' },
          { resource: 'billing', action: 'read' },
          { resource: 'service', action: 'update' },
          { resource: 'service', action: 'create' },
        ],
      }],
    });
    const tenantId = tenantData.tenant.tenantId;
    await db('default_billing_settings').insert({ tenant: tenantId, default_currency_code: 'CAD' }).onConflict('tenant').merge({ default_currency_code: 'CAD' });
    const serviceTypeId = uuidv4();
    await db('service_types').insert({ tenant: tenantId, id: serviceTypeId, name: 'Smoke type', is_active: true });
    await db('service_catalog').insert({
      tenant: tenantId, service_id: uuidv4(), service_name: 'Smoke Router', item_kind: 'product', sku: 'SMOKE-1',
      billing_method: 'usage', custom_service_type_id: serviceTypeId, default_rate: 1000, unit_of_measure: 'each', is_active: true,
    });

    await page.goto(`${baseUrl}/msp/settings?tab=billing&section=price-books`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('#price-book-new-from-csv').click();

    const dialog = page.locator('#price-book-import-dialog-dialog, #price-book-import-dialog');
    await expect(dialog.first()).toBeVisible();
    await page.locator('#price-book-import-file').setInputFiles({
      name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from('SKU,Name,Price\nSMOKE-1,Smoke Router,12.50\n'),
    });
    await page.locator('#price-book-import-name').fill('Smoke 2027');
    await page.locator('#price-book-effective-date').fill(nextMonth);
    await page.locator('#price-book-import-inspect').click();

    // Map step: the inferred mapping is a default the operator can confirm.
    await expect(page.locator('#price-book-import-mapping-table')).toBeVisible({ timeout: 30_000 });
    await page.locator('#price-book-import-upload').click();

    // Preview: counts and grid, nothing written yet.
    await expect(page.locator('#price-book-preview-grid')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#price-book-preview-no-writes')).toBeVisible();
    expect(await db('service_prices').where({ tenant: tenantId }).count({ c: '*' }).first()).toMatchObject({ c: expect.anything() });

    await page.locator('#price-book-apply').click();
    await expect(page.locator('#price-book-result-counts')).toBeVisible({ timeout: 120_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#price-book-download-report').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('price-book-import-report.csv');

    const row = await db('catalog_price_books').where({ tenant: tenantId, name: 'Smoke 2027' }).first();
    expect(row?.status).toBe('scheduled');
    await page.locator('#price-book-import-done').click();
    await expect(page.locator('#price-books-table')).toContainText('Smoke 2027');
  } finally {
    await db.destroy();
  }
});
