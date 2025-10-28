import { expect, test } from '@playwright/test';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

test.describe('Accounting Settings – Mapping Fallback Harness', () => {
  test('reorders fallback priorities and verifies resolver + validation behaviour', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(`${BASE_URL}/test/accounting/mapping-crud`, {
      waitUntil: 'networkidle',
    });

    // Step 1: open Configure Fallback dialog
    await page.click('#configure-fallback');

    // Step 2: reorder list to Contract Line, Service, Category
    await page.dragAndDrop('#fallback-item-contract_line', '#fallback-item-service');

    // Step 3: enable category fallback and select Managed Services
    const categoryToggle = page.locator('#fallback-toggle-category');
    if (!(await categoryToggle.isChecked())) {
      await categoryToggle.click();
    }
    await page.selectOption('#fallback-category-select', 'Managed Services');

    await page.click('#fallback-save-button');

    // Step 4: run export and confirm contract line mapping used
    await page.click('#run-test-export');
    await expect(page.locator('#export-result-line-contract')).toContainText('contract_line');
    await expect(page.locator('#export-result-line-contract')).toContainText('QBO Contract Support');

    // Step 5: move category fallback to the top and verify category mapping used
    await page.click('#configure-fallback');
    await page.dragAndDrop('#fallback-item-category', '#fallback-item-contract_line');
    await page.click('#fallback-save-button');

    await page.click('#run-test-export');
    await expect(page.locator('#export-result-line-contract')).toContainText('category');
    await expect(page.locator('#export-result-line-contract')).toContainText('QBO Category Managed Services');

    // Step 6: disable category fallback and ensure validation error appears
    await page.click('#configure-fallback');
    const categoryToggleAfter = page.locator('#fallback-toggle-category');
    if (await categoryToggleAfter.isChecked()) {
      await categoryToggleAfter.click();
    }
    await page.click('#fallback-save-button');

    await page.click('#attempt-batch');
    await expect(page.locator('#batch-error')).toBeVisible();
    await expect(page.locator('#batch-error')).toContainText('Category Only Service');
  });
});
