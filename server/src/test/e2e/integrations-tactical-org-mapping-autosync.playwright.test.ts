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

async function waitForAutoSync(
  db: Knex,
  tenant: string,
  mappingId: string,
  expected: boolean,
  timeoutMs = 20_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await db('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
      .first(['auto_sync_assets']);
    if (Boolean(row?.auto_sync_assets) === expected) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for auto_sync_assets to persist');
}

test('Org mapping UI toggles auto-sync and persists auto_sync_assets', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Tactical Org AutoSync ${uuidv4().slice(0, 6)}`,
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
      client_id: tenantData.client!.clientId,
      auto_sync_assets: false,
      auto_create_tickets: false,
      metadata: { id: 1, name: 'Org One' },
    });

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await selectTacticalRmmIfSelectorPresent(page);

    await expect(page.getByText('Org One')).toBeVisible({ timeout: 30_000 });

    const toggle = page.locator(`#tacticalrmm-org-autosync-${mappingId}`);
    // Toggle on, then refresh mappings so the UI reflects persisted DB state (not just local switch state).
    await toggle.click();
    await page.locator('#tacticalrmm-refresh-mappings').click();
    await expect(toggle).toHaveAttribute('data-state', 'checked', { timeout: 30_000 });
    await waitForAutoSync(db, tenantData.tenant.tenantId, mappingId, true, 30_000);

    // Toggle back to false to ensure the UI can persist both states.
    await toggle.click();
    await page.locator('#tacticalrmm-refresh-mappings').click();
    await expect(toggle).toHaveAttribute('data-state', 'unchecked', { timeout: 30_000 });
    await waitForAutoSync(db, tenantData.tenant.tenantId, mappingId, false, 30_000);
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
