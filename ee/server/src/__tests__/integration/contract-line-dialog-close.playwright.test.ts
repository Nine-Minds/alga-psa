/**
 * Playwright test to expose the bug where ContractLineDialog cannot be closed
 * when opened in edit mode.
 *
 * Bug: The dialog's isOpen prop is set to `open || !!editingPlan`, which means
 * if editingPlan is truthy, the dialog stays open regardless of the internal
 * open state being set to false.
 */

import { test, expect, Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import { establishTenantSession } from './utils/auth-helpers';

// Set required environment variables for Playwright tests
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
process.env.E2E_AUTH_BYPASS = process.env.E2E_AUTH_BYPASS || 'true';

const TEST_CONFIG = {
  baseUrl: process.env.EE_BASE_URL || 'http://localhost:3000',
};

async function openAddContractLineDialog(page: Page) {
  const dialogHeading = page.getByRole('heading', { name: 'Add Contract Line' });
  await page.waitForSelector('[id="add-contract-line-button"]', { timeout: 15_000 });
  await page.locator('[id="add-contract-line-button"]').click();
  await expect(dialogHeading).toBeVisible({ timeout: 10_000 });
  return dialogHeading;
}

async function clickBackdrop(page: Page) {
  const dialog = page.getByRole('dialog');
  const box = await dialog.boundingBox();
  if (!box) {
    throw new Error('Unable to determine dialog position');
  }
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error('Viewport size unavailable');
  }
  let clickX = box.x - 20;
  if (clickX < 0) {
    clickX = Math.min(box.x + box.width + 20, viewport.width - 10);
  }
  let clickY = box.y - 20;
  if (clickY < 0) {
    clickY = Math.min(box.y + box.height + 20, viewport.height - 10);
  }
  await page.mouse.click(clickX, clickY);
}

test.describe('ContractLineDialog Close Bug', () => {
  test.setTimeout(180_000); // Allow time for first-run migrations

  test('should be able to close the dialog when opened for creating a new contract line', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      // Create test tenant
      tenantData = await createTestTenant(db, {
        companyName: `Create Dialog Test ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      // Setup authenticated session
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);

      // Navigate to the billing page with contract-lines tab
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contract-lines&tenantId=${tenantData.tenant.tenantId}`);

      // Open the Add Contract Line dialog
      const dialogHeading = await openAddContractLineDialog(page);

      // Try to close the dialog by clicking the close button (X)
      const closeButton = page.locator('button[aria-label="Close"]').or(page.locator('button:has-text("×")')).first();
      await closeButton.click();

      // This should work for the create dialog
      await expect(dialogHeading).toBeHidden({ timeout: 5000 });

    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

  test('should close an untouched dialog when dismissed with escape key or overlay click', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Close Guard Untouched ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contract-lines&tenantId=${tenantData.tenant.tenantId}`);

      let dialogHeading = await openAddContractLineDialog(page);

      await page.keyboard.press('Escape');
      await expect(dialogHeading).toBeHidden({ timeout: 5000 });

      dialogHeading = await openAddContractLineDialog(page);

      await clickBackdrop(page);
      await expect(dialogHeading).toBeHidden({ timeout: 5000 });
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

  test('should keep an edited dialog open when dismissed without using the cancel action', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Close Guard Edited ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contract-lines&tenantId=${tenantData.tenant.tenantId}`);

      const dialogHeading = await openAddContractLineDialog(page);
      const nameInput = page.locator('#name');

      await nameInput.fill('Unsaved Contract Line');

      await page.keyboard.press('Escape');
      await expect(dialogHeading).toBeVisible({ timeout: 5000 });

      await clickBackdrop(page);
      await expect(dialogHeading).toBeVisible({ timeout: 5000 });
      await expect(nameInput).toHaveValue('Unsaved Contract Line');
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

  test('should close an edited dialog when the cancel button is used', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Close Guard Cancel ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contract-lines&tenantId=${tenantData.tenant.tenantId}`);

      const dialogHeading = await openAddContractLineDialog(page);
      await page.locator('#name').fill('Unsaved Contract Line');

      await page.locator('#contract-line-cancel').click();
      await expect(dialogHeading).toBeHidden({ timeout: 5000 });
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });
});
async function markOnboardingComplete(db: Knex, tenantId: string, now: Date): Promise<void> {
  await db('tenant_settings')
    .insert({
      tenant: tenantId,
      onboarding_completed: true,
      onboarding_completed_at: now,
      onboarding_skipped: false,
      onboarding_data: null,
      settings: {},
      created_at: now,
      updated_at: now,
    })
    .onConflict('tenant')
    .merge({
      onboarding_completed: true,
      onboarding_completed_at: now,
      onboarding_skipped: false,
      updated_at: now,
    });
}
