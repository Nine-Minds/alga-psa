/**
 * Simplified UI test for the Contract Wizard using Playwright.
 * Creates a real tenant with controlled test data and focuses on UI interactions via the reflection system.
 */

import { expect, Page, test } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';

const TEST_CONFIG = {
  baseUrl: process.env.EE_BASE_URL || 'http://localhost:3000',
};

async function waitForUIState(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__UI_STATE__), null, {
    timeout: 10_000,
  });
}

test.describe('Contract Wizard UI (Simplified)', () => {
  test('should complete wizard flow with controlled tenant data', async ({ page }) => {
    test.setTimeout(120000);

    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      // Create test tenant with controlled data
      tenantData = await createTestTenant(db, {
        companyName: `UI Test Company ${uuidv4().slice(0, 6)}`,
      });

      // Login with test user
      await page.goto('/');
      await page.waitForSelector('#msp-email-field');
      await page.fill('#msp-email-field', tenantData.adminUser.email);
      await page.fill('#msp-password-field', tenantData.adminUser.temporaryPassword);

      await Promise.all([
        page.waitForURL(/\/msp\/dashboard/, { timeout: 45_000 }),
        page.click('#msp-sign-in-button'),
      ]);

      // Navigate to billing page
      await page.goto('/msp/billing?tab=contracts', { waitUntil: 'domcontentloaded' });

      // Wait for the wizard button to appear and click it
      await page.waitForSelector('[data-automation-id="wizard-contract-button"]', { timeout: 15_000 });
      await page.click('[data-automation-id="wizard-contract-button"]');

      // Wait for dialog to open
      await expect(
        page.getByRole('heading', { name: 'Contract Basics' }).first()
      ).toBeVisible({ timeout: 10000 });
      await waitForUIState(page);

      // === STEP 1: Contract Basics ===
      console.log('Step 1: Filling Contract Basics');

      // Wait for company select to load options
      await page.waitForFunction(
        (companyName) => {
          const state = (window as any).__UI_STATE__;
          if (!state) return false;

          const findInTree = (components: any[]): any => {
            for (const comp of components) {
              if (comp.id === 'company-select' && comp.options?.length > 0) {
                return comp.options.some((opt: any) => opt.label === companyName);
              }
              if (comp.children) {
                const found = findInTree(comp.children);
                if (found) return found;
              }
            }
            return false;
          };

          return findInTree(state.components || []);
        },
        tenantData!.client!.clientName,
        { timeout: 10000 }
      );

      // Select company
      await page.locator('[data-automation-id="company-select"]').click();
      await page.getByRole('option', { name: tenantData!.client!.clientName }).click();

      // Fill contract name
      await page.locator('[data-automation-id="contract_name"]').fill('Test Managed Services Contract');

      // Select start date
      await page.locator('[data-automation-id="start-date"]').click();
      await page.getByRole('gridcell', { name: /^1$/ }).first().click();

      // Click Next
      await page.locator('[data-automation-id="wizard-next"]').click();

      // === STEP 2: Fixed Fee Services (Skip for now) ===
      await expect(
        page.getByRole('heading', { name: 'Fixed Fee Services' }).first()
      ).toBeVisible({ timeout: 5000 });
      console.log('Step 2: Skipping Fixed Fee Services');

      await page.locator('[data-automation-id="wizard-next"]').click();

      // === STEP 3: Hourly Services (Skip) ===
      await expect(
        page.getByRole('heading', { name: 'Hourly Services' }).first()
      ).toBeVisible({ timeout: 5000 });
      console.log('Step 3: Skipping Hourly Services');

      await page.locator('[data-automation-id="wizard-next"]').click();

      // === STEP 4: Bucket Hours (Skip) ===
      await expect(
        page.getByRole('heading', { name: 'Bucket Hours' }).first()
      ).toBeVisible({ timeout: 5000 });
      console.log('Step 4: Skipping Bucket Hours');

      await page.locator('[data-automation-id="wizard-next"]').click();

      // === STEP 5: Usage-Based Services (Skip) ===
      await expect(
        page.getByRole('heading', { name: 'Usage-Based Services' }).first()
      ).toBeVisible({ timeout: 5000 });
      console.log('Step 5: Skipping Usage-Based Services');

      await page.locator('[data-automation-id="wizard-next"]').click();

      // === STEP 6: Review & Create ===
      await expect(
        page.getByRole('heading', { name: 'Review & Create' }).first()
      ).toBeVisible({ timeout: 5000 });
      console.log('Step 6: Review & Create');

      // Click Finish
      await page.locator('[data-automation-id="wizard-finish"]').click();

      // Verify dialog closes
      await expect(page.locator('[data-automation-id="wizard-finish"]')).toBeHidden({ timeout: 10_000 });

      console.log('✅ Contract Wizard completed successfully!');
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

  test('should populate __UI_STATE__ with component tree', async ({ page }) => {
    test.setTimeout(60000);

    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      // Create test tenant
      tenantData = await createTestTenant(db, {
        companyName: `UI State Test ${uuidv4().slice(0, 6)}`,
      });

      // Login with test user
      await page.goto('/');
      await page.waitForSelector('#msp-email-field');
      await page.fill('#msp-email-field', tenantData.adminUser.email);
      await page.fill('#msp-password-field', tenantData.adminUser.temporaryPassword);

      await Promise.all([
        page.waitForURL(/\/msp\/dashboard/, { timeout: 45_000 }),
        page.click('#msp-sign-in-button'),
      ]);

      await page.goto('/msp/billing?tab=contracts', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-automation-id="wizard-contract-button"]', { timeout: 15_000 });
      await page.click('[data-automation-id="wizard-contract-button"]');

      await expect(
        page.getByRole('heading', { name: 'Contract Basics' }).first()
      ).toBeVisible({ timeout: 10000 });

      // Check __UI_STATE__ is populated
      const uiState = await page.evaluate(() => (window as any).__UI_STATE__);

      expect(uiState).toBeDefined();
      expect(uiState.components).toBeDefined();
      expect(uiState.components.length).toBeGreaterThan(0);

      // Find the contract basics container
      const findComponent = (components: any[], id: string): any => {
        for (const comp of components) {
          if (comp.id === id) return comp;
          if (comp.children) {
            const found = findComponent(comp.children, id);
            if (found) return found;
          }
        }
        return null;
      };

      const contractBasicsStep = findComponent(uiState.components, 'contract-basics-step');
      expect(contractBasicsStep).toBeDefined();
      expect(contractBasicsStep.type).toBe('container');

      // Verify key fields are registered
      const companySelect = findComponent(uiState.components, 'company-select');
      expect(companySelect).toBeDefined();
      expect(companySelect.type).toBe('formField');
      expect(companySelect.fieldType).toBe('select');

      const contractNameField = findComponent(uiState.components, 'contract_name');
      expect(contractNameField).toBeDefined();
      expect(contractNameField.type).toBe('formField');

      console.log('✅ UI State structure validated!');
      console.log('Components found:', {
        'contract-basics-step': !!contractBasicsStep,
        'company-select': !!companySelect,
        'contract_name': !!contractNameField,
      });
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });
});
