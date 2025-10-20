/**
 * Playwright tests for Contract Wizard input validation.
 * Salient details:
 * - Test seeds tenants/services directly via Knex helpers (no HTTP mocks) and cleans up afterward.
 * - UI interactions are driven through automation IDs harvested from the reflection system (`__UI_STATE__`).
 * - Fail-fast listeners surface client/network/server errors immediately to tighten feedback.
 * - Tests validate that invalid inputs (e.g., zero values) trigger appropriate validation errors.
 * - RBI Reminder - make sure server is not running independently of playwright test, so that server side is loaded in the same process to allow mocking to work correctly
 */

import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import { applyPlaywrightDatabaseEnv } from './utils/playwrightDatabaseConfig';
import {
  applyPlaywrightAuthEnvDefaults,
  prepareTenantForPlaywright,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
  type TenantPermissionTuple,
} from './helpers/playwrightAuthSessionHelper';
import {
  attachFailFastHandlers,
  seedFixedServiceForTenant,
  cleanupContractArtifacts,
} from './helpers/playwrightContractHelpers';

applyPlaywrightAuthEnvDefaults();
const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

applyPlaywrightDatabaseEnv();

const DEFAULT_ADMIN_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'client', action: 'read' },
  { resource: 'service', action: 'read' },
  { resource: 'billing', action: 'create' },
  { resource: 'billing', action: 'update' },
];

async function prepareWizardTenant(
  db: Knex,
  tenantId: string,
  completedAt: Date,
  permissions: TenantPermissionTuple[] = DEFAULT_ADMIN_PERMISSIONS
): Promise<void> {
  await prepareTenantForPlaywright(db, tenantId, {
    completeOnboarding: { completedAt },
    permissions: permissions.length
      ? [{ roleName: 'Admin', permissions }]
      : undefined,
  });
}

// Invalid numeric inputs coverage: zero values should be rejected or coerced appropriately
test.describe('Contract Wizard Invalid Numeric Inputs', () => {
  async function openWizardOnContracts(page: Page, tenantId: string) {
    const tenantQuery = `?tenantId=${tenantId}`;
    attachFailFastHandlers(page, TEST_CONFIG.baseUrl);

    // Session warmup - navigate to root first to establish session
    await page.goto(`${TEST_CONFIG.baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing${tenantQuery}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Switch to Client Contracts tab
    const clientContractsTab = page.locator('[data-automation-id="tab-client-contracts"]').or(page.getByRole('tab', { name: /Client Contracts/i }));
    await clientContractsTab.waitFor({ timeout: 15_000 });
    await clientContractsTab.click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"]').or(page.getByRole('button', { name: /Create Contract/i }));
    await wizardButtonLocator.click();
    await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ timeout: 10_000 });
  }

  async function selectClientAndName(page: Page, clientName: string, contractName: string) {
    // ClientPicker renders as a Button, not combobox
    const clientButton = page.getByRole('button', { name: /Select a client/i });
    await clientButton.click();
    const clientOption = page.getByText(clientName, { exact: true });
    await clientOption.click();
    await page.locator('[data-automation-id="contract_name"]').fill(contractName);
  }

  async function pickCalendarDate(page: Page, field: 'start-date' | 'end-date', date: Date) {
    const input = page.locator(`[data-automation-id="${field}"]`);
    await input.click();
    const day = String(date.getDate());
    await page.locator('.rdp-day:not(.rdp-day_outside)').filter({ hasText: new RegExp(`^${day}$`) }).first().click();
  }

  test('fixed base rate of 0 shows validation error; quantity 0 coerces to 1', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed ${uuidv4().slice(0, 6)}`;
    const contractName = `Invalid Fixed Zero ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, contractName);
      await pickCalendarDate(page, 'start-date', now);

      // Next to Fixed Fee step
      const nextButton = page.locator('[data-automation-id="wizard-next"]').or(page.getByRole('button', { name: /Next/i }));
      await nextButton.click();
      await expect(page.getByRole('button', { name: 'Add Service' })).toBeVisible();
      await page.getByRole('button', { name: 'Add Service' }).click();

      // Select a fixed service
      const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).first();
      await serviceSelect.click();
      await page.getByRole('option', { name: fixedServiceName }).click();

      // Set quantity to 0; UI coerces to 1
      const qty = page.locator('#quantity-0');
      await qty.fill('0');
      await expect(qty).toHaveValue('1', { timeout: 2000 });

      // Set base rate to 0 and attempt Next -> expect validation error
      const baseRate = page.locator('#fixed_base_rate');
      await baseRate.fill('0');
      await baseRate.blur();
      await nextButton.click();
      await expect(page.getByText(/Base rate is required/i)).toBeVisible();
    } finally {
      if (tenantData) {
        const tenantId = tenantData.tenant.tenantId;
        await cleanupContractArtifacts(db, tenantId);
        await db('service_catalog').where({ tenant: tenantId }).del().catch(() => {});
        await db('service_types').where({ tenant: tenantId }).del().catch(() => {});
        await rollbackTenant(db, tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

});
