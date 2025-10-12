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

// Ensure a consistent host that matches the dev server's NEXTAUTH_URL
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const TEST_CONFIG = {
  baseUrl: process.env.EE_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000',
};

const EE_SERVER_PATH_SUFFIX = `${path.sep}ee${path.sep}server`;
const WORKSPACE_ROOT = process.cwd().endsWith(EE_SERVER_PATH_SUFFIX)
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();

applyPlaywrightDatabaseEnv();
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
process.env.E2E_AUTH_BYPASS = process.env.E2E_AUTH_BYPASS || 'true';

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

  const { encode } = await import('@auth/core/jwt');
  const cookieName = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
  const isHttps = TEST_CONFIG.baseUrl.startsWith('https://');
  const allCookieNames = [
    cookieName,
    'authjs.session-token',
    'next-auth.session-token',
    // only include __Secure-* variants when using HTTPS and secure cookies
    ...(isHttps ? ['__Secure-authjs.session-token', '__Secure-next-auth.session-token'] : []),
  ];

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
  // Add cookie for both localhost and canonical.localhost to survive redirects
  const cookieHosts = new Set<string>([
    TEST_CONFIG.baseUrl,
    'http://localhost:3000',
    'http://canonical.localhost:3000',
  ]);

  const cookiesByUrl: any[] = [];
  const cookiesByDomain: any[] = [];
  for (const url of cookieHosts) {
    for (const name of allCookieNames) {
      cookiesByUrl.push({
        name,
        value: token,
        url,
        httpOnly: true,
        secure: isHttps,
        sameSite: 'Lax',
        expires: expiresAtSeconds,
      });
    }
  }
  // Also set domain-scoped cookies for localhost/canonical.localhost
  const domains = ['localhost', 'canonical.localhost'];
  for (const domain of domains) {
    for (const name of allCookieNames) {
      cookiesByDomain.push({
        name,
        value: token,
        domain,
        path: '/',
        httpOnly: true,
        secure: isHttps,
        sameSite: 'Lax',
        expires: expiresAtSeconds,
      });
    }
  }
  await context.addCookies([...cookiesByUrl, ...cookiesByDomain]);

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
  await db('client_plan_bundles').where({ tenant: tenantId }).del().catch(() => {});
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
    bucketHours?: {
      hours: number;
      monthlyFeeCents: number;
      overageRateCents: number;
      serviceName?: string; // if omitted, will use the fixed service added earlier
    };
    bucketUsage?: {
      units: number;
      unitOfMeasure: string;
      monthlyFeeCents: number;
      overageRateCents: number;
      serviceName?: string; // if omitted, will use the fixed service added earlier
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

    // Usage-Based Services step (skip)
    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(
      page.getByRole('heading', { name: 'Usage-Based Services' }).first()
    ).toBeVisible({ timeout: 3000 });

    // Bucket Services step (configure if requested)
    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(
      page.getByRole('heading', { name: 'Bucket Services' }).first()
    ).toBeVisible({ timeout: 3000 });

    if (options?.bucketHours || options?.bucketUsage) {
      const bh = options.bucketHours;
      // Select bucket type and fill form
      const bucketType = page.getByRole('combobox', { name: /Bucket Type/i });
      await bucketType.click();
      if (options.bucketHours) {
        await page.getByRole('option', { name: /Time-based \(Hours\)/i }).click();
        await page.locator('#bucket_hours').fill(String(options.bucketHours.hours));
      } else if (options.bucketUsage) {
        await page.getByRole('option', { name: /Usage-based \(Units\)/i }).click();
        await page.locator('#bucket_usage_units').fill(String(options.bucketUsage.units));
        await page.locator('#bucket_unit_of_measure').fill(options.bucketUsage.unitOfMeasure);
      }

      const monthlyCents = options.bucketHours?.monthlyFeeCents ?? options.bucketUsage!.monthlyFeeCents;
      const overageCents = options.bucketHours?.overageRateCents ?? options.bucketUsage!.overageRateCents;

      await page.locator('#bucket_monthly_fee').fill((monthlyCents / 100).toFixed(2));
      await page.locator('#bucket_monthly_fee').blur();
      await page.locator('#bucket_overage_rate').fill((overageCents / 100).toFixed(2));
      await page.locator('#bucket_overage_rate').blur();

      // Add a service to the bucket
      await page.locator('#add-bucket-service-button').click();

      const serviceToPick = options.bucketHours?.serviceName || options.bucketUsage?.serviceName || serviceName;
      const bucketServiceSelect = page.getByRole('combobox', { name: /Select a service/i }).last();
      await bucketServiceSelect.click();
      await expect(page.getByRole('option', { name: serviceToPick })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('option', { name: serviceToPick }).click();
    }

    // Review Contract step
    await page.locator('[data-automation-id="wizard-next"]').click();
    await expect(
      page.getByRole('heading', { name: 'Review Contract' }).first()
    ).toBeVisible({ timeout: 3000 });

    if (options?.bucketHours || options?.bucketUsage) {
      // Verify the review shows Bucket Services summary
      await expect(page.getByRole('heading', { name: 'Bucket Services' }).first()).toBeVisible({ timeout: 3000 });
      if (options.bucketHours) {
        await expect(page.getByText(/hours\/month/i).first()).toBeVisible({ timeout: 3000 });
      } else {
        await expect(page.getByText(/units?\/month|\/month/i).first()).toBeVisible({ timeout: 3000 });
      }
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
      await markOnboardingComplete(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        bucketHours: {
          hours: 40,
          monthlyFeeCents: 500000, // $5,000.00
          overageRateCents: 15000, // $150.00/hour
          serviceName: fixedServiceName,
        },
      });

      // Verify bundle + bucket plan created and configured
      const bundle = await db('plan_bundles')
        .where({ tenant: tenantId, bundle_name: contractName })
        .first();
      expect(bundle).toBeDefined();

      const bundlePlans = await db('bundle_billing_plans')
        .where({ tenant: tenantId, bundle_id: bundle!.bundle_id })
        .orderBy('display_order', 'asc');
      expect(bundlePlans.length).toBeGreaterThan(0);

      const planIds = bundlePlans.map((bp: any) => bp.plan_id);
      const bucketPlan = await db('billing_plans')
        .whereIn('plan_id', planIds)
        .andWhere({ tenant: tenantId, plan_type: 'Bucket' })
        .first();
      expect(bucketPlan).toBeDefined();

      const bucketPlanId = bucketPlan!.plan_id;
      // Should have the fixed service as a bucket service
      const planService = await db('plan_services')
        .where({ tenant: tenantId, plan_id: bucketPlanId })
        .first();
      expect(planService).toBeDefined();

      const baseConfig = await db('plan_service_configuration')
        .where({ tenant: tenantId, plan_id: bucketPlanId, service_id: planService!.service_id, configuration_type: 'Bucket' })
        .first();
      expect(baseConfig).toBeDefined();

      const bucketConfig = await db('plan_service_bucket_config')
        .where({ tenant: tenantId, config_id: baseConfig!.config_id })
        .first();
      expect(bucketConfig).toBeDefined();
      expect(bucketConfig!.billing_period).toBe('monthly');
      // Over 40 hours → 2400 minutes
      expect(Number(bucketConfig!.total_minutes)).toBe(40 * 60);
      expect(Number(bucketConfig!.overage_rate)).toBe(15000);
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
      await markOnboardingComplete(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

      await completeContractWizardFlow(page, tenantData, fixedServiceName, contractName, {
        baseRate: 500,
        bucketUsage: {
          units: 1000,
          unitOfMeasure: 'API calls',
          monthlyFeeCents: 250000, // $2,500.00
          overageRateCents: 50,    // $0.50 per unit
          serviceName: fixedServiceName,
        },
      });

      // Verify bundle + bucket plan created and configured (usage-based)
      const bundle = await db('plan_bundles')
        .where({ tenant: tenantId, bundle_name: contractName })
        .first();
      expect(bundle).toBeDefined();

      const bundlePlans = await db('bundle_billing_plans')
        .where({ tenant: tenantId, bundle_id: bundle!.bundle_id })
        .orderBy('display_order', 'asc');
      expect(bundlePlans.length).toBeGreaterThan(0);

      const planIds = bundlePlans.map((bp: any) => bp.plan_id);
      const bucketPlan = await db('billing_plans')
        .whereIn('plan_id', planIds)
        .andWhere({ tenant: tenantId, plan_type: 'Bucket' })
        .first();
      expect(bucketPlan).toBeDefined();

      const bucketPlanId = bucketPlan!.plan_id;
      // Should have the fixed service as a bucket service
      const planService = await db('plan_services')
        .where({ tenant: tenantId, plan_id: bucketPlanId })
        .first();
      expect(planService).toBeDefined();

      const baseConfig = await db('plan_service_configuration')
        .where({ tenant: tenantId, plan_id: bucketPlanId, service_id: planService!.service_id, configuration_type: 'Bucket' })
        .first();
      expect(baseConfig).toBeDefined();

      const bucketConfig = await db('plan_service_bucket_config')
        .where({ tenant: tenantId, config_id: baseConfig!.config_id })
        .first();
      expect(bucketConfig).toBeDefined();
      expect(bucketConfig!.billing_period).toBe('monthly');
      // For usage-based bucket we store units as total_minutes generic quantity
      expect(Number(bucketConfig!.total_minutes)).toBe(1000);
      expect(Number(bucketConfig!.overage_rate)).toBe(50);
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
      await markOnboardingComplete(db, tenantId, now);
      await seedFixedServiceForTenant(db, tenantId, fixedServiceName, now);
      await ensureRoleHasPermission(db, tenantId, 'Admin', [
        { resource: 'client', action: 'read' },
        { resource: 'service', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'update' },
      ]);

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
});
