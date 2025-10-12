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

type UIComponentNode = {
  id: string;
  type: string;
  label?: string;
  fieldType?: string;
  options?: Array<{ label: string; value: string }>;
  children?: UIComponentNode[];
};

const TEST_CONFIG = {
  baseUrl: process.env.EE_BASE_URL || 'http://localhost:3000',
};

const EE_SERVER_PATH_SUFFIX = `${path.sep}ee${path.sep}server`;
const WORKSPACE_ROOT = process.cwd().endsWith(EE_SERVER_PATH_SUFFIX)
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();

applyPlaywrightDatabaseEnv();
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';

let adminDb: Knex | null = null;
let databaseReadyPromise: Promise<void> | null = null;

const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

function getSessionMaxAgeSeconds(): number {
  const raw = process.env.NEXTAUTH_SESSION_EXPIRES;
  if (!raw) {
    return DEFAULT_SESSION_MAX_AGE_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? DEFAULT_SESSION_MAX_AGE_SECONDS : parsed;
}

function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

async function setupAuthenticatedSession(
  page: Page,
  tenantData: TenantTestData
): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET must be defined for Playwright auth mocking.');
  }

  // Import encode from @auth/core/jwt to create a proper JWT
  const { encode } = await import('@auth/core/jwt');

  const cookieName = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const sessionUser = {
    id: tenantData.adminUser.userId,
    email: tenantData.adminUser.email.toLowerCase(),
    name: `${tenantData.adminUser.firstName} ${tenantData.adminUser.lastName}`.trim() ||
      tenantData.adminUser.email,
    username: tenantData.adminUser.email.toLowerCase(),
    proToken: 'playwright-mock-token',
    tenant: tenantData.tenant.tenantId,
    user_type: 'internal',
  };

  const maxAge = 60 * 60 * 24; // 24 hours

  // Create a proper JWT token that NextAuth can validate
  const token = await encode({
    token: {
      ...sessionUser,
      sub: sessionUser.id,
    },
    secret,
    maxAge,
    salt: cookieName,
  });

  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + maxAge;

  const context = page.context();

  // Set the properly signed session cookie
  await context.addCookies([
    {
      name: cookieName,
      value: token,
      url: TEST_CONFIG.baseUrl,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: expiresAtSeconds,
    },
  ]);

  console.log('[Playwright Auth] Valid session JWT cookie set');
}


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

async function ensureRoleHasPermission(
  db: Knex,
  tenantId: string,
  roleName: string,
  permissionTuples: Array<{ resource: string; action: string }>
): Promise<void> {
  const role = await db('roles')
    .where({ tenant: tenantId, role_name: roleName })
    .first();

  if (!role) {
    throw new Error(`Role ${roleName} not found for tenant ${tenantId}`);
  }

  for (const { resource, action } of permissionTuples) {
    let permission = await db('permissions')
      .where({ tenant: tenantId, resource, action })
      .first();

    if (!permission) {
      permission = {
        permission_id: uuidv4(),
        tenant: tenantId,
        resource,
        action,
        created_at: new Date(),
      };

      await db('permissions').insert(permission);
    }

    const existingLink = await db('role_permissions')
      .where({
        tenant: tenantId,
        role_id: role.role_id,
        permission_id: permission.permission_id,
      })
      .first();

    if (!existingLink) {
      await db('role_permissions').insert({
        tenant: tenantId,
        role_id: role.role_id,
        permission_id: permission.permission_id,
      });
    }
  }
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

async function seedFixedServiceForTenant(
  db: Knex,
  tenantId: string,
  serviceName: string,
  now: Date
): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4();
  const serviceId = uuidv4();

  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Automation Type ${serviceName}`,
    billing_method: 'fixed',
    is_active: true,
    description: 'Playwright automation service type',
    order_number: 1,
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

  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Hourly Type ${serviceName}`,
    billing_method: 'per_unit',
    is_active: true,
    description: 'Playwright hourly service type',
    order_number: 2,
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
    billing_method: 'per_unit',
    default_rate: defaultRateCents,
    unit_of_measure: 'hour',
    category_id: null,
    tax_rate_id: null,
  });

  return { serviceTypeId, serviceId };
}

async function cleanupContractArtifacts(db: Knex, tenantId: string): Promise<void> {
  await db('user_type_rates').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_hourly_configs').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_fixed_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_service_configuration').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_services').where({ tenant: tenantId }).del().catch(() => {});
  await db('billing_plan_fixed_config').where({ tenant: tenantId }).del().catch(() => {});
  await db('bundle_billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('company_billing_plans').where({ tenant: tenantId }).del().catch(() => {});
  await db('company_plan_bundles').where({ tenant: tenantId }).del().catch(() => {});
  await db('plan_bundles').where({ tenant: tenantId }).del().catch(() => {});
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
  }
): Promise<void> {
  if (!tenantData.company) {
    throw new Error('Tenant does not include a company, cannot complete wizard flow.');
  }

  try {
    attachFailFastHandlers(page, TEST_CONFIG.baseUrl);

    // First, set up the authenticated session with a properly signed JWT
    await setupAuthenticatedSession(page, tenantData);

    // Navigate directly to contracts page - we're already authenticated
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contracts`, {
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

    const clientSelectComponent = await findComponent(
      page,
      (component) => component.id === 'company-select'
    );

    const clientSelectLocator = page.locator(`[data-automation-id="${clientSelectComponent.id}"]`);
    await clientSelectLocator.waitFor({ timeout: 10_000 });
    await page.waitForFunction(
      (componentId) => {
        const element = document.querySelector(
          `[data-automation-id="${componentId}"]`
        ) as HTMLElement | null;
        if (!element) return false;
        return !element.hasAttribute('data-disabled');
      },
      clientSelectComponent.id,
      { timeout: 10_000 }
    );
    await clientSelectLocator.click();
    await page.getByRole('option', { name: tenantData.company.companyName }).click();

    await page.locator('[data-automation-id="contract_name"]').fill(contractName);

    const startDateComponent = await findComponent(
      page,
      (component) => component.id === 'start-date'
    );

    await page.locator(`[data-automation-id="${startDateComponent.id}"]`).click();
    await page.getByRole('gridcell', { name: /\d/ }).first().click();

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

    const remainingHeadings: Array<{ heading: string; buttonId: string }> = [
      { heading: 'Usage-Based Services', buttonId: 'wizard-next' },
      { heading: 'Bucket Services', buttonId: 'wizard-next' },
      { heading: 'Review Contract', buttonId: 'wizard-next' },
    ];

    for (const { heading, buttonId } of remainingHeadings) {
      await page.locator(`[data-automation-id="${buttonId}"]`).click();
      await expect(
        page.getByRole('heading', { name: heading }).first()
      ).toBeVisible({ timeout: 3000 });
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
      await markOnboardingComplete(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

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
      await markOnboardingComplete(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

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
      await markOnboardingComplete(db, tenantId, now);
      const { serviceId } = await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

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
      await markOnboardingComplete(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      const { serviceId: hourlyServiceId } = await seedHourlyServiceForTenant(
        db,
        tenantId,
        hourlyServiceName,
        now,
        hourlyRateCents
      );
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

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
      await markOnboardingComplete(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, serviceName, now);
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

      if (!tenantData.company) {
        throw new Error('Test tenant missing company data required for purchase order verification.');
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

      const companyBundle = await db('company_plan_bundles')
        .where({
          tenant: tenantId,
          company_id: tenantData.company.companyId,
          bundle_id: bundle?.bundle_id,
        })
        .first();

      console.log(companyBundle);

      expect(companyBundle).toBeDefined();
      expect(companyBundle?.po_number).toBe(poNumber);
      expect(companyBundle?.po_required).toBe(true);
      expect(Number(companyBundle?.po_amount ?? 0)).toBe(poAmountCents);
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
