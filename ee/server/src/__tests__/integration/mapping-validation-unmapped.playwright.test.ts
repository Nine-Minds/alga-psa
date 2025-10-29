import { expect, test } from '@playwright/test';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

test.describe('Accounting Exports – ValidationUnmapped Harness', () => {
  test('blocks export when mapping missing then succeeds after mapping is added', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`${BASE_URL}/test/accounting/mapping-crud`, {
      waitUntil: 'networkidle',
    });

    // Start export wizard with no mappings in place.
    await page.click('#open-export-wizard');
    await expect(page.locator('#wizard-filters')).toBeVisible();

    await page.selectOption('#wizard-adapter', 'quickbooks_online');
    await page.fill('#wizard-date-start', '2025-01-01');
    await page.fill('#wizard-date-end', '2025-01-31');
    await page.click('#wizard-preview-button');

    await expect(page.locator('#preview-mapping-status')).toHaveText(/Mapping Required/i);

    await page.click('#wizard-confirm-button');
    await expect(page.locator('#wizard-error-banner')).toContainText('Mapping required');

    // Cancel out of the wizard so we can add mapping.
    await page.click('#wizard-cancel-button');
    await expect(page.locator('#wizard-filters')).toHaveCount(0);

    // Add the service ↔ QBO item mapping.
    await page.click('#add-qbo-item-mapping-button');
    await page.locator('button[aria-label="Select Alga Service..."]').click();
    await page.getByRole('option', { name: 'Managed Services' }).click();
    await page.locator('button[aria-label="Select QuickBooks Item..."]').click();
    await page.getByRole('option', { name: 'Consulting', exact: true }).click();
    await page.click('#qbo-item-mapping-dialog-save-button');
    await page.locator('#qbo-item-mapping-dialog').waitFor({ state: 'hidden' });

    // Re-run the wizard and confirm mapping is now satisfied.
    await page.click('#open-export-wizard');
    await page.selectOption('#wizard-adapter', 'quickbooks_online');
    await page.fill('#wizard-date-start', '2025-01-01');
    await page.fill('#wizard-date-end', '2025-01-31');
    await page.click('#wizard-preview-button');

    await expect(page.locator('#preview-mapping-status')).toHaveText(/Ready/i);

    await page.click('#wizard-confirm-button');
    await expect(page.locator('#wizard-preview')).toHaveCount(0);
    await expect(page.locator('#export-success-banner')).toContainText('Export batch ready');
  });
});
