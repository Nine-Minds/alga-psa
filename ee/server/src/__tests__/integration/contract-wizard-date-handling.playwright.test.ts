/**
 * Playwright tests for Contract Wizard date picker and timezone handling.
 * Salient details:
 * - Tests validate that date selections in the wizard UI correctly persist to the database without timezone shifts.
 * - Exercises regression scenarios where date pickers would shift dates (e.g., selecting 1st of month shows as previous month).
 * - Uses Pacific timezone to surface off-by-one errors that commonly occur with UTC conversions.
 * - Database assertions verify dates are stored as date-only values without time/timezone components.
 * - RBI Reminder - make sure server is not running independently of playwright test, so that server side is loaded in the same process to allow mocking to work correctly
 */

import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
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
  waitForUIState,
  findComponent,
  seedFixedServiceForTenant,
  cleanupContractArtifacts,
} from './helpers/playwrightContractHelpers';

applyPlaywrightAuthEnvDefaults();
const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

applyPlaywrightDatabaseEnv();

async function getContractLineContext(
  db: Knex,
  tenantId: string,
  contractName: string
) {
  const contract = await db('contracts')
    .where({ tenant: tenantId, contract_name: contractName })
    .first();

  if (!contract) {
    return { contract: null, contractLineIds: [], contractLines: [] };
  }

  const mappings = await db('contract_line_mappings')
    .where({ tenant: tenantId, contract_id: contract.contract_id })
    .select('contract_line_id');

  const contractLineIds = mappings.map((m: any) => m.contract_line_id);
  const contractLines = contractLineIds.length
    ? await db('contract_lines')
        .whereIn('contract_line_id', contractLineIds)
        .andWhere({ tenant: tenantId })
    : [];

  return { contract, contractLineIds, contractLines };
}

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

async function completeContractWizardFlow(
  page: Page,
  tenantData: TenantTestData,
  serviceName: string,
  contractName: string,
  options?: {
    baseRate?: number;
    purchaseOrder?: {
      required: boolean;
      number: string;
      amountCents?: number;
    };
    hourlyService?: {
      serviceId: string;
      serviceName: string;
      hourlyRate?: number;
      minimumBillableTime?: number;
      roundUpToNearest?: number;
    };
    fixedBucketOverlay?: {
      hours: number;
      overageRateCents: number;
      allowRollover?: boolean;
      serviceName?: string; // if omitted, will use the fixed service added earlier
    };
    hourlyBucketOverlay?: {
      hours: number;
      overageRateCents: number;
      allowRollover?: boolean;
      serviceName?: string;
    };
    usageBucketOverlay?: {
      units: number;
      unitOfMeasure: string;
      overageRateCents: number;
      allowRollover?: boolean;
      serviceName?: string;
    };
    onReview?: (page: Page) => Promise<void>;
  }
): Promise<void> {
  if (!tenantData.client) {
    throw new Error('Tenant does not include a client, cannot complete wizard flow.');
  }

  try {
    attachFailFastHandlers(page, TEST_CONFIG.baseUrl);

    // First, set up the authenticated session with a properly signed JWT
    await setupAuthenticatedSession(page, tenantData);

    // Warm up on canonical host to ensure cookie domain matches before protected route
    await page.goto(`${TEST_CONFIG.baseUrl}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Assert session is recognized by NextAuth; if not, surface a clear error
    if (process.env.E2E_AUTH_BYPASS !== 'true') {
      try {
        await page.goto(`${TEST_CONFIG.baseUrl}/api/auth/session`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const sessionText = await page.textContent('body');
        if (!sessionText || !/"user"\s*:\s*\{/.test(sessionText)) {
          throw new Error('Session not established — NextAuth session endpoint returned no user');
        }
      } catch (e) {
        throw new Error(`Auth session verification failed: ${(e as Error).message}`);
      }
    }

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

    const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"]');
    await wizardButtonLocator.waitFor({ timeout: 15_000 });
    await findComponent(page, (component) => component.id === 'wizard-contract-button');
    await wizardButtonLocator.click();

    const dialogLocator = page.locator('[data-automation-id="dialog-dialog"]');
    await dialogLocator.waitFor({ state: 'attached', timeout: 10_000 });

    await page
      .locator('[data-automation-id="contract-basics-step"]')
      .waitFor({ state: 'attached', timeout: 10_000 });
    await waitForUIState(page);

    const clientSelect = page.getByRole('combobox', { name: /Select a client|Loading clients/i });
    await clientSelect.waitFor({ timeout: 10_000 });
    await clientSelect.click();
    await page.getByRole('option', { name: tenantData.client.clientName }).click();

    await page.locator('[data-automation-id="contract_name"]').fill(contractName);

    const startDateComponent = await findComponent(
      page,
      (component) => component.id === 'start-date'
    );

    await page.locator(`[data-automation-id="${startDateComponent.id}"]`).click();
    await page.getByRole('gridcell', { name: /\d/ }).first().click();

    // New required field: Billing Frequency
    // Select a default frequency to satisfy validation
    try {
      const freqSelect = page.getByRole('combobox', { name: /Select billing frequency/i });
      await freqSelect.click();
      await page.getByRole('option', { name: /Monthly/i }).click();
    } catch {
      // If not found, proceed; some environments may default this
    }

    const purchaseOrderOptions = options?.purchaseOrder;
    if (purchaseOrderOptions?.required) {
      const poSwitch = page.locator('[data-automation-id="po_required"]');
      await poSwitch.waitFor({ timeout: 5_000 });
      if ((await poSwitch.getAttribute('data-state')) !== 'checked') {
        await poSwitch.click({ force: true });
      }

      const poNumberLocator = page.locator('[data-automation-id="po_number"]');
      await poNumberLocator.waitFor({ timeout: 5_000 });
      await poNumberLocator.fill(purchaseOrderOptions.number);

      if (typeof purchaseOrderOptions.amountCents === 'number') {
        const poAmountLocator = page.locator('[data-automation-id="po_amount"]');
        await poAmountLocator.waitFor({ timeout: 5_000 });
        const dollars = (purchaseOrderOptions.amountCents / 100).toFixed(2);
        await poAmountLocator.fill(dollars);
        await poAmountLocator.blur();
      }
    }

    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(page.getByRole('button', { name: 'Add Service' })).toBeVisible({ timeout: 3000 });

    await page.getByRole('button', { name: 'Add Service' }).click();

    const serviceSelectComponent = await findComponent(
      page,
      (component) => component.id === 'service-select-0'
    );

    const serviceSelectLocator = page.locator(`[data-automation-id="${serviceSelectComponent.id}"]`);
    await serviceSelectLocator.click();
    await expect(page.getByRole('option', { name: serviceName })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('option', { name: serviceName }).click();

    await page.locator('[data-automation-id="quantity-0"]').fill('1');

    const baseRateField = page.locator('[data-automation-id="fixed_base_rate"]');
    const baseRateToUse = options?.baseRate ?? 500;
    await baseRateField.fill(baseRateToUse.toString());
    await baseRateField.blur();

    if (options?.fixedBucketOverlay) {
      const toggle = page.locator('[data-automation-id="Enable bucket of hours"]');
      if ((await toggle.getAttribute('data-state')) !== 'checked') {
        await toggle.click();
      }

      const includedInput = page.locator('[data-automation-id="fixed-bucket-0-included"]');
      await includedInput.fill(String(options.fixedBucketOverlay.hours));

      const overageInput = page.locator('[data-automation-id="fixed-bucket-0-overage"]');
      await overageInput.fill((options.fixedBucketOverlay.overageRateCents / 100).toFixed(2));

      const rolloverCheckbox = page.locator('[data-automation-id="fixed-bucket-0-rollover"]');
      const shouldCheck = Boolean(options.fixedBucketOverlay.allowRollover);
      if (shouldCheck) {
        if (!(await rolloverCheckbox.isChecked())) {
          await rolloverCheckbox.check();
        }
      } else if (await rolloverCheckbox.isChecked()) {
        await rolloverCheckbox.uncheck();
      }
    }

    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(
      page.getByRole('heading', { name: 'Hourly Services' }).first()
    ).toBeVisible({ timeout: 3000 });

    if (options?.hourlyService) {
      const hourly = options.hourlyService;
      await page.getByRole('button', { name: /Add Hourly Service/i }).click();

      const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).last();
      await serviceSelect.click();
      await page.getByRole('option', { name: hourly.serviceName }).click();

      if (hourly.hourlyRate !== undefined) {
        const rateLocator = page.locator('#hourly-rate-0');
        await rateLocator.fill((hourly.hourlyRate / 100).toFixed(2));
        await rateLocator.press('Tab');
      }

      if (hourly.minimumBillableTime !== undefined) {
        await page.fill('#minimum_billable_time', String(hourly.minimumBillableTime));
      }

      if (hourly.roundUpToNearest !== undefined) {
        await page.fill('#round_up_to_nearest', String(hourly.roundUpToNearest));
      }
    }

    if (options?.hourlyBucketOverlay) {
      const toggle = page.locator('[data-automation-id="Include bucket of hours"]');
      if ((await toggle.getAttribute('data-state')) !== 'checked') {
        await toggle.click();
      }

      const includedInput = page.locator('[data-automation-id="hourly-bucket-0-included"]');
      await includedInput.fill(String(options.hourlyBucketOverlay.hours));

      const overageInput = page.locator('[data-automation-id="hourly-bucket-0-overage"]');
      await overageInput.fill((options.hourlyBucketOverlay.overageRateCents / 100).toFixed(2));

      const rolloverCheckbox = page.locator('[data-automation-id="hourly-bucket-0-rollover"]');
      const shouldCheckHourly = Boolean(options.hourlyBucketOverlay.allowRollover);
      if (shouldCheckHourly) {
        if (!(await rolloverCheckbox.isChecked())) {
          await rolloverCheckbox.check();
        }
      } else if (await rolloverCheckbox.isChecked()) {
        await rolloverCheckbox.uncheck();
      }
    }

    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(
      page.getByRole('heading', { name: 'Usage-Based Services' }).first()
    ).toBeVisible({ timeout: 3000 });

    if (options?.usageBucketOverlay) {
      const usage = options.usageBucketOverlay;
      await page.getByRole('button', { name: /Add Usage-Based Service/i }).click();

      const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).last();
      await serviceSelect.click();
      const usageServiceName = usage.serviceName || serviceName;
      await page.getByRole('option', { name: usageServiceName }).click();

      await page.locator('#unit-rate-0').fill('0.00');
      await page.locator('#unit-rate-0').blur();
      await page.locator('#unit-measure-0').fill(usage.unitOfMeasure);

      const toggle = page.locator('[data-automation-id="Include bucket allocation"]');
      if ((await toggle.getAttribute('data-state')) !== 'checked') {
        await toggle.click();
      }

      const includedInput = page.locator('[data-automation-id="usage-bucket-0-included"]');
      await includedInput.fill(String(usage.units));

      const overageInput = page.locator('[data-automation-id="usage-bucket-0-overage"]');
      await overageInput.fill((usage.overageRateCents / 100).toFixed(2));

      const rolloverCheckbox = page.locator('[data-automation-id="usage-bucket-0-rollover"]');
      const shouldCheckUsage = Boolean(usage.allowRollover);
      if (shouldCheckUsage) {
        if (!(await rolloverCheckbox.isChecked())) {
          await rolloverCheckbox.check();
        }
      } else if (await rolloverCheckbox.isChecked()) {
        await rolloverCheckbox.uncheck();
      }
    }

    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(
      page.getByRole('heading', { name: 'Review Contract' }).first()
    ).toBeVisible({ timeout: 3000 });

    if (options?.onReview) {
      await options.onReview(page);
    }

    if (options?.fixedBucketOverlay) {
      await expect(page.getByText(/Bucket:/i)).toBeVisible({ timeout: 3000 });
    }

    if (options?.usageBucketOverlay) {
      await expect(page.getByText(/Bucket: .*units/i)).toBeVisible({ timeout: 3000 });
    }

    await expect(page.locator(`text=${serviceName}`).first()).toBeVisible({ timeout: 3000 });

    await page.locator('[data-automation-id="wizard-finish"]').click();
    await expect(page.locator('[data-automation-id="wizard-finish"]')).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('[data-automation-id="wizard-contract-button"]')).toBeVisible();
  } finally {
    // Cleanup happens in test teardown
  }
}

test.describe('Date Picker Timezone Regression', () => {
  test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

  test('selecting first of month should not shift to previous day in review', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const contractName = `TZ Regression Contract ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await setupAuthenticatedSession(page, tenantData, { baseUrl: TEST_CONFIG.baseUrl });

      // Warm up on canonical host to ensure cookie domain matches before protected route
      await page.goto(`${TEST_CONFIG.baseUrl}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });

      // Go to the billing page and navigate to Client Contracts tab
      const tenantQuery = process.env.E2E_AUTH_BYPASS === 'true' && tenantData?.tenant?.tenantId
        ? `?tenantId=${tenantData.tenant.tenantId}`
        : '';
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing${tenantQuery}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      // Switch to Client Contracts tab
      const clientContractsTab = page.locator('[data-automation-id="tab-client-contracts"], [role="tab"]').filter({ hasText: /Client Contracts/i });
      await clientContractsTab.waitFor({ timeout: 15_000 });
      await clientContractsTab.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button').or(page.getByRole('button', { name: /Create Contract/i }));
      await wizardButtonLocator.click();
      await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ timeout: 10_000 });
      await waitForUIState(page);

      // Select client - ClientPicker renders as a button
      const clientButton = page.getByRole('button', { name: /Select a client/i });
      await clientButton.waitFor({ timeout: 10_000 });
      await clientButton.click();

      // Wait for client options to appear and click the test client
      const clientOption = page.getByText(tenantData.client!.clientName, { exact: true });
      await clientOption.waitFor({ state: 'visible', timeout: 5_000 });
      await clientOption.click();

      // Set contract name
      await page.locator('[data-automation-id="contract_name"]').fill(contractName + ' TZ');

      // Open start-date picker and choose the 1st of the current month
      const displayMonth = new Date();
      const firstOfMonth = new Date(displayMonth.getFullYear(), displayMonth.getMonth(), 1);
      const expectedDisplay = firstOfMonth.toLocaleDateString('en-US');

      await page.locator('[data-automation-id="start-date"]').click();
      // Ensure we are at the current month: click Today button
      await page.getByRole('button', { name: /Go to today/i }).click();
      // Click day cell "1" for current month (exclude outside days)
      await page.locator('.rdp-day:not(.rdp-day_outside)').filter({ hasText: /^1$/ }).first().click();

      // Required: select Billing Frequency Monthly to pass validation on Basics
      try {
        const freqSelect = page.getByRole('combobox', { name: /Select billing frequency/i });
        await freqSelect.click();
        await page.getByRole('option', { name: /Monthly/i }).click();
      } catch {}

      // Move to Review, skipping through intermediate steps quickly
      // Click Next until we reach the Review page (max 5 times)
      for (let i = 0; i < 5; i++) {
        const reviewHeading = page.getByRole('heading', { name: 'Review Contract' });
        const isOnReview = await reviewHeading.isVisible().catch(() => false);
        if (isOnReview) {
          break; // Already on review page
        }

        const nextButton = page.locator('[data-automation-id="wizard-next"]');
        const nextExists = await nextButton.isVisible().catch(() => false);
        if (!nextExists) {
          break; // No more Next button, probably on final page
        }

        await nextButton.click();
        await page.waitForTimeout(200); // small debounce for UI updates
      }
      await expect(page.getByRole('heading', { name: 'Review Contract' })).toBeVisible({ timeout: 5000 });

      // Assert Contract Period shows the 1st of the month, not the previous date
      const pageText = await page.textContent('body');
      expect(pageText || '').toContain(expectedDisplay);
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

  test('persists start/end as date-only without TZ shifts (DB)', async ({ page }) => {
    // Local helpers for this block
    const openWizardForTenant = async (page: Page, tenantId: string) => {
      attachFailFastHandlers(page, TEST_CONFIG.baseUrl);
      const tenantQuery = process.env.E2E_AUTH_BYPASS === 'true' && tenantId
        ? `?tenantId=${tenantId}`
        : '';
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing${tenantQuery}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');

      // Switch to Client Contracts tab
      const clientContractsTab = page.locator('[data-automation-id="tab-client-contracts"], [role="tab"]').filter({ hasText: /Client Contracts/i });
      await clientContractsTab.waitFor({ timeout: 15_000 });
      await clientContractsTab.click();
      await page.waitForLoadState('networkidle', { timeout: 10_000 });

      const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button');
      await wizardButtonLocator.click();
      await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ timeout: 10_000 });
    };
    const selectClientAndNameLocal = async (page: Page, clientName: string, name: string) => {
      const clientSelect = page.getByRole('combobox', { name: /Select a client|Loading clients/i });
      await clientSelect.click();
      await page.getByRole('option', { name: clientName }).click();
      await page.locator('[data-automation-id="contract_name"], #contract_name').fill(name);
    };
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const contractName = `TZ Persist ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, new Date());
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, new Date());
      await setupAuthenticatedSession(page, tenantData);
      await openWizardForTenant(page, tenantId);
      await selectClientAndNameLocal(page, tenantData.client!.clientName, contractName);

      const now2 = new Date();
      const start = new Date(now2.getFullYear(), now2.getMonth(), 1);
      const end = new Date(now2.getFullYear(), now2.getMonth() + 1, 0);
      const startYMD = start.toLocaleDateString('en-CA'); // YYYY-MM-DD
      const endYMD = end.toLocaleDateString('en-CA');

      await page.locator('[data-automation-id="start-date"]').click();
      await page.locator('.rdp-day:not(.rdp-day_outside)').filter({ hasText: /^1$/ }).first().click();
      await page.locator('[data-automation-id="end-date"]').click();
      await page.locator('.rdp-day:not(.rdp-day_outside)').filter({ hasText: new RegExp(`^${end.getDate()}$`) }).first().click();

      // Minimal fixed config
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.getByRole('button', { name: 'Add Service' }).click();
      const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).first();
      await serviceSelect.click();
      await page.getByRole('option', { name: fixedServiceName }).click();
      await page.locator('[data-automation-id="quantity-0"], #quantity-0').fill('1');
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').fill('500');
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').blur();
      for (const _ of [0,1,2,3]) { await page.locator('[data-automation-id="wizard-next"], #wizard-next').click(); }
      await page.locator('[data-automation-id="wizard-finish"], #wizard-finish').click();
      await page.locator('[data-automation-id="dialog-dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(async () => {
        await expect(page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button')).toBeVisible({ timeout: 15000 });
      });

      // Read back dates as text to avoid driver date parsing
      const bundle = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName }).first();
      expect(bundle).toBeDefined();
      const row = await db
        .raw('select start_date::text as s, end_date::text as e from client_plan_bundles where tenant = ? and bundle_id = ? limit 1', [tenantId, bundle!.bundle_id])
        .then((r: any) => r.rows?.[0]);
      expect(row).toBeDefined();
      // Compare YMD; en-CA locale gives YYYY-MM-DD reliably
      expect(row.s).toBe(startYMD);
      expect(row.e).toBe(endYMD);
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
