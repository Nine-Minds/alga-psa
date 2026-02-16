import { expect, test, type Page } from '@playwright/test';
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

async function selectTacticalRmmIfSelectorPresent(page: Page): Promise<void> {
  const btn = page.locator('#rmm-integration-configure-tacticalrmm');
  if (await btn.count()) {
    await btn.click();
  }
}

async function ensureSystemSettingsPermission(
  db: Knex,
  tenantId: string,
  action: 'read' | 'update'
): Promise<void> {
  const role = await db('roles')
    .where({ tenant: tenantId, role_name: 'Test Admin' })
    .first(['role_id']);

  if (!role?.role_id) {
    throw new Error('Test Admin role not found for tenant');
  }

  let permission = await db('permissions')
    .where({
      tenant: tenantId,
      resource: 'system_settings',
      action,
      msp: true,
      client: false,
    })
    .first(['permission_id']);

  if (!permission) {
    const permissionId = uuidv4();
    await db('permissions').insert({
      permission_id: permissionId,
      tenant: tenantId,
      resource: 'system_settings',
      action,
      msp: true,
      client: false,
    });
    permission = { permission_id: permissionId };
  }

  const existingLink = await db('role_permissions')
    .where({
      tenant: tenantId,
      role_id: role.role_id,
      permission_id: permission.permission_id,
    })
    .first(['permission_id']);

  if (!existingLink) {
    await db('role_permissions').insert({
      tenant: tenantId,
      role_id: role.role_id,
      permission_id: permission.permission_id,
    });
  }
}

test('Tactical settings can save instance URL + API key and shows masked credential status', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Tactical API key ${uuidv4().slice(0, 6)}`,
      baseUrl,
    });

    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'read');
    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'update');

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await selectTacticalRmmIfSelectorPresent(page);

    await page.locator('#tacticalrmm-instance-url').fill('https://tactical.example.test');

    const apiKey = `alga_test_${uuidv4().replace(/-/g, '')}`;
    const last4 = apiKey.slice(-4);

    await page.locator('#tacticalrmm-api-key').fill(apiKey);
    await page.locator('#tacticalrmm-save-config').click();

    // Save triggers a reload, which clears any transient success banner. Assert on stable persisted UI signals.
    await expect(page.getByText('Status: Configured')).toBeVisible({ timeout: 30_000 });

    // Saved status should be masked but preserve last 4 chars.
    await expect(page.locator('#tacticalrmm-api-key')).toHaveAttribute('placeholder', new RegExp(`${last4}$`), { timeout: 30_000 });
    await expect(page.getByText(/Saved:/)).toContainText(last4);
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
