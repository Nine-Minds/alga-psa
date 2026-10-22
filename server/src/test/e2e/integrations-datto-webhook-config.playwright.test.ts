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

test('Datto webhook config UI shows the custom header, secret, and body templates', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Datto Webhook UI ${uuidv4().slice(0, 6)}`,
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

    const url = page.locator('#datto-rmm-webhook-url');
    await url.scrollIntoViewIfNeeded();
    // The tenant travels in the query; the secret never does.
    await expect(url).toHaveValue(
      new RegExp(`/api/webhooks/datto\\?tenant=${tenantData.tenant.tenantId}$`),
      { timeout: 30_000 }
    );

    const headerName = page.locator('#datto-rmm-webhook-header-name');
    await headerName.scrollIntoViewIfNeeded();
    await expect(headerName).toHaveValue('X-Alga-Webhook-Secret', { timeout: 30_000 });

    // The secret is generated on first view, masked by default, and revealable.
    const secret = page.locator('#datto-rmm-webhook-secret');
    await expect(secret).toHaveAttribute('type', 'password');
    await expect(secret).toHaveValue(/^[0-9a-f]{48}$/);
    await page.locator('#datto-rmm-toggle-webhook-secret').click();
    await expect(secret).toHaveAttribute('type', 'text');

    const body = page.locator('#datto-rmm-webhook-body-template');
    await body.scrollIntoViewIfNeeded();
    await expect(body).toHaveValue(/"alertUid"/i, { timeout: 30_000 });
    await expect(body).toHaveValue(/"event": "trigger"/);

    const resolveBody = page.locator('#datto-rmm-webhook-resolve-body-template');
    await expect(resolveBody).toHaveValue(/"event": "resolve"/);

    // The same secret is returned on the next load rather than regenerated.
    const firstSecret = await secret.inputValue();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await selectDattoRmmIfSelectorPresent(page);
    await expect(page.locator('#datto-rmm-webhook-secret')).toHaveValue(firstSecret, { timeout: 30_000 });
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
