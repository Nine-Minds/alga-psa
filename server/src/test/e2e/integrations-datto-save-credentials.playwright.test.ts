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

// Datto RMM is an Enterprise Edition integration; CE builds never show it.
test.skip(process.env.E2E_EDITION === 'community', 'Datto RMM requires the Enterprise Edition');

async function selectDattoRmmIfSelectorPresent(page: Page): Promise<void> {
  const btn = page.locator('#rmm-integration-row-datto');
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

test('Datto settings can save platform + API key/secret and shows masked credential status', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Datto credentials ${uuidv4().slice(0, 6)}`,
      baseUrl,
    });

    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'read');
    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'update');

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await selectDattoRmmIfSelectorPresent(page);

    // The default platform is a named region, so there is no URL field until Custom URL is chosen.
    await expect(page.locator('#datto-rmm-instance-url')).toHaveCount(0);

    const apiKey = `datto_key_${uuidv4().replace(/-/g, '')}`;
    const apiSecret = `datto_secret_${uuidv4().replace(/-/g, '')}`;
    const last4 = apiKey.slice(-4);

    await page.locator('#datto-rmm-api-key').fill(apiKey);
    await page.locator('#datto-rmm-api-secret').fill(apiSecret);
    await page.locator('#datto-rmm-save-config').click();

    // Save triggers a reload, which clears any transient success banner. Assert on stable persisted UI signals.
    await expect(page.getByText('Status: Configured')).toBeVisible({ timeout: 30_000 });

    // Saved key is masked but keeps the last 4 characters; the secret is never echoed.
    await expect(page.locator('#datto-rmm-api-key')).toHaveAttribute('placeholder', new RegExp(`${last4}$`), { timeout: 30_000 });
    await expect(page.getByText(/Saved:/)).toContainText(last4);
    await expect(page.locator('#datto-rmm-api-secret')).toHaveAttribute('placeholder', /Saved/i);
    await expect(page.locator('#datto-rmm-api-secret')).toHaveValue('');
    await expect(page.locator('#datto-rmm-api-key')).toHaveValue('');

    // Persisted but not yet active: activation needs a successful Test Connection.
    const row = await db('rmm_integrations')
      .where({ tenant: tenantData.tenant.tenantId, provider: 'datto' })
      .first(['instance_url', 'is_active', 'settings']);
    expect(row?.instance_url).toBe('https://merlot-api.centrastage.net/api');
    expect(row?.is_active).toBe(false);
    expect(row?.settings?.platform).toBe('merlot');
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
