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

async function waitForMappingClientId(
  db: Knex,
  tenant: string,
  mappingId: string,
  expectedClientId: string,
  timeoutMs = 20_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await db('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
      .first(['client_id']);
    if (row?.client_id === expectedClientId) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for org mapping client_id to persist');
}

test('Org mapping UI assigns an Alga Client to a Tactical org mapping and persists client_id', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Tactical Org Map ${uuidv4().slice(0, 6)}`,
      baseUrl,
    });

    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'read');
    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'update');

    const integrationId = uuidv4();
    await db('rmm_integrations').insert({
      tenant: tenantData.tenant.tenantId,
      integration_id: integrationId,
      provider: 'tacticalrmm',
      instance_url: 'https://tactical.example',
      settings: { auth_mode: 'api_key' },
      is_active: false,
    });

    const mappingId = uuidv4();
    await db('rmm_organization_mappings').insert({
      tenant: tenantData.tenant.tenantId,
      mapping_id: mappingId,
      integration_id: integrationId,
      external_organization_id: '1',
      external_organization_name: 'Org One',
      client_id: null,
      auto_sync_assets: true,
      auto_create_tickets: false,
      metadata: { id: 1, name: 'Org One' },
    });

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    // Ensure org mapping row is rendered.
    await expect(page.getByText('Org One')).toBeVisible({ timeout: 30_000 });

    const pickerId = `tacticalrmm-org-client-picker-${mappingId}`;
    await page.locator(`#${pickerId}-trigger`).click();

    await page
      .locator(`#${pickerId}-option-${tenantData.client!.clientId}`)
      .click();

    // UI should reflect the chosen client.
    await expect(page.locator(`#${pickerId}-trigger`)).toContainText(
      tenantData.client!.clientName,
      { timeout: 30_000 }
    );

    // And DB should persist it.
    await waitForMappingClientId(
      db,
      tenantData.tenant.tenantId,
      mappingId,
      tenantData.client!.clientId
    );
  } finally {
    await db.destroy().catch(() => undefined);
  }
});

