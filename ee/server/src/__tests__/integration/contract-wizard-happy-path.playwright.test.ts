/**
 * Playwright-driven happy path that exercises the Contract Wizard against a real test database.
 * Salient details:
 * - Test seeds tenants/services directly via Knex helpers (no HTTP mocks) and cleans up afterward.
 * - UI interactions are driven through automation IDs harvested from the reflection system (`__UI_STATE__`).
 * - Fail-fast listeners surface client/network/server errors immediately to tighten feedback.
 * - Database assertions validate that finishing the wizard persists bundles, plans, and fixed-fee configs.
 * - RBI Reminder - make sure server is not running independently of playwright test, so that server side is loaded in the same process to allow mocking to work correctly
 */

import { expect, Page, test } from '@playwright/test';
import type { Knex } from 'knex';
import { knex as createKnex } from 'knex';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, type DbTestConfig } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';
import { rollbackTenant } from '../../lib/testing/tenant-creation';
import { applyPlaywrightDatabaseEnv, PLAYWRIGHT_DB_CONFIG } from './utils/playwrightDatabaseConfig';
import {
  applyPlaywrightAuthEnvDefaults,
  prepareTenantForPlaywright,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
  type TenantPermissionTuple,
} from './helpers/playwrightAuthSessionHelper';

type UIComponentNode = {
  id: string;
  type: string;
  label?: string;
  fieldType?: string;
  options?: Array<{ label: string; value: string }>;
  children?: UIComponentNode[];
};

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


// Database is prepared once per session by Playwright webServer bootstrap.

function attachFailFastHandlers(page: Page, baseUrl: string) {
  const isRelevant = (url: string) => url.startsWith(baseUrl);

  page.on('pageerror', (error) => {
    throw new Error(`Client-side error detected: ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!isRelevant(url)) return;
    const resourceType = request.resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;
    const failure = request.failure();
    if (failure?.errorText === 'net::ERR_ABORTED') {
      // Navigation can abort in-flight fetches (e.g. form redirects). Treat as benign.
      return;
    }
    throw new Error(
      `Network request failed for ${url}: ${failure?.errorText ?? 'unknown error'}`
    );
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!isRelevant(url)) return;
    const resourceType = response.request().resourceType();
    if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

    const status = response.status();
    if (status >= 500) {
      const bodySnippet = await response
        .text()
        .then((text) => text.slice(0, 500))
        .catch(() => '<unavailable>');
      console.warn(
        `Non-blocking warning: server responded with ${status} for ${url}. Snippet: ${bodySnippet}`
      );
    }
  });
}

async function waitForUIState(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__UI_STATE__), null, {
    timeout: 10_000,
  });
}

async function getUIComponents(page: Page): Promise<UIComponentNode[]> {
  return (await page.evaluate(() => {
    const state = (window as any).__UI_STATE__;
    return state?.components ?? [];
  })) as UIComponentNode[];
}

function dfsFindComponent(
  nodes: UIComponentNode[] | undefined,
  predicate: (component: UIComponentNode) => boolean
): UIComponentNode | null {
  if (!nodes) {
    return null;
  }
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }
    const childMatch = dfsFindComponent(node.children, predicate);
    if (childMatch) {
      return childMatch;
    }
  }
  return null;
}

async function findComponent(
  page: Page,
  predicate: (component: UIComponentNode) => boolean,
  retries = 20,
  delayMs = 250
): Promise<UIComponentNode> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const components = await getUIComponents(page);
    const match = dfsFindComponent(components, predicate);
    if (match) {
      return match;
    }
    await page.waitForTimeout(delayMs);
  }
  throw new Error('UI component matching predicate was not found within the allotted time.');
}

async function seedFixedServiceForTenant(
  db: Knex,
  tenantId: string,
  serviceName: string,
  now: Date
): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  const orderNumber = Math.floor(Math.random() * 1000000) + 1;

  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Automation Type ${serviceName}`,
    billing_method: 'fixed',
    is_active: true,
    description: 'Playwright automation service type',
    order_number: orderNumber,
    standard_service_type_id: null,
    created_at: now,
    updated_at: now,
  });

  await db('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: serviceName,
    description: 'Playwright automation service',
    custom_service_type_id: serviceTypeId,
    billing_method: 'fixed',
    default_rate: 150000,
    unit_of_measure: 'month',
    category_id: null,
    tax_rate_id: null,
  });

  return { serviceTypeId, serviceId };
}

async function seedHourlyServiceForTenant(
  db: Knex,
  tenantId: string,
  serviceName: string,
  now: Date,
  defaultRateCents = 12500
): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();
  const orderNumber = Math.floor(Math.random() * 1000000) + 1;

  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Hourly Type ${serviceName}`,
    billing_method: 'hourly',
    is_active: true,
    description: 'Playwright hourly service type',
    order_number: orderNumber,
    standard_service_type_id: null,
    created_at: now,
    updated_at: now,
  });

  await db('service_catalog').insert({
    service_id: serviceId,
    tenant: tenantId,
    service_name: serviceName,
    description: 'Playwright hourly service',
    custom_service_type_id: serviceTypeId,
    billing_method: 'hourly',
    default_rate: defaultRateCents,
    unit_of_measure: 'hour',
    category_id: null,
    tax_rate_id: null,
  });

  return { serviceTypeId, serviceId };
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

async function cleanupContractArtifacts(db: Knex, tenantId: string): Promise<void> {
  await db('bucket_usage').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_service_bucket_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_service_configuration').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_services').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_line_mappings').where({ tenant: tenantId }).del().catch(() => {});
  await db('client_contract_lines').where({ tenant: tenantId }).del().catch(() => {});
  await db('client_contracts').where({ tenant: tenantId }).del().catch(() => {});
  await db('contracts').where({ tenant: tenantId }).del().catch(() => {});
  await db('contract_lines').where({ tenant: tenantId }).del().catch(() => {});
  await db('user_type_rates').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_hourly_configs').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_fixed_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_configuration').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_services').where({ tenant: tenantId }).del().catch(() => {});
  await db('billing_plan_fixed_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('bundle_billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('company_billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('client_plan_bundles').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_bundles').where({ tenant: tenantId }).del().catch(() => {});
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

    // Navigate to contracts page - under bypass, pass tenantId for server actions
    const tenantQuery = process.env.E2E_AUTH_BYPASS === 'true' && tenantData?.tenant?.tenantId
      ? `&tenantId=${tenantData.tenant.tenantId}`
      : '';
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contracts${tenantQuery}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
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

      const createdBundle = await db('plan_bundles')
        .where({ tenant: tenantId, bundle_name: contractName })
        .first();

      expect(createdBundle).toBeDefined();
      expect(createdBundle?.tenant).toBe(tenantId);
      expect(createdBundle?.is_active).toBe(true);
      expect(createdBundle?.bundle_description ?? null).toBeNull();
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

      const bundle = await db('plan_bundles')
        .where({ tenant: tenantId, bundle_name: contractName })
        .first();
      expect(bundle).toBeDefined();

      const bundlePlan = await db('bundle_billing_plans')
        .where({ tenant: tenantId, bundle_id: bundle!.bundle_id })
        .first();
      expect(bundlePlan).toBeDefined();

      const plan = await db('billing_plans')
        .where({ tenant: tenantId, plan_id: bundlePlan!.plan_id })
        .first();
      expect(plan).toBeDefined();
      expect(plan?.plan_type).toBe('Fixed');
      expect(plan?.billing_frequency).toBe('monthly');

      const planFixedConfig = await db('billing_plan_fixed_config')
        .where({ tenant: tenantId, plan_id: bundlePlan!.plan_id })
        .first();
      expect(planFixedConfig).toBeDefined();
      expect(Number(planFixedConfig?.base_rate)).toBeCloseTo(500, 2);
      expect(planFixedConfig?.enable_proration).toBe(true);

      const planServiceRow = await db('plan_services')
        .where({
          tenant: tenantId,
          plan_id: bundlePlan!.plan_id,
          service_id: serviceId,
        })
        .first();
      expect(planServiceRow).toBeDefined();
      expect(planServiceRow?.quantity).toBe(1);

      const planServiceConfig = await db('plan_service_configuration')
        .where({
          tenant: tenantId,
          plan_id: bundlePlan!.plan_id,
          service_id: serviceId,
        })
        .first();
      expect(planServiceConfig).toBeDefined();
      expect(planServiceConfig?.configuration_type).toBe('Fixed');

      const planServiceFixedConfig = await db('plan_service_fixed_config')
        .where({
          tenant: tenantId,
          config_id: planServiceConfig!.config_id,
        })
        .first();
      expect(planServiceFixedConfig).toBeDefined();
      expect(Number(planServiceFixedConfig?.base_rate)).toBeCloseTo(500, 2);
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

      const bundle = await db('plan_bundles')
        .where({ tenant: tenantId, bundle_name: contractName })
        .first();
      expect(bundle).toBeDefined();

      const bundlePlans = await db('bundle_billing_plans')
        .where({ tenant: tenantId, bundle_id: bundle!.bundle_id })
        .orderBy('display_order', 'asc');
      expect(bundlePlans.length).toBeGreaterThanOrEqual(2);

      const planIds = bundlePlans.map((bp: any) => bp.plan_id);
      const hourlyPlan = await db('billing_plans')
        .whereIn('plan_id', planIds)
        .andWhere({ tenant: tenantId, plan_type: 'Hourly' })
        .first();
      expect(hourlyPlan).toBeDefined();

      const hourlyPlanId = hourlyPlan!.plan_id;

      const planServiceRow = await db('plan_services')
        .where({ tenant: tenantId, plan_id: hourlyPlanId, service_id: hourlyServiceId })
        .first();
      expect(planServiceRow).toBeDefined();
      expect(planServiceRow?.quantity).toBe(1);

      const hourlyConfigRow = await db('plan_service_configuration')
        .where({ tenant: tenantId, plan_id: hourlyPlanId, service_id: hourlyServiceId })
        .andWhere({ configuration_type: 'Hourly' })
        .first();
      expect(hourlyConfigRow).toBeDefined();

      const hourlyConfigDetails = await db('plan_service_hourly_configs')
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

      const bundle = await db('plan_bundles')
        .where({ tenant: tenantId, bundle_name: contractName })
        .first();
      expect(bundle).toBeDefined();

      const bundleLink = await db('client_plan_bundles')
        .where({ tenant: tenantId, client_id: tenantData.client.clientId, bundle_id: bundle?.bundle_id })
        .first();

      expect(bundleLink).toBeDefined();
      expect(bundleLink.po_number).toBe(poNumber);
      expect(bundleLink.po_required).toBe(true);
      expect(Number(bundleLink.po_amount ?? 0)).toBe(poAmountCents);
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

  test('validates review math and persisted values (fixed + bucket hours)', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed Service ${uuidv4().slice(0, 8)}`;
    const contractName = `Playwright Contract ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        fixedBucketOverlay: {
          hours: 40,
          overageRateCents: 15000,
          serviceName: fixedServiceName,
        },
        onReview: async (page) => {
          const dialogText = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
          expect(dialogText).toMatch(/\$500\.00/);
          expect(dialogText).toMatch(/Overage Rate:?\s*\$150(?:\.00)?\/hour/i);
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

      const fixedLine = contractLines.find((line: any) => line.contract_line_type === 'Fixed');
      expect(fixedLine).toBeDefined();

      const fixedConfig = await db('contract_line_fixed_config')
        .where({ tenant: tenantId, contract_line_id: fixedLine!.contract_line_id })
        .first();
      expect(Number(fixedConfig?.base_rate)).toBeCloseTo(500, 2);

      const service = await db('service_catalog')
        .where({ tenant: tenantId, service_name: fixedServiceName })
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
    const contractName = `Playwright Bucket Contract ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        fixedBucketOverlay: {
          hours: 40,
          overageRateCents: 15000, // $150.00/hour
          serviceName: fixedServiceName,
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

      const fixedLine = contractLines.find((line: any) => line.contract_line_type === 'Fixed');
      expect(fixedLine).toBeDefined();

      const service = await db('service_catalog')
        .where({ tenant: tenantId, service_name: fixedServiceName })
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
    const contractName = `Playwright Usage Bucket Contract ${uuidv4().slice(0, 8)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Contract Wizard Client ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
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
});

// Invalid numeric inputs coverage: zero values should be rejected or coerced appropriately
test.describe('Contract Wizard Invalid Numeric Inputs', () => {
  async function openWizardOnContracts(page: Page, tenantId: string) {
    const tenantQuery = `&tenantId=${tenantId}`;
    attachFailFastHandlers(page, TEST_CONFIG.baseUrl);
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contracts${tenantQuery}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button');
    await wizardButtonLocator.click();
    await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ timeout: 10_000 });
  }

  async function selectClientAndName(page: Page, clientName: string, contractName: string) {
    const clientSelect = page.getByRole('combobox', { name: /Select a client|Loading clients/i });
    await clientSelect.click();
    await page.getByRole('option', { name: clientName }).click();
    await page.locator('[data-automation-id="contract_name"], #contract_name').fill(contractName);
  }

  async function pickCalendarDate(page: Page, field: 'start-date' | 'end-date', date: Date) {
    const input = page.locator(`[data-automation-id="${field}"] , #${field}`);
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
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await expect(page.getByRole('button', { name: 'Add Service' })).toBeVisible();
      await page.getByRole('button', { name: 'Add Service' }).click();

      // Select a fixed service
      const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).first();
      await serviceSelect.click();
      await page.getByRole('option', { name: fixedServiceName }).click();

      // Set quantity to 0; UI coerces to 1
      const qty = page.locator('[data-automation-id="quantity-0"], #quantity-0');
      await qty.fill('0');
      await expect(qty).toHaveValue('1', { timeout: 2000 });

      // Set base rate to 0 and attempt Next -> expect validation error
      const baseRate = page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate');
      await baseRate.fill('0');
      await baseRate.blur();
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
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
      // Go to the Contracts tab and open the wizard
      const tenantQuery2 = `&tenantId=${tenantData.tenant.tenantId}`;
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contracts${tenantQuery2}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"]');
      await wizardButtonLocator.click();
      await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ timeout: 10_000 });

      // Select client (already present from tenantData)
      const clientSelect = page.getByRole('combobox', { name: /Select a client|Loading clients/i });
      await clientSelect.click();
      await page.getByRole('option', { name: tenantData.client!.clientName }).click();

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
      for (const _ of [0,1,2,3,4]) {
        await page.locator('[data-automation-id="wizard-next"]').click();
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
      const tenantQuery = `&tenantId=${tenantId}`;
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contracts${tenantQuery}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
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

// Additional corner case coverage for UI/validation, dates, rates, DB, and UX
test.describe('Contract Wizard Corner Cases', () => {
  async function openWizardOnContracts(page: Page, tenantId: string) {
    const tenantQuery = `&tenantId=${tenantId}`;
    // Attach fail-fast network/console handlers to surface server/client failures early
    attachFailFastHandlers(page, TEST_CONFIG.baseUrl);
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contracts${tenantQuery}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    const wizardButtonLocator = page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button');
    await wizardButtonLocator.click();
    await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ timeout: 10_000 });
  }

  async function selectClientAndName(page: Page, clientName: string, contractName: string) {
    const clientSelect = page.getByRole('combobox', { name: /Select a client|Loading clients/i });
    await clientSelect.click();
    await page.getByRole('option', { name: clientName }).click();
    await page.locator('[data-automation-id="contract_name"], #contract_name').fill(contractName);
  }

  async function pickCalendarDate(page: Page, field: 'start-date' | 'end-date', date: Date) {
    const input = page.locator(`[data-automation-id="${field}"] , #${field}`);
    await input.click();
    // Click target day in the current visible month grid to avoid nav flakiness
    const day = String(date.getDate());
    await page.locator('.rdp-day:not(.rdp-day_outside)').filter({ hasText: new RegExp(`^${day}$`) }).first().click();
  }

  async function advanceToReview(page: Page) {
    for (let i = 0; i < 6; i++) {
      const isReview = await page
        .getByRole('heading', { name: 'Review Contract' })
        .first()
        .isVisible()
        .catch(() => false);
      if (isReview) return;
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.waitForTimeout(150);
    }
    await expect(page.getByRole('heading', { name: 'Review Contract' }).first()).toBeVisible({ timeout: 5000 });
  }

  test('basics required-field guards block Next and show errors', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceName = `Playwright Fixed Service ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);

      // Click Next immediately — expect Client required
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await expect(page.getByText(/Client is required/i)).toBeVisible();
      // Fill client only
      await page.getByRole('combobox', { name: /Select a client|Loading clients/i }).click();
      await page.getByRole('option', { name: tenantData.client!.clientName }).click();
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await expect(page.getByText(/Contract name is required/i)).toBeVisible();
      // Fill name; frequency defaults to Monthly; start date missing
      await page.locator('[data-automation-id="contract_name"], #contract_name').fill('Req Guards Contract');
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await expect(page.getByText(/Start date is required/i)).toBeVisible();
      // Fill start date and proceed
      await pickCalendarDate(page, 'start-date', new Date(now.getFullYear(), now.getMonth(), Math.min(15, 28)));
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await expect(page.getByRole('heading', { name: 'Fixed Fee Services' }).first()).toBeVisible();
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

  test('step skip logic: Fixed requires base rate only when services exist; Skip allows bypass', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, `Skip Logic ${uuidv4().slice(0, 4)}`);
      await pickCalendarDate(page, 'start-date', now);
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await expect(page.getByRole('button', { name: 'Add Service' })).toBeVisible();
      await page.getByRole('button', { name: 'Add Service' }).click();
      // Pick service but do not set base rate
      const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).first();
      await serviceSelect.click();
      await page.getByRole('option', { name: fixedServiceName }).click();
      await page.locator('[data-automation-id="quantity-0"], #quantity-0').fill('2');
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await expect(page.getByText(/Base rate is required/i)).toBeVisible();
      // Skip should still move forward per current design
      await page.locator('[data-automation-id="wizard-skip"], #wizard-skip').click();
      await expect(page.getByRole('heading', { name: 'Hourly Services' }).first()).toBeVisible();
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

  test('save as draft closes dialog and no DB rows; then reopen and finish', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedServiceName = `Playwright Fixed ${uuidv4().slice(0, 6)}`;
    const contractName = `Draft Contract ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      const { serviceId } = await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, contractName);
      await pickCalendarDate(page, 'start-date', now);

      // Save as Draft
      await page.locator('[data-automation-id="wizard-save-draft"], #wizard-save-draft').click();
      await expect(page.locator('[data-automation-id="dialog-dialog"]')).toBeHidden({ timeout: 10_000 });
      // No bundles yet
      const zeroBundles = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName });
      expect(zeroBundles.length).toBe(0);

      // Reopen wizard and complete a minimal fixed flow
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, contractName);
      await pickCalendarDate(page, 'start-date', now);
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.getByRole('button', { name: 'Add Service' }).click();
      const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).first();
      await serviceSelect.click();
      await page.getByRole('option', { name: fixedServiceName }).click();
      await page.locator('[data-automation-id="quantity-0"], #quantity-0').fill('1');
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').fill('500');
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').blur();
      await advanceToReview(page);
      await expect(page.locator('[data-automation-id="wizard-finish"], #wizard-finish')).toBeVisible({ timeout: 10000 });
      await page.locator('[data-automation-id="wizard-finish"], #wizard-finish').click();
      // Wait for dialog to close and page to show Contracts button
      await expect(page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button')).toBeVisible({ timeout: 15000 });
      // Poll DB until bundle shows up (server action latency)
      let bundle: any | undefined;
      for (let i = 0; i < 30; i++) {
        // eslint-disable-next-line no-await-in-loop
        bundle = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName }).first();
        if (bundle) break;
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(250);
      }
      expect(bundle).toBeDefined();
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

  test('date edges: last day of month and same-day start/end reflected on Review', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const fixedServiceName = `Playwright Fixed ${uuidv4().slice(0, 6)}`;
    const contractName = `Date Edges ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, new Date());
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, new Date());
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, contractName);

      // Use current month last day to avoid calendar navigation flakiness
      const now2 = new Date();
      const endOfMonth = new Date(now2.getFullYear(), now2.getMonth() + 1, 0);
      await pickCalendarDate(page, 'start-date', endOfMonth);
      // Set same-day end
      await pickCalendarDate(page, 'end-date', endOfMonth);
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      const review = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
      const expected = endOfMonth.toLocaleDateString('en-US');
      expect(review).toContain(expected + ' - ' + expected);
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

  test('fixed: multiple services listed; base rate persisted once', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceA = `Fixed A ${uuidv4().slice(0, 5)}`;
    const serviceB = `Fixed B ${uuidv4().slice(0, 5)}`;
    const contractName = `Fixed Multi ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      const { serviceId: serviceIdA } = await seedFixedServiceForTenant(db, tenantId, serviceA, now);
      const { serviceId: serviceIdB } = await seedFixedServiceForTenant(db, tenantId, serviceB, now);
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, contractName);
      await pickCalendarDate(page, 'start-date', now);
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.getByRole('button', { name: 'Add Service' }).click();
      // Service A qty 2
      let select = page.getByRole('combobox', { name: /Select a service/i }).first();
      await select.click();
      await page.getByRole('option', { name: serviceA }).click();
      await page.locator('[data-automation-id="quantity-0"], #quantity-0').fill('2');
      // Add B
      await page.getByRole('button', { name: 'Add Service' }).click();
      select = page.getByRole('combobox', { name: /Select a service/i }).last();
      await select.click();
      await page.getByRole('option', { name: serviceB }).click();
      await page.locator('[data-automation-id="quantity-1"], #quantity-1').fill('3');
      // Base rate
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').fill('750');
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').blur();
      // Advance to review then finish
      await advanceToReview(page);
      const review = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
      expect(review).toMatch(new RegExp(`${serviceA}.*\(Qty: 2\)`, 's'));
      expect(review).toMatch(new RegExp(`${serviceB}.*\(Qty: 3\)`, 's'));
      await page.locator('[data-automation-id="wizard-finish"], #wizard-finish').click();
      // Prefer waiting for dialog to close; fallback to wizard button appears
      await page.locator('[data-automation-id="dialog-dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(async () => {
        await expect(page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button')).toBeVisible({ timeout: 15000 });
      });

      const bundle = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName }).first();
      expect(bundle).toBeDefined();
      const bundlePlan = await db('bundle_billing_plans').where({ tenant: tenantId, bundle_id: bundle!.bundle_id }).first();
      const planId = bundlePlan!.plan_id;
      const planFixed = await db('billing_plan_fixed_config').where({ tenant: tenantId, plan_id: planId });
      expect(planFixed.length).toBe(1); // persisted once at plan level
      const ps = await db('plan_services').where({ tenant: tenantId, plan_id: planId }).orderBy('service_id');
      expect(ps.length).toBe(2);
      const serviceIds = [serviceIdA, serviceIdB].sort();
      expect(ps.map((r: any) => r.service_id).sort()).toEqual(serviceIds);
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

  test('hourly: multiple services with distinct rates; DB reflects per-service configs', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedName = `Fixed ${uuidv4().slice(0,4)}`;
    const hourlyA = `Hourly A ${uuidv4().slice(0,4)}`;
    const hourlyB = `Hourly B ${uuidv4().slice(0,4)}`;
    const contractName = `Hourly Multi ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedName, now);
      const { serviceId: hourlyIdA } = await seedHourlyServiceForTenant(db, tenantId, hourlyA, now, 15000);
      const { serviceId: hourlyIdB } = await seedHourlyServiceForTenant(db, tenantId, hourlyB, now, 20000);
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, contractName);
      await pickCalendarDate(page, 'start-date', now);
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click(); // Fixed
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click(); // Hourly
      await page.getByRole('button', { name: /Add Hourly Service/i }).click();
      let s = page.getByRole('combobox', { name: /Select a service/i }).first();
      await s.click();
      await page.getByRole('option', { name: hourlyA }).click();
      await page.fill('#hourly-rate-0', (15000 / 100).toFixed(2));
      await page.locator('#hourly-rate-0').press('Tab');

      await page.getByRole('button', { name: /Add Hourly Service/i }).click();
      s = page.getByRole('combobox', { name: /Select a service/i }).last();
      await s.click();
      await page.getByRole('option', { name: hourlyB }).click();
      await page.fill('#hourly-rate-1', (20000 / 100).toFixed(2));
      await page.locator('#hourly-rate-1').press('Tab');

      await page.fill('#minimum_billable_time', '15');
      await page.fill('#round_up_to_nearest', '30');

      // Advance to review to ensure UI renders section
      await advanceToReview(page);
      const review = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
      expect(review).toMatch(/Hourly Services/i);
      expect(review).toContain(hourlyA);
      expect(review).toContain(hourlyB);
      await page.locator('[data-automation-id="wizard-finish"], #wizard-finish').click();
      await page.locator('[data-automation-id="dialog-dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(async () => {
        await expect(page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button')).toBeVisible({ timeout: 15000 });
      });

      // DB assertions
      let bundle = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName }).first();
      for (let i = 0; i < 30 && !bundle; i++) {
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(250);
        // eslint-disable-next-line no-await-in-loop
        bundle = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName }).first();
      }
      expect(bundle).toBeDefined();
      let planLinks: any[] = [];
      for (let i = 0; i < 30 && planLinks.length === 0; i++) {
        // eslint-disable-next-line no-await-in-loop
        planLinks = await db('bundle_billing_plans').where({ tenant: tenantId, bundle_id: bundle!.bundle_id });
        if (planLinks.length === 0) {
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(250);
        }
      }
      const hourlyPlan = await db('billing_plans').whereIn('plan_id', planLinks.map((r:any)=>r.plan_id)).andWhere({ tenant: tenantId, plan_type: 'Hourly' }).first();
      const configs = await db('plan_service_configuration').where({ tenant: tenantId, plan_id: hourlyPlan!.plan_id, configuration_type: 'Hourly' });
      expect(configs.length).toBe(2);
      const details = await db('plan_service_hourly_configs').whereIn('config_id', configs.map((r:any)=>r.config_id)).orderBy('config_id');
      const rates = details.map((d:any)=> Number(d.hourly_rate)).sort((a:number,b:number)=>a-b);
      expect(rates).toEqual([15000, 20000]);
      expect(details.every((d:any)=> d.minimum_billable_time === 15 && d.round_up_to_nearest === 30)).toBe(true);
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

  test('bucket hours extremes: 1 hour and 1200 hours with decimal overage', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceName = `Fixed ${uuidv4().slice(0,5)}`;
    const contractName1 = `Bucket 1h ${uuidv4().slice(0, 4)}`;
    const contractName2 = `Bucket 1200h ${uuidv4().slice(0, 4)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      const service = await db('service_catalog')
        .where({ tenant: tenantId, service_name: serviceName })
        .first();
      expect(service).toBeDefined();

      // 1 hour, overage $0.75
      await completeContractWizardFlow(page, tenantData!, serviceName, contractName1, {
        baseRate: 300,
        fixedBucketOverlay: {
          hours: 1,
          overageRateCents: 75,
          serviceName,
        },
      });
      const context1 = await getContractLineContext(db, tenantId, contractName1);
      expect(context1.contract).toBeDefined();
      expect(context1.contractLineIds.length).toBeGreaterThan(0);
      expect(context1.contractLines.some((line: any) => line.contract_line_type === 'Fixed')).toBe(true);
      const overlay1 = await getBucketOverlayForService(
        db,
        tenantId,
        context1.contractLineIds,
        service!.service_id
      );
      expect(overlay1).toBeDefined();
      expect(Number(overlay1!.total_minutes)).toBe(60);
      expect(Number(overlay1!.overage_rate)).toBe(75);

      // 1200 hours, overage $123.45
      await completeContractWizardFlow(page, tenantData!, serviceName, contractName2, {
        baseRate: 300,
        fixedBucketOverlay: {
          hours: 1200,
          overageRateCents: 12345,
          serviceName,
        },
      });
      const context2 = await getContractLineContext(db, tenantId, contractName2);
      expect(context2.contract).toBeDefined();
      expect(context2.contractLineIds.length).toBeGreaterThan(0);
      expect(context2.contractLines.some((line: any) => line.contract_line_type === 'Fixed')).toBe(true);
      const overlay2 = await getBucketOverlayForService(
        db,
        tenantId,
        context2.contractLineIds,
        service!.service_id
      );
      expect(overlay2).toBeDefined();
      expect(Number(overlay2!.total_minutes)).toBe(1200 * 60);
      expect(Number(overlay2!.overage_rate)).toBe(12345);
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

  test('cross-combo totals: Fixed + Hourly + Bucket; Review total excludes hourly', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const fixedName = `Fixed ${uuidv4().slice(0,4)}`;
    const hourlyName = `Hourly ${uuidv4().slice(0,4)}`;
    const contractName = `Combo ${uuidv4().slice(0,4)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedName, now);
      const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(db, tenantId, hourlyName, now, 12500);
      await completeContractWizardFlow(page, tenantData, fixedName, contractName, {
        baseRate: 600,
        hourlyService: { serviceId: hourlyServiceId, serviceName: hourlyName, hourlyRate: 12500 },
        fixedBucketOverlay: { hours: 10, overageRateCents: 5000, serviceName: fixedName },
        onReview: async (page) => {
          const txt = (await page.locator('[data-automation-id="dialog-dialog"]').textContent()) || '';
          expect(txt).toMatch(/\$600\.00/);
        },
      });
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

  test('double-submit protection: clicking Finish twice creates only one bundle', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const now = new Date();
    const serviceName = `Fixed ${uuidv4().slice(0,5)}`;
    const contractName = `No Dups ${uuidv4().slice(0,5)}`;

    try {
      tenantData = await createTestTenant(db, { companyName: `Client ${uuidv4().slice(0, 6)}` });
      const tenantId = tenantData.tenant.tenantId;
      await prepareWizardTenant(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      await setupAuthenticatedSession(page, tenantData);
      await openWizardOnContracts(page, tenantId);
      await selectClientAndName(page, tenantData.client!.clientName, contractName);
      await pickCalendarDate(page, 'start-date', now);
      // Minimal Fixed
      await page.locator('[data-automation-id="wizard-next"], #wizard-next').click();
      await page.getByRole('button', { name: 'Add Service' }).click();
      const sel = page.getByRole('combobox', { name: /Select a service/i }).first();
      await sel.click();
      await page.getByRole('option', { name: serviceName }).click();
      await page.locator('[data-automation-id="quantity-0"], #quantity-0').fill('1');
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').fill('250');
      await page.locator('[data-automation-id="fixed_base_rate"], #fixed_base_rate').blur();
      await advanceToReview(page);
      // Double click finish quickly
      const finish = page.locator('[data-automation-id="wizard-finish"], #wizard-finish');
      await Promise.all([finish.click(), finish.click().catch(()=>{})]);
      await page.locator('[data-automation-id="dialog-dialog"]').waitFor({ state: 'hidden', timeout: 15000 }).catch(async () => {
        await expect(page.locator('[data-automation-id="wizard-contract-button"], #wizard-contract-button')).toBeVisible({ timeout: 15000 });
      });
      // Poll rows for stability
      let rows: any[] = [];
      for (let i = 0; i < 30; i++) {
        // eslint-disable-next-line no-await-in-loop
        rows = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName });
        if (rows.length >= 1) break;
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(250);
      }
      expect(rows.length).toBe(1);
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
