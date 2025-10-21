/**
 * Playwright tests for Contract Wizard happy path scenarios.
 * Salient details:
 * - Test seeds tenants/services directly via Knex helpers (no HTTP mocks) and cleans up afterward.
 * - UI interactions are driven through automation IDs harvested from the reflection system (`__UI_STATE__`).
 * - Fail-fast listeners surface client/network/server errors immediately to tighten feedback.
 * - Database assertions validate that finishing the wizard persists bundles, plans, and fixed-fee configs.
 * - RBI Reminder - make sure server is not running independently of playwright test, so that server side is loaded in the same process to allow mocking to work correctly
 */

import { expect, test, Page } from '@playwright/test';
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
  waitForUIState,
  findComponent,
  seedFixedServiceForTenant,
  seedHourlyServiceForTenant,
  cleanupContractArtifacts,
  type UIComponentNode,
} from './helpers/playwrightContractHelpers';

applyPlaywrightAuthEnvDefaults();
const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const EE_SERVER_PATH_SUFFIX = `${path.sep}ee${path.sep}server`;
const WORKSPACE_ROOT = process.cwd().endsWith(EE_SERVER_PATH_SUFFIX)
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();

applyPlaywrightDatabaseEnv();

let adminDb: Knex | null = null;
let databaseReadyPromise: Promise<void> | null = null;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function seedUsageServiceForTenant(
  db: Knex,
  tenantId: string,
  serviceName: string,
  now: Date,
  defaultRateCents = 100
): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  const orderNumber = Math.floor(Math.random() * 1000000) + 1;

  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Usage Type ${serviceName}`,
    billing_method: 'usage',
    is_active: true,
    description: 'Playwright usage service type',
    order_number: orderNumber,
    standard_service_type_id: null,
    created_at: now,
    updated_at: now,
  });

  await db('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: serviceName,
    description: 'Playwright usage service',
    custom_service_type_id: serviceTypeId,
    billing_method: 'usage',
    default_rate: defaultRateCents,
    unit_of_measure: 'unit',
    category_id: null,
    tax_rate_id: null,
  });

  return { serviceTypeId, serviceId };
}

async function getBucketOverlayForService(
  db: Knex,
  tenantId: string,
  contractLineIds: string[],
  serviceId: string
) {
  return db('contract_line_service_configuration as clsc')
    .join('contract_line_service_bucket_config as clsb', function() {
      this.on('clsc.config_id', '=', 'clsb.config_id')
        .andOn('clsc.tenant', '=', 'clsb.tenant');
    })
    .where('clsc.tenant', tenantId)
    .whereIn('clsc.contract_line_id', contractLineIds)
    .andWhere('clsc.service_id', serviceId)
    .andWhere('clsc.configuration_type', 'Bucket')
    .select(
      'clsc.contract_line_id',
      'clsc.config_id',
      'clsb.total_minutes',
      'clsb.billing_period',
      'clsb.overage_rate',
      'clsb.allow_rollover'
    )
    .first();
}

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

    const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"]')
      .or(page.getByRole('button', { name: /Create Contract/i }));
    await wizardButtonLocator.click();

    const dialogLocator = page.locator('[data-automation-id="dialog-dialog"]');
    await dialogLocator.waitFor({ state: 'attached', timeout: 10_000 });

    await page
      .locator('[data-automation-id="contract-basics-step"]')
      .waitFor({ state: 'attached', timeout: 10_000 });
    await waitForUIState(page);

    const clientButton = page.getByRole('button', { name: /Select a client/i });
    await clientButton.waitFor({ timeout: 10_000 });
    await clientButton.click();
    const clientOption = page.getByText(tenantData.client.clientName, { exact: true });
    await clientOption.waitFor({ state: 'visible', timeout: 5_000 });
    await clientOption.click();

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
      await toggle.waitFor({ state: 'visible', timeout: 10_000 });
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
        await page.fill('#minimum-billable-time', String(hourly.minimumBillableTime));
      }

      if (hourly.roundUpToNearest !== undefined) {
        await page.fill('#round-up-to', String(hourly.roundUpToNearest));
      }
    }

    if (options?.hourlyBucketOverlay) {
      const toggle = page.locator('#Recommend\\ bucket\\ of\\ hours');
      await toggle.waitFor({ state: 'visible', timeout: 10_000 });
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

      const toggle = page.locator('#Recommend\\ bucket\\ allocation');
      await toggle.waitFor({ state: 'visible', timeout: 10_000 });
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
      const dialogLocator = page.locator('[data-automation-id="dialog-dialog"]');
      const dialogText = (await dialogLocator.textContent()) ?? '';
      const unitLabel = options.usageBucketOverlay.unitOfMeasure || 'unit';
      const bucketPattern = new RegExp(`Bucket:\\s*[\\s\\S]*${escapeRegex(unitLabel)}`, 'i');
      expect(dialogText).toMatch(bucketPattern);
    }

    await expect(page.locator(`text=${serviceName}`).first()).toBeVisible({ timeout: 3000 });

    await page.locator('[data-automation-id="wizard-finish"]').click();
    await expect(page.locator('[data-automation-id="wizard-finish"]')).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('[data-automation-id="wizard-contract-button"]')
      .or(page.getByRole('button', { name: /Create Contract/i }))).toBeVisible();
  } finally {
    // Cleanup happens in test teardown
  }
}

test.describe('Contract Wizard Happy Path', () => {
  test('fills required fields across all steps and completes review', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);

      const contractName = 'Playwright Automation Contract';
      await completeContractWizardFlow(page, tenantData, serviceName, contractName);
    } finally {
      if (tenantData) {
        const tenantId = tenantData.tenant.tenantId;
        await cleanupContractArtifacts(db, tenantId);
        await db('service_catalog').where({ tenant: tenantId }).del().catch(() => {});
        await db('service_types').where({ tenant: tenantId }).del().catch(() => {});
        await rollbackTenant(db, tenantId).catch(() => {});
      }
      await db.destroy();
      // throw new Error('Test complete'); // Forcefully terminate to avoid open handles from db connections
    }
  });

  test('creates a plan bundle in the database when the wizard completes', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Contract ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);

      await completeContractWizardFlow(page, tenantData, serviceName, contractName);

      const createdContract = await db('contracts')
        .where({ tenant: tenantId, contract_name: contractName })
        .first();

      expect(createdContract).toBeDefined();
      expect(createdContract?.tenant).toBe(tenantId);
      expect(createdContract?.is_active).toBe(true);
      expect(createdContract?.contract_description ?? null).toBeNull();
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

  test('creates fixed fee plan and service configuration via wizard', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Contract ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      const { serviceId } = await seedFixedServiceForTenant(db, tenantId, serviceName, now);

      await completeContractWizardFlow(page, tenantData, serviceName, contractName, {
        baseRate: 500,
      });

      const contract = await db('contracts')
        .where({ tenant: tenantId, contract_name: contractName })
        .first();
      expect(contract).toBeDefined();

      const contractLineMapping = await db('contract_line_mappings')
        .where({ tenant: tenantId, contract_id: contract!.contract_id })
        .first();
      expect(contractLineMapping).toBeDefined();

      const contractLine = await db('contract_lines')
        .where({ tenant: tenantId, contract_line_id: contractLineMapping!.contract_line_id })
        .first();
      expect(contractLine).toBeDefined();
      expect(contractLine?.contract_line_type).toBe('Fixed');
      expect(contractLine?.billing_frequency).toBe('monthly');

      const contractLineFixedConfig = await db('contract_line_fixed_config')
        .where({ tenant: tenantId, contract_line_id: contractLineMapping!.contract_line_id })
        .first();
      expect(contractLineFixedConfig).toBeDefined();
      expect(Number(contractLineFixedConfig?.base_rate)).toBeCloseTo(500, 2);
      expect(contractLineFixedConfig?.enable_proration).toBe(true);

      const contractLineServiceRow = await db('contract_line_services')
        .where({
          tenant: tenantId,
          contract_line_id: contractLineMapping!.contract_line_id,
          service_id: serviceId,
        })
        .first();
      expect(contractLineServiceRow).toBeDefined();
      expect(contractLineServiceRow?.quantity).toBe(1);

      const contractLineServiceConfig = await db('contract_line_service_configuration')
        .where({
          tenant: tenantId,
          contract_line_id: contractLineMapping!.contract_line_id,
          service_id: serviceId,
        })
        .first();
      expect(contractLineServiceConfig).toBeDefined();
      expect(contractLineServiceConfig?.configuration_type).toBe('Fixed');

      const contractLineServiceFixedConfig = await db('contract_line_service_fixed_config')
        .where({
          tenant: tenantId,
          config_id: contractLineServiceConfig!.config_id,
        })
        .first();
      expect(contractLineServiceFixedConfig).toBeDefined();
      expect(Number(contractLineServiceFixedConfig?.base_rate)).toBeCloseTo(500, 2);
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

  test('creates hourly plan and service configuration via wizard', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const hourlyServiceName = `Playwright Hourly Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Contract ${uuidv4().slice(0, 8)}`;
    const hourlyRateCents = 16500;
    const minimumBillableTime = 15;
    const roundUpMinutes = 30;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      const usageServiceName = `Usage Service ${uuidv4().slice(0, 8)}`;
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await seedUsageServiceForTenant(db, tenantId, usageServiceName, now, 50);
      const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(
        db,
        tenantId,
        hourlyServiceName,
        now,
        hourlyRateCents
      );
      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        hourlyService: {
          serviceId: hourlyServiceId,
          serviceName: hourlyServiceName,
          hourlyRate: hourlyRateCents,
          minimumBillableTime,
          roundUpToNearest: roundUpMinutes,
        },
      });

      const contract = await db('contracts')
        .where({ tenant: tenantId, contract_name: contractName })
        .first();
      expect(contract).toBeDefined();

      const contractLineMappings = await db('contract_line_mappings')
        .where({ tenant: tenantId, contract_id: contract!.contract_id })
        .orderBy('display_order', 'asc');
      expect(contractLineMappings.length).toBeGreaterThanOrEqual(2);

      const contractLineIds = contractLineMappings.map((clm: any) => clm.contract_line_id);
      const hourlyContractLine = await db('contract_lines')
        .whereIn('contract_line_id', contractLineIds)
        .andWhere({ tenant: tenantId, contract_line_type: 'Hourly' })
        .first();
      expect(hourlyContractLine).toBeDefined();

      const hourlyContractLineId = hourlyContractLine!.contract_line_id;

      const contractLineServiceRow = await db('contract_line_services')
        .where({ tenant: tenantId, contract_line_id: hourlyContractLineId, service_id: hourlyServiceId })
        .first();
      expect(contractLineServiceRow).toBeDefined();
      expect(contractLineServiceRow?.quantity).toBe(1);

      const hourlyConfigRow = await db('contract_line_service_configuration')
        .where({ tenant: tenantId, contract_line_id: hourlyContractLineId, service_id: hourlyServiceId })
        .andWhere({ configuration_type: 'Hourly' })
        .first();
      expect(hourlyConfigRow).toBeDefined();

      const hourlyConfigDetails = await db('contract_line_service_hourly_configs')
        .where({ tenant: tenantId, config_id: hourlyConfigRow!.config_id })
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

  test('persists purchase order metadata when provided', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Contract ${uuidv4().slice(0, 8)}`;
    const poNumber = `PO-${uuidv4().slice(0, 6)}`;
    const poAmountCents = 125000; // $1,250.00

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      if (!tenantData.client) {
        throw new Error('Test tenant missing client data required for purchase order verification.');
      }

      await completeContractWizardFlow(page, tenantData, serviceName, contractName, {
        baseRate: 500,
        purchaseOrder: {
          required: true,
          number: poNumber,
          amountCents: poAmountCents,
        },
      });

      const contract = await db('contracts')
        .where({ tenant: tenantId, contract_name: contractName })
        .first();
      expect(contract).toBeDefined();

      const clientContract = await db('client_contracts')
        .where({ tenant: tenantId, client_id: tenantData.client.clientId, contract_id: contract?.contract_id })
        .first();

      expect(clientContract).toBeDefined();
      expect(clientContract.po_number).toBe(poNumber);
      expect(clientContract.po_required).toBe(true);
      expect(Number(clientContract.po_amount ?? 0)).toBe(poAmountCents);
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

  test('validates review math and persisted values (hourly + bucket hours)', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const hourlyServiceName = `Playwright Hourly Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Contract ${uuidv4().slice(0, 8)}`;
    const hourlyRateCents = 16500;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(
        db,
        tenantId,
        hourlyServiceName,
        now,
        hourlyRateCents
      );

      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        hourlyService: {
          serviceId: hourlyServiceId,
          serviceName: hourlyServiceName,
          hourlyRate: hourlyRateCents,
        },
        hourlyBucketOverlay: {
          hours: 40,
          overageRateCents: 15000,
          serviceName: hourlyServiceName,
        },
        onReview: async (page) => {
          const dialogText = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
          expect(dialogText).toMatch(/\$500\.00/);
          expect(dialogText).toMatch(/\$150\.00\/hour overage/i);
        },
      });

      const { contract, contractLineIds, contractLines } = await getContractLineContext(
        db,
        tenantId,
        contractName
      );
      expect(contract).toBeDefined();
      expect(contractLineIds.length).toBeGreaterThan(0);
      expect(contractLines.some((line: any) => line.contract_line_type === 'Hourly')).toBe(true);

      const hourlyLine = contractLines.find((line: any) => line.contract_line_type === 'Hourly');
      expect(hourlyLine).toBeDefined();

      const hourlyConfig = await db('contract_line_service_hourly_configs')
        .join('contract_line_service_configuration', function() {
          this.on('contract_line_service_hourly_configs.config_id', '=', 'contract_line_service_configuration.config_id')
            .andOn('contract_line_service_hourly_configs.tenant', '=', 'contract_line_service_configuration.tenant');
        })
        .where('contract_line_service_configuration.tenant', tenantId)
        .andWhere('contract_line_service_configuration.contract_line_id', hourlyLine!.contract_line_id)
        .select('contract_line_service_hourly_configs.*')
        .first();
      expect(Number(hourlyConfig?.hourly_rate)).toBe(hourlyRateCents);

      const service = await db('service_catalog')
        .where({ tenant: tenantId, service_name: hourlyServiceName })
        .first();
      expect(service).toBeDefined();

      const overlay = await getBucketOverlayForService(
        db,
        tenantId,
        contractLineIds,
        service!.service_id
      );
      expect(overlay).toBeDefined();
      expect(Number(overlay?.total_minutes)).toBe(40 * 60);
      expect(Number(overlay?.overage_rate)).toBe(15000);

      const contractLineService = await db('contract_line_services')
        .where({
          tenant: tenantId,
          contract_line_id: overlay!.contract_line_id,
          service_id: service!.service_id
        })
        .first();
      expect(contractLineService).toBeDefined();
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

  test('configures bucket hours and completes wizard', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const hourlyServiceName = `Playwright Hourly Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Bucket Contract ${uuidv4().slice(0, 8)}`;
    const hourlyRateCents = 16500;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(
        db,
        tenantId,
        hourlyServiceName,
        now,
        hourlyRateCents
      );

      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        hourlyService: {
          serviceId: hourlyServiceId,
          serviceName: hourlyServiceName,
          hourlyRate: hourlyRateCents,
        },
        hourlyBucketOverlay: {
          hours: 40,
          overageRateCents: 15000, // $150.00/hour
          serviceName: hourlyServiceName,
        },
      });

      const { contract, contractLineIds, contractLines } = await getContractLineContext(
        db,
        tenantId,
        contractName
      );
      expect(contract).toBeDefined();
      expect(contractLineIds.length).toBeGreaterThan(0);
      expect(contractLines.some((line: any) => line.contract_line_type === 'Hourly')).toBe(true);

      const hourlyLine = contractLines.find((line: any) => line.contract_line_type === 'Hourly');
      expect(hourlyLine).toBeDefined();

      const service = await db('service_catalog')
        .where({ tenant: tenantId, service_name: hourlyServiceName })
        .first();
      expect(service).toBeDefined();

      const overlay = await getBucketOverlayForService(
        db,
        tenantId,
        contractLineIds,
        service!.service_id
      );
      expect(overlay).toBeDefined();
      expect(overlay!.billing_period).toBe('monthly');
      expect(Number(overlay!.total_minutes)).toBe(40 * 60);
      expect(Number(overlay!.overage_rate)).toBe(15000);

      const contractLineService = await db('contract_line_services')
        .where({
          tenant: tenantId,
          contract_line_id: overlay!.contract_line_id,
          service_id: service!.service_id
        })
        .first();
      expect(contractLineService).toBeDefined();
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

  test('configures usage-based bucket and completes wizard', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const usageServiceName = `Playwright Usage Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Usage Bucket Contract ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await seedUsageServiceForTenant(db, tenantId, usageServiceName, now);
      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        usageBucketOverlay: {
          units: 1000,
          unitOfMeasure: 'API calls',
          overageRateCents: 50,
          serviceName: usageServiceName,
        },
      });

      const { contract, contractLineIds, contractLines } = await getContractLineContext(
        db,
        tenantId,
        contractName
      );
      expect(contract).toBeDefined();
      expect(contractLineIds.length).toBeGreaterThan(0);
      expect(contractLines.some((line: any) => line.contract_line_type === 'Fixed')).toBe(true);

      const service = await db('service_catalog')
        .where({ tenant: tenantId, service_name: usageServiceName })
        .first();
      expect(service).toBeDefined();

      const overlay = await getBucketOverlayForService(
        db,
        tenantId,
        contractLineIds,
        service!.service_id
      );
      expect(overlay).toBeDefined();
      expect(overlay!.billing_period).toBe('monthly');
      // For usage-based bucket we store units as total_minutes generic quantity
      expect(Number(overlay!.total_minutes)).toBe(1000);
      expect(Number(overlay!.overage_rate)).toBe(50);

      const contractLineService = await db('contract_line_services')
        .where({
          tenant: tenantId,
          contract_line_id: overlay!.contract_line_id,
          service_id: service!.service_id
        })
        .first();
      expect(contractLineService).toBeDefined();
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

  test.describe('Bucket Overage Calculations - Cents vs Dollars', () => {
    test('hourly bucket overage with fractional dollars ($150.50/hour)', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;
      const now = new Date();
      const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
      const hourlyServiceName = `Playwright Hourly Service ${uuidv4().slice(0, 8)}`;
      const contractName = `Playwright Overage Test ${uuidv4().slice(0, 8)}`;
      const hourlyRateCents = 16500;
      const overageRateCents = 15050; // $150.50 - This is the critical test case

      try {
        tenantData = await createTestTenant(db, {
          companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;
        await prepareWizardTenant(db, tenantId, now);
        await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
        const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(
          db,
          tenantId,
          hourlyServiceName,
          now,
          hourlyRateCents
        );

        await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
          baseRate: 500,
          hourlyService: {
            serviceId: hourlyServiceId,
            serviceName: hourlyServiceName,
            hourlyRate: hourlyRateCents,
          },
          hourlyBucketOverlay: {
            hours: 10,
            overageRateCents: overageRateCents,
            serviceName: hourlyServiceName,
          },
          onReview: async (page) => {
            // Verify UI displays dollars correctly with 2 decimal places
            const dialogText = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
            expect(dialogText).toMatch(/\$150\.50\/hour/i);

            // Should NOT show incorrect cent-to-dollar conversion
            await expect(page.locator('text=/\\$15,050/')).not.toBeVisible();
            await expect(page.locator('text=/\\$150,50/')).not.toBeVisible();
          },
        });

        const { contract, contractLineIds } = await getContractLineContext(
          db,
          tenantId,
          contractName
        );
        expect(contract).toBeDefined();
        expect(contractLineIds.length).toBeGreaterThan(0);

        const service = await db('service_catalog')
          .where({ tenant: tenantId, service_name: hourlyServiceName })
          .first();
        expect(service).toBeDefined();

        const bucketConfig = await getBucketOverlayForService(
          db,
          tenantId,
          contractLineIds,
          service!.service_id
        );
        expect(bucketConfig).toBeDefined();
        expect(Number(bucketConfig!.total_minutes)).toBe(10 * 60);

        // Critical assertion: Database should store monetary amounts in cents
        const storedOverageRateCents = Number(bucketConfig!.overage_rate);
        expect(storedOverageRateCents).toBe(overageRateCents);
        expect(storedOverageRateCents / 100).toBeCloseTo(150.5, 2);

        // Should NOT be stored as raw dollars or other incorrect conversions
        expect(storedOverageRateCents).not.toBeCloseTo(overageRateCents / 100, 2);
        expect(storedOverageRateCents).not.toBe(overageRateCents * 100);
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

    test('usage bucket overage with complex decimal ($0.45/unit)', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;
      const now = new Date();
      const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
      const usageServiceName = `Playwright Usage Service ${uuidv4().slice(0, 8)}`;
      const contractName = `Playwright Usage Overage ${uuidv4().slice(0, 8)}`;
      const overageRateCents = 45; // $0.45/unit

      try {
        tenantData = await createTestTenant(db, {
          companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;
        await prepareWizardTenant(db, tenantId, now);
        await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
        await seedUsageServiceForTenant(db, tenantId, usageServiceName, now);

        await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
          baseRate: 500,
          usageBucketOverlay: {
            units: 1000,
            unitOfMeasure: 'API calls',
            overageRateCents: overageRateCents,
            serviceName: usageServiceName,
          },
          onReview: async (page) => {
            // Verify UI displays $0.45 correctly
            const dialogText = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
            expect(dialogText).toMatch(/\$0\.45/);

            // Should NOT show incorrect conversion to dollars
            await expect(page.locator('text=/\\$45\.00/')).not.toBeVisible();
            await expect(page.locator('text=/\\$4,500/')).not.toBeVisible();
          },
        });

        const { contract, contractLineIds } = await getContractLineContext(
          db,
          tenantId,
          contractName
        );
        expect(contract).toBeDefined();
        expect(contractLineIds.length).toBeGreaterThan(0);

        const service = await db('service_catalog')
          .where({ tenant: tenantId, service_name: usageServiceName })
          .first();
        expect(service).toBeDefined();

        const bucketConfig = await getBucketOverlayForService(
          db,
          tenantId,
          contractLineIds,
          service!.service_id
        );
        expect(bucketConfig).toBeDefined();
        expect(Number(bucketConfig!.total_minutes)).toBe(1000); // units stored as total_minutes

        // Critical: amounts persist as cents in the database
        const storedOverageRateCents = Number(bucketConfig!.overage_rate);
        expect(storedOverageRateCents).toBe(overageRateCents);
        expect(storedOverageRateCents / 100).toBeCloseTo(0.45, 2);

        // Should NOT be stored as raw dollars or magnified values
        expect(storedOverageRateCents).not.toBeCloseTo(overageRateCents / 100, 2);
        expect(storedOverageRateCents).not.toBe(overageRateCents * 100);
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

    test('edge case - round dollar amount ($100.00)', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;
      const now = new Date();
      const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
      const hourlyServiceName = `Playwright Hourly Service ${uuidv4().slice(0, 8)}`;
      const contractName = `Playwright Round Dollar ${uuidv4().slice(0, 8)}`;
      const hourlyRateCents = 16500;
      const overageRateCents = 10000; // $100.00 - Edge case with no fractional cents

      try {
        tenantData = await createTestTenant(db, {
          companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;
        await prepareWizardTenant(db, tenantId, now);
        await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
        const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(
          db,
          tenantId,
          hourlyServiceName,
          now,
          hourlyRateCents
        );

        await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
          baseRate: 500,
          hourlyService: {
            serviceId: hourlyServiceId,
            serviceName: hourlyServiceName,
            hourlyRate: hourlyRateCents,
          },
          hourlyBucketOverlay: {
            hours: 20,
            overageRateCents: overageRateCents,
            serviceName: hourlyServiceName,
          },
          onReview: async (page) => {
            // Verify UI displays $100.00 correctly
            const dialogText = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
            expect(dialogText).toMatch(/\$100\.00\/hour/i);

            // Should NOT show as $10,000
            await expect(page.locator('text=/\\$10,000/')).not.toBeVisible();
          },
        });

        const { contract, contractLineIds } = await getContractLineContext(
          db,
          tenantId,
          contractName
        );
        expect(contract).toBeDefined();

        const service = await db('service_catalog')
          .where({ tenant: tenantId, service_name: hourlyServiceName })
          .first();
        expect(service).toBeDefined();

        const bucketConfig = await getBucketOverlayForService(
          db,
          tenantId,
          contractLineIds,
          service!.service_id
        );
        expect(bucketConfig).toBeDefined();

        // Critical: persisted values remain in cents even for round dollars
        const storedOverageRateCents = Number(bucketConfig!.overage_rate);
        expect(storedOverageRateCents).toBe(overageRateCents);
        expect(storedOverageRateCents / 100).toBeCloseTo(100.0, 2);

        // Should NOT be stored as raw dollars or multiplied
        expect(storedOverageRateCents).not.toBeCloseTo(overageRateCents / 100, 2);
        expect(storedOverageRateCents).not.toBe(overageRateCents * 100);
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

    test('edge case - small fractional amount ($0.05)', async ({ page }) => {
      test.setTimeout(300000);
      const db = createTestDbConnection();
      let tenantData: TenantTestData | null = null;
      const now = new Date();
      const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
      const usageServiceName = `Playwright Usage Service ${uuidv4().slice(0, 8)}`;
      const contractName = `Playwright Small Amount ${uuidv4().slice(0, 8)}`;
      const overageRateCents = 5; // $0.05 - Very small amount

      try {
        tenantData = await createTestTenant(db, {
          companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
        });

        const tenantId = tenantData.tenant.tenantId;
        await prepareWizardTenant(db, tenantId, now);
        await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
        await seedUsageServiceForTenant(db, tenantId, usageServiceName, now);

        await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
          baseRate: 500,
          usageBucketOverlay: {
            units: 5000,
            unitOfMeasure: 'units',
            overageRateCents: overageRateCents,
            serviceName: usageServiceName,
          },
          onReview: async (page) => {
            // Verify UI displays $0.05 correctly
            const dialogText = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
            expect(dialogText).toMatch(/\$0\.05/);

            // Should NOT show incorrect overage amounts
            // Note: $500 appears as base rate, so check for overage context
            await expect(page.locator('text=/overage.*\\$5\.00/i')).not.toBeVisible();
          },
        });

        const { contract, contractLineIds } = await getContractLineContext(
          db,
          tenantId,
          contractName
        );
        expect(contract).toBeDefined();

        const service = await db('service_catalog')
          .where({ tenant: tenantId, service_name: usageServiceName })
          .first();
        expect(service).toBeDefined();

        const bucketConfig = await getBucketOverlayForService(
          db,
          tenantId,
          contractLineIds,
          service!.service_id
        );
        expect(bucketConfig).toBeDefined();

        // Critical: persisted values remain in cents for very small amounts
        const storedOverageRateCents = Number(bucketConfig!.overage_rate);
        expect(storedOverageRateCents).toBe(overageRateCents);
        expect(storedOverageRateCents / 100).toBeCloseTo(0.05, 2);

        // Should NOT be stored as raw dollars or multiplied
        expect(storedOverageRateCents).not.toBeCloseTo(overageRateCents / 100, 2);
        expect(storedOverageRateCents).not.toBe(overageRateCents * 100);
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

    test.skip('fixed fee bucket overage - SKIPPED (feature not yet implemented in wizard UI)', async ({ page }) => {
      // This test is skipped because the contract wizard UI does not currently
      // support bucket overlays for fixed fee services. The backend supports it,
      // but the UI toggle is missing from FixedFeeServicesStep.tsx
      // TODO: Re-enable this test once fixed fee bucket overlay UI is implemented
    });
  });
});
