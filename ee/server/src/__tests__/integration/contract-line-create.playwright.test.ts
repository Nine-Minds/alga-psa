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
  const openButton = page.locator('[id="add-contract-line-button"]');
  await openButton.waitFor({ state: 'visible' });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await openButton.click();
      await expect(dialogHeading).toBeVisible({ timeout: 10_000 });
      return dialogHeading;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(500);
    }
  }

  throw lastError ?? new Error('Failed to open Add Contract Line dialog');
}

async function navigateToContractLines(page: Page, tenantId: string) {
  const url = `${TEST_CONFIG.baseUrl}/msp/billing?tab=contract-lines&tenantId=${tenantId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Billing Dashboard' })).toBeVisible({ timeout: 15_000 });
}

async function selectFromCustomSelect(page: Page, containerId: string, optionText: string) {
  const container = page.locator(`#${containerId}`);
  const trigger = container.getByRole('combobox').first();
  await trigger.waitFor({ state: 'visible' });
  await trigger.click();
  await page.getByRole('option', { name: optionText }).click();
}

async function clickDialogBackdrop(page: Page) {
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

test.describe('ContractLine creation', () => {
  test.setTimeout(180_000); // Allow time for first-run migrations

  test('creates a fixed contract line with proration configuration', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const planName = `Fixed Line ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Fixed Contract Line ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'create');
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'update');
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);
      await navigateToContractLines(page, tenantData.tenant.tenantId);

      const dialogHeading = await openAddContractLineDialog(page);
      await page.locator('#name').fill(planName);
      await selectFromCustomSelect(page, 'frequency', 'Annually');

      await page.getByRole('button', { name: 'Fixed Fee' }).click();
      await page.locator('#base-rate').fill('1999');
      await page.getByLabel('Enable Proration').click();
      await selectFromCustomSelect(page, 'alignment', 'End of Billing Cycle');

      await page.locator('#contract-line-submit').click();
      await expect(dialogHeading).toBeHidden({ timeout: 10_000 });

      await expect(page.getByText(planName)).toBeVisible({ timeout: 10_000 });

      const contractLine = await db('contract_lines')
        .where({
          contract_line_name: planName,
          tenant: tenantData.tenant.tenantId,
        })
        .first();

      expect(contractLine).toBeTruthy();
      expect(contractLine.contract_line_type).toBe('Fixed');
      expect(contractLine.billing_frequency).toBe('annually');
      expect(contractLine.is_custom).toBe(false);

      const fixedConfig = await db('contract_line_fixed_config')
        .where({
          contract_line_id: contractLine.contract_line_id,
          tenant: tenantData.tenant.tenantId,
        })
        .first();

      expect(fixedConfig).toBeTruthy();
      expect(Number(fixedConfig.base_rate)).toBe(1999);
      expect(fixedConfig.enable_proration).toBe(true);
      expect(fixedConfig.billing_cycle_alignment).toBe('end');
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

  test('creates an hourly contract line marked as custom', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const planName = `Hourly Line ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Hourly Contract Line ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'create');
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'update');
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);
      await navigateToContractLines(page, tenantData.tenant.tenantId);

      const dialogHeading = await openAddContractLineDialog(page);
      await page.locator('#name').fill(planName);
      await page.getByLabel('Custom Line').click();
      await page.getByRole('button', { name: 'Time & Materials' }).click();
      await selectFromCustomSelect(page, 'frequency', 'Monthly');

      await page.locator('#contract-line-submit').click();
      await expect(dialogHeading).toBeHidden({ timeout: 10_000 });
      await expect(page.getByText(planName)).toBeVisible({ timeout: 10_000 });

      const contractLine = await db('contract_lines')
        .where({
          contract_line_name: planName,
          tenant: tenantData.tenant.tenantId,
        })
        .first();

      expect(contractLine).toBeTruthy();
      expect(contractLine.contract_line_type).toBe('Hourly');
      expect(contractLine.billing_frequency).toBe('monthly');
      expect(contractLine.is_custom).toBe(true);

      const fixedConfig = await db('contract_line_fixed_config')
        .where({
          contract_line_id: contractLine.contract_line_id,
          tenant: tenantData.tenant.tenantId,
        })
        .first();

      expect(fixedConfig).toBeFalsy();
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

  test('creates a usage-based contract line', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    const planName = `Usage Line ${uuidv4().slice(0, 6)}`;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Usage Contract Line ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'create');
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'update');
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);
      await navigateToContractLines(page, tenantData.tenant.tenantId);

      const dialogHeading = await openAddContractLineDialog(page);
      await page.locator('#name').fill(planName);
      await selectFromCustomSelect(page, 'frequency', 'Quarterly');
      await page.getByRole('button', { name: 'Usage-Based' }).click();

      await page.locator('#contract-line-submit').click();
      await expect(dialogHeading).toBeHidden({ timeout: 10_000 });
      await expect(page.getByText(planName)).toBeVisible({ timeout: 10_000 });

      const contractLine = await db('contract_lines')
        .where({
          contract_line_name: planName,
          tenant: tenantData.tenant.tenantId,
        })
        .first();

      expect(contractLine).toBeTruthy();
      expect(contractLine.contract_line_type).toBe('Usage');
      expect(contractLine.billing_frequency).toBe('quarterly');
      expect(contractLine.is_custom).toBe(false);
    } finally {
      if (tenantData) {
        await rollbackTenant(db, tenantData.tenant.tenantId).catch(() => {});
      }
      await db.destroy();
    }
  });

  test('blocks submission when required information is missing', async ({ page }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTestTenant(db, {
        companyName: `Validation Contract Line ${uuidv4().slice(0, 6)}`,
      });

      await markOnboardingComplete(db, tenantData.tenant.tenantId, new Date());
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'create');
      await ensurePermission(db, tenantData.tenant.tenantId, 'billing', 'update');
      await establishTenantSession(page, tenantData, TEST_CONFIG.baseUrl);
      await navigateToContractLines(page, tenantData.tenant.tenantId);

      const dialogHeading = await openAddContractLineDialog(page);
      await page.locator('#contract-line-submit').click();

      await expect(
        page.getByText('Please correct the following:')
      ).toBeVisible({ timeout: 5_000 });

      const [{ count }] = await db('contract_lines')
        .where({
          tenant: tenantData.tenant.tenantId,
        })
        .count('* as count');

      expect(Number(count)).toBe(0);
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

async function ensurePermission(db: Knex, tenantId: string, resource: string, action: string): Promise<void> {
  const role = await db('roles')
    .where({ tenant: tenantId, role_name: 'Admin' })
    .first();

  if (!role) {
    throw new Error(`Admin role not found for tenant ${tenantId}`);
  }

  let permission = await db('permissions')
    .where({ tenant: tenantId, resource, action })
    .first();

  if (!permission) {
    const permissionId = uuidv4();
    await db('permissions').insert({
      permission_id: permissionId,
      tenant: tenantId,
      resource,
      action,
    });
    permission = await db('permissions')
      .where({ permission_id: permissionId })
      .first();
  }

  const existing = await db('role_permissions')
    .where({ role_id: role.role_id, permission_id: permission.permission_id })
    .first();

  if (!existing) {
    await db('role_permissions')
      .insert({
        role_id: role.role_id,
        permission_id: permission.permission_id,
        tenant: tenantId,
      })
      .onConflict(['role_id', 'permission_id', 'tenant'])
      .ignore();
  }
}
