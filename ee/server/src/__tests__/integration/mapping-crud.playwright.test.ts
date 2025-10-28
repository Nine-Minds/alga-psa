import { expect, test } from '@playwright/test';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

test.describe('Accounting Settings – QuickBooks Mapping CRUD Harness', () => {
  test('creates, edits, and deletes a mapping while reflecting audit trail updates', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`${BASE_URL}/test/accounting/mapping-crud`, {
      waitUntil: 'networkidle',
    });

    await expect(page.locator('#accounting-integration-tabs')).toBeVisible();
    const qboTab = page.getByRole('tab', { name: 'QuickBooks Online' });
    await qboTab.click();
    await expect(qboTab).toHaveAttribute('aria-selected', 'true');

    await page.click('#add-qbo-item-mapping-button');
    const serviceSelect = page.locator('button[aria-label="Select Alga Service..."]');
    await serviceSelect.click();
    await page.getByRole('option', { name: 'Managed Services' }).click();

    const itemSelect = page.locator('button[aria-label="Select QuickBooks Item..."]');
    await itemSelect.click();
    await page.getByRole('option', { name: 'Consulting', exact: true }).click();

    await page.click('#qbo-item-mapping-dialog-save-button');

    const table = page.locator('#qbo-item-mappings-table');
    await expect(table.getByRole('row', { name: /Managed Services/ })).toContainText('Consulting');
    await expect(page.locator('#audit-log')).toContainText('Created mapping mapping-1');

    await page.click('#qbo-item-mapping-actions-menu-mapping-1');
    await page.click('#edit-qbo-item-mapping-menu-item-mapping-1');

    const editItemSelect = page.locator('button[aria-label="Select QuickBooks Item..."]');
    await editItemSelect.click();
    await page.getByRole('option', { name: 'Consulting - Premium', exact: true }).click();
    await page.click('#qbo-item-mapping-dialog-save-button');

    await expect(table.getByRole('row', { name: /Managed Services/ })).toContainText('Consulting - Premium');
    await expect(page.locator('#audit-log')).toContainText('Updated mapping mapping-1');

    await page.click('#qbo-item-mapping-actions-menu-mapping-1');
    await page.click('#delete-qbo-item-mapping-menu-item-mapping-1');
    const confirmButton = page.locator('#confirm-delete-qbo-item-mapping-dialog-mapping-1-confirm');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    await expect(table).toContainText('No item mappings found.');
    await expect(page.locator('#audit-log')).toContainText('Deleted mapping mapping-1');
  });
});
