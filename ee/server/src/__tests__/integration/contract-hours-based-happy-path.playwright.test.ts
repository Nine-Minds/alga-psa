/**
 * Playwright happy path focused on creating an Hours-based (Hourly) contract line via the wizard.
 */

import { expect, Page, test } from '@playwright/test';
import type { Knex } from 'knex';
import { knex as createKnex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { encode } from '@auth/core/jwt';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant, type TenantTestData } from '../../lib/testing/tenant-test-factory';

// Ensure hashing utilities can retrieve an encryption key
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';

const TEST_CONFIG = {
  baseUrl: process.env.EE_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000',
};

type UIComponentNode = {
  id: string;
  type: string;
  label?: string;
  fieldType?: string;
  options?: Array<{ label: string; value: string }>;
  children?: UIComponentNode[];
};

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
  if (!nodes) return null;
  for (const node of nodes) {
    if (predicate(node)) return node;
    const child = dfsFindComponent(node.children, predicate);
    if (child) return child;
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
    if (match) return match;
    await page.waitForTimeout(delayMs);
  }
  throw new Error('UI component not found');
}

async function setupAuthenticatedSession(page: Page, tenantData: TenantTestData): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  const cookieName = process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';

  const sessionUser = {
    id: tenantData.adminUser.userId,
    email: tenantData.adminUser.email.toLowerCase(),
    name: `${tenantData.adminUser.firstName} ${tenantData.adminUser.lastName}`.trim() || tenantData.adminUser.email,
    username: tenantData.adminUser.email.toLowerCase(),
    proToken: 'playwright-mock-token',
    tenant: tenantData.tenant.tenantId,
    user_type: 'internal',
  };

  const token = await encode({
    token: { ...sessionUser, sub: sessionUser.id },
    secret,
    maxAge: 60 * 60,
    salt: cookieName,
  });

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + 60 * 60;
  await page.context().addCookies([
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
    .merge({ onboarding_completed: true, onboarding_completed_at: now, onboarding_skipped: false, updated_at: now });
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

async function ensureRoleHasPermission(
  db: Knex,
  tenantId: string,
  roleName: string,
  permissionTuples: Array<{ resource: string; action: string }>
): Promise<void> {
  const role = await db('roles').where({ tenant: tenantId, role_name: roleName }).first();
  if (!role) throw new Error(`Role ${roleName} not found for tenant ${tenantId}`);

  for (const { resource, action } of permissionTuples) {
    let permission = await db('permissions').where({ tenant: tenantId, resource, action }).first();
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
    const link = await db('role_permissions')
      .where({ tenant: tenantId, role_id: role.role_id, permission_id: permission.permission_id })
      .first();
    if (!link) {
      await db('role_permissions').insert({ tenant: tenantId, role_id: role.role_id, permission_id: permission.permission_id });
    }
  }
}

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
    tenantData = await createTestTenant(db, {
      companyName: `Hourly Contract Client ${uuidv4().slice(0, 6)}`,
    });
    const tenantId = tenantData.tenant.tenantId;
    await markOnboardingComplete(db, tenantId, now);
    await seedHourlyServiceForTenant(db, tenantId, serviceName, now, hourlyRateCents);
    await ensureRoleHasPermission(db, tenantId, 'Admin', [
      { resource: 'client', action: 'read' },
      { resource: 'billing', action: 'create' },
      { resource: 'billing', action: 'update' },
    ]);

    // Auth
    await setupAuthenticatedSession(page, tenantData);

    // Go to Contracts tab
    await page.goto(`${TEST_CONFIG.baseUrl}/msp/billing?tab=contracts`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Open wizard
    await page.locator('[data-automation-id="wizard-contract-button"]').click();
    await page.locator('[data-automation-id="contract-basics-step"]').waitFor({ state: 'attached', timeout: 10000 });
    await waitForUIState(page);

    // Select client
    const clientSelect = page.getByRole('combobox', { name: /Select a client|Loading clients/i });
    await clientSelect.click();
    await page.getByRole('option', { name: tenantData.client!.clientName }).click();

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

    // Add Hourly Service and configure
    await page.getByRole('button', { name: /Add Hourly Service/i }).click();
    const serviceSelect = page.getByRole('combobox', { name: /Select a service/i }).last();
    await serviceSelect.click();
    await page.getByRole('option', { name: serviceName }).click();
    await page.fill('#hourly-rate-0', (hourlyRateCents / 100).toFixed(2));
    await page.locator('#hourly-rate-0').press('Tab');
    await page.fill('#minimum_billable_time', String(minimumBillableTime));
    await page.fill('#round_up_to_nearest', String(roundUpMinutes));

    // Proceed through remaining steps
    const remaining: string[] = ['Usage-Based Services', 'Bucket Services', 'Review Contract'];
    for (const heading of remaining) {
      await page.locator('[data-automation-id="wizard-next"]').click();
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 3000 });
    }

    await expect(page.locator(`text=${serviceName}`).first()).toBeVisible({ timeout: 3000 });

    // Finish
    await page.locator('[data-automation-id="wizard-finish"]').click();
    await expect(page.locator('[data-automation-id="wizard-finish"]')).toBeHidden({ timeout: 10000 });

    // Validate DB
    const bundle = await db('plan_bundles').where({ tenant: tenantId, bundle_name: contractName }).first();
    expect(bundle).toBeDefined();

    const linkTable = (await db.schema.hasTable('client_plan_bundles')) ? 'client_plan_bundles' : 'company_plan_bundles';
    const link = await db(linkTable)
      .where({ tenant: tenantId, bundle_id: bundle.bundle_id })
      .first();
    expect(link).toBeDefined();

    const hourlyPlan = await db('billing_plans')
      .where({ tenant: tenantId, plan_type: 'Hourly' })
      .orderBy('created_at', 'desc')
      .first();
    expect(hourlyPlan).toBeDefined();

    const ps = await db('plan_services').where({ tenant: tenantId, plan_id: hourlyPlan.plan_id }).first();
    expect(ps).toBeDefined();

    const hourlyConfig = await db('plan_service_hourly_configs')
      .where({ tenant: tenantId, config_id: db('plan_service_configuration').where({ tenant: tenantId, plan_id: hourlyPlan.plan_id }).first().select('config_id') })
      .first()
      .catch(() => null);

    // If subquery approach above is not supported by the DB client, do a two-step fetch
    let hourlyConfigRow = hourlyConfig;
    if (!hourlyConfigRow) {
      const configRow = await db('plan_service_configuration')
        .where({ tenant: tenantId, plan_id: hourlyPlan.plan_id, configuration_type: 'Hourly' })
        .first();
      expect(configRow).toBeDefined();
      hourlyConfigRow = await db('plan_service_hourly_configs')
        .where({ tenant: tenantId, config_id: configRow!.config_id })
        .first();
    }
    expect(hourlyConfigRow).toBeDefined();
    expect(Number(hourlyConfigRow!.hourly_rate)).toBe(hourlyRateCents);
    expect(hourlyConfigRow!.minimum_billable_time).toBe(minimumBillableTime);
    expect(hourlyConfigRow!.round_up_to_nearest).toBe(roundUpMinutes);
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
