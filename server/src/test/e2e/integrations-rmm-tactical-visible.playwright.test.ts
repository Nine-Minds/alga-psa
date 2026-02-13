import { expect, test } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  applyTestEnvDefaults,
  createTenantAndLogin,
  createTestDbConnection,
  getBaseUrl,
  type TenantTestData,
} from './helpers/testSetup';

applyTestEnvDefaults();

async function ensureSystemSettingsReadPermission(db: Knex, tenantId: string): Promise<void> {
  const role = await db('roles')
    .where({ tenant: tenantId, role_name: 'Test Admin' })
    .first(['role_id']);

  if (!role?.role_id) {
    throw new Error('Test Admin role not found for tenant');
  }

  const existingPermission = await db('permissions')
    .where({
      tenant: tenantId,
      resource: 'system_settings',
      action: 'read',
      msp: true,
      client: false,
    })
    .first(['permission_id']);

  const permissionId = existingPermission?.permission_id ?? uuidv4();

  if (!existingPermission) {
    await db('permissions').insert({
      permission_id: permissionId,
      tenant: tenantId,
      resource: 'system_settings',
      action: 'read',
      msp: true,
      client: false,
    });
  }

  const existingRolePermission = await db('role_permissions')
    .where({
      tenant: tenantId,
      role_id: role.role_id,
      permission_id: permissionId,
    })
    .first(['permission_id']);

  if (!existingRolePermission) {
    await db('role_permissions').insert({
      tenant: tenantId,
      role_id: role.role_id,
      permission_id: permissionId,
    });
  }
}

test('Integrations Settings -> RMM shows Tactical RMM in CE build', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Integrations ${uuidv4().slice(0, 6)}`,
      baseUrl,
    });

    await ensureSystemSettingsReadPermission(db, tenantData.tenant.tenantId);

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await expect(page.getByRole('heading', { name: 'RMM Integrations' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Tactical RMM', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await db.destroy().catch(() => undefined);
  }
});

