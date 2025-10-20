/**
 * Playwright happy path focused on creating an Hours-based (Hourly) contract line via the wizard.
 * Salient details:
 * - Test seeds tenants/services directly via Knex helpers and cleans up afterward.
 * - UI interactions are driven through automation IDs and semantic locators.
 * - Fail-fast listeners surface client/network/server errors immediately.
 * - Database assertions validate that finishing the wizard persists hourly plan configurations.
 */

import { expect, test } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import {
  applyPlaywrightAuthEnvDefaults,
  prepareTenantForPlaywright,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
  type TenantPermissionTuple,
} from './helpers/playwrightAuthSessionHelper';
import {
  attachFailFastHandlers,
  waitForUIState,
  findComponent,
  seedHourlyServiceForTenant,
  cleanupContractArtifacts,
} from './helpers/playwrightContractHelpers';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const DEFAULT_ADMIN_PERMISSIONS: TenantPermissionTuple[] = [
  { resource: 'client', action: 'read' },
  { resource: 'billing', action: 'create' },
  { resource: 'billing', action: 'update' },
];

// Removed duplicate helper functions - now imported from playwrightContractHelpers

test('Hourly Contract Line Happy Path', async ({ page }) => {
  test.setTimeout(300000);
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;
  const now = new Date();
  const serviceName = `Playwright Hourly Service ${uuidv4().slice(0, 8)}`;
  const contractName = `Playwright Hourly Contract ${uuidv4().slice(0, 8)}`;
  const hourlyRateCents = 15000;
  const minimumBillableTime = 30;
  const roundUpMinutes = 15;

  try {
    // Attach fail-fast error handlers
    attachFailFastHandlers(page, TEST_CONFIG.baseUrl);

    // Create tenant with modern factory pattern
    tenantData = await createTestTenant(db, {
      companyName: `Hourly Contract Client ${uuidv4().slice(0, 6)}`,
    });

    const tenantId = tenantData.tenant.tenantId;

    // Prepare tenant for Playwright (onboarding + permissions)
    await prepareTenantForPlaywright(db, tenantId, {
      completeOnboarding: { completedAt: now },
      permissions: [
        {
          roleName: 'Admin',
          permissions: DEFAULT_ADMIN_PERMISSIONS,
        },
      ],
    });

    // Setup authenticated session
    await setupAuthenticatedSession(page, tenantData, {
      baseUrl: TEST_CONFIG.baseUrl,
    });

    // Warm up on canonical host to ensure cookie domain matches before protected route
    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Seed hourly service for this tenant
    const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(
      db,
      tenantId,
      serviceName,
      now,
      hourlyRateCents
    );

    // Navigate to billing page - under bypass, pass tenantId for server actions
    const tenantQuery = process.env.E2E_AUTH_BYPASS === 'true' && tenantData?.tenant?.tenantId
      ? `?tenantId=${tenantData.tenant.tenantId}`
      : '';
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing${tenantQuery}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Switch to Client Contracts tab
    const clientContractsTab = page.locator('[data-automation-id="tab-client-contracts"], [role="tab"]').filter({ hasText: /Client Contracts/i });
    await clientContractsTab.waitFor({ timeout: 15_000 });
    await clientContractsTab.click();
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    // Open wizard
    const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"]').or(page.getByRole('button', { name: /Create Contract/i }));
    await wizardButtonLocator.click();
    await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ state: 'attached', timeout: 10000 });
    await waitForUIState(page);

    // Select client - ClientPicker renders as a button
    const clientButton = page.getByRole('button', { name: /Select a client/i });
    await clientButton.waitFor({ timeout: 10_000 });
    await clientButton.click();

    // Wait for client options to appear and click the test client
    const clientOption = page.getByText(tenantData.client!.clientName, { exact: true });
    await clientOption.waitFor({ state: 'visible', timeout: 5_000 });
    await clientOption.click();

    // Name + Start Date
    await page.locator('[data-automation-id="contract_name"]').fill(contractName);
    const startDateComponent = await findComponent(page, (c) => c.id === 'start-date');
    await page.locator(`[data-automation-id="${startDateComponent.id}"]`).click();
    await page.getByRole('gridcell', { name: /\d/ }).first().click();

    // Billing Frequency
    try {
      const freqSelect = page.getByRole('combobox', { name: /Select billing frequency/i });
      await freqSelect.click();
      await page.getByRole('option', { name: /Monthly/i }).click();
    } catch {}

    // Next to Fixed Fee, then to Hourly
    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(page.getByRole('heading', { name: 'Fixed Fee Services' }).first()).toBeVisible({ timeout: 3000 });
    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(page.getByRole('heading', { name: 'Hourly Services' }).first()).toBeVisible({ timeout: 3000 });

    // Configure global hourly settings BEFORE adding service
    await page.fill('#minimum-billable-time', String(minimumBillableTime));
    await page.fill('#round-up-to', String(roundUpMinutes));

    // Add Hourly Service and configure
    await page.getByRole('button', { name: /Add Hourly Service/i }).click();
    const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).last();
    await serviceSelect.click();
    await page.getByRole('option', { name: serviceName }).click();
    await page.fill('#hourly-rate-0', (hourlyRateCents / 100).toFixed(2));
    await page.locator('#hourly-rate-0').press('Tab');

    // Proceed through remaining steps
    const remaining: string[] = ['Usage-Based Services', 'Review Contract'];
    for (const heading of remaining) {
      await page.locator('[data-automation-id="wizard-next"]').click();
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 3000 });
    }

    await expect(page.locator(`text=${serviceName}`).first()).toBeVisible({ timeout: 3000 });

    // Finish
    await page.locator('[data-automation-id="wizard-finish"]').click();
    await expect(page.locator('[data-automation-id="wizard-finish"]')).toBeHidden({ timeout: 10000 });

    // Validate DB: Contract was created
    const contract = await db('contracts')
      .where({ tenant: tenantId, contract_name: contractName })
      .first();
    expect(contract).toBeDefined();

    // Find contract line mappings
    const contractLineMappings = await db('contract_line_mappings')
      .where({ tenant: tenantId, contract_id: contract?.contract_id });
    expect(contractLineMappings.length).toBeGreaterThanOrEqual(1);

    // Find the hourly contract line
    const contractLineIds = contractLineMappings.map((m: any) => m.contract_line_id);
    const hourlyLine = await db('contract_lines')
      .whereIn('contract_line_id', contractLineIds)
      .andWhere({ tenant: tenantId, contract_line_type: 'Hourly' })
      .first();
    expect(hourlyLine).toBeDefined();

    const hourlyLineId = hourlyLine?.contract_line_id;

    // Validate hourly service was linked
    const lineService = await db('contract_line_services')
      .where({ tenant: tenantId, contract_line_id: hourlyLineId, service_id: hourlyServiceId })
      .first();
    expect(lineService).toBeDefined();

    // Validate hourly configuration
    const hourlyConfigRow = await db('contract_line_service_configuration')
      .where({ tenant: tenantId, contract_line_id: hourlyLineId, service_id: hourlyServiceId })
      .andWhere({ configuration_type: 'Hourly' })
      .first();
    expect(hourlyConfigRow).toBeDefined();

    // Validate hourly config details
    const hourlyConfigDetails = await db('contract_line_service_hourly_configs')
      .where({ tenant: tenantId, config_id: hourlyConfigRow?.config_id })
      .first();
    expect(hourlyConfigDetails).toBeDefined();
    expect(Number(hourlyConfigDetails?.hourly_rate)).toBe(hourlyRateCents);
    expect(hourlyConfigDetails?.minimum_billable_time).toBe(minimumBillableTime);
    expect(hourlyConfigDetails?.round_up_to_nearest).toBe(roundUpMinutes);
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
