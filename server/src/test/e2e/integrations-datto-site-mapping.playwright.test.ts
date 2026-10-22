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

async function waitForMappingColumn(
  db: Knex,
  tenant: string,
  mappingId: string,
  column: 'default_contact_id' | 'auto_sync_assets',
  expected: unknown,
  timeoutMs = 20_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await db('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
      .first([column]);
    if (row?.[column] === expected) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for site mapping ${column} to persist`);
}

test('Site mapping UI applies the suggested client, then sets a default contact and auto-sync, and persists them', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Datto Site Map ${uuidv4().slice(0, 6)}`,
      baseUrl,
    });

    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'read');
    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'update');

    // A contact on the client, for the default-contact picker.
    const contactId = uuidv4();
    await db('contacts').insert({
      contact_name_id: contactId,
      tenant: tenantData.tenant.tenantId,
      full_name: 'Datto Default Contact',
      email: `datto-contact-${contactId.slice(0, 8)}@example.test`,
      client_id: tenantData.client!.clientId,
      is_inactive: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const integrationId = uuidv4();
    await db('rmm_integrations').insert({
      tenant: tenantData.tenant.tenantId,
      integration_id: integrationId,
      provider: 'datto',
      instance_url: 'https://merlot-api.centrastage.net/api',
      settings: { platform: 'merlot' },
      is_active: false,
    });

    // One site the sync matched to an existing client, one with no match.
    const suggestedMappingId = uuidv4();
    await db('rmm_organization_mappings').insert({
      tenant: tenantData.tenant.tenantId,
      mapping_id: suggestedMappingId,
      integration_id: integrationId,
      external_organization_id: 'site-uid-suggested',
      external_organization_name: 'Site Suggested',
      client_id: null,
      auto_sync_assets: false,
      auto_create_tickets: false,
      metadata: {
        datto_site_id: 101,
        suggested_client_id: tenantData.client!.clientId,
        suggested_client_name: tenantData.client!.clientName,
      },
    });

    const plainMappingId = uuidv4();
    await db('rmm_organization_mappings').insert({
      tenant: tenantData.tenant.tenantId,
      mapping_id: plainMappingId,
      integration_id: integrationId,
      external_organization_id: 'site-uid-plain',
      external_organization_name: 'Site Plain',
      client_id: null,
      auto_sync_assets: false,
      auto_create_tickets: false,
      metadata: { datto_site_id: 102 },
    });

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    await selectDattoRmmIfSelectorPresent(page);

    await expect(page.getByText('Site Suggested')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Site Plain')).toBeVisible();

    // Only the site with a suggestion offers the chip; nothing is assigned yet.
    const chip = page.locator(`#datto-rmm-site-suggestion-${suggestedMappingId}`);
    await expect(chip).toContainText(`Suggested: ${tenantData.client!.clientName}`, { timeout: 30_000 });
    await expect(page.locator(`#datto-rmm-site-suggestion-${plainMappingId}`)).toHaveCount(0);
    const before = await db('rmm_organization_mappings')
      .where({ tenant: tenantData.tenant.tenantId, mapping_id: suggestedMappingId })
      .first(['client_id']);
    expect(before?.client_id).toBeNull();

    await chip.click();

    await waitForMappingClientId(db, tenantData.tenant.tenantId, suggestedMappingId, tenantData.client!.clientId);

    // The chip goes away once a client is set, and the picker shows the client.
    const pickerId = `datto-rmm-site-client-picker-${suggestedMappingId}`;
    await expect(page.locator(`#${pickerId}-trigger`)).toContainText(
      tenantData.client!.clientName,
      { timeout: 30_000 }
    );
    await expect(chip).toHaveCount(0);

    // With a client set, the default contact picker unlocks and persists the choice.
    const contactPickerId = `datto-rmm-default-contact-${suggestedMappingId}`;
    await page.locator(`#${contactPickerId}`).click();
    await page.locator(`#${contactPickerId}-option-${contactId}`).click();
    await waitForMappingColumn(db, tenantData.tenant.tenantId, suggestedMappingId, 'default_contact_id', contactId);

    // Auto-sync is off by default and persists once toggled on.
    const autosync = page.locator(`#datto-rmm-site-autosync-${suggestedMappingId}`);
    await expect(autosync).toHaveAttribute('data-state', 'unchecked');
    await autosync.click();
    await waitForMappingColumn(db, tenantData.tenant.tenantId, suggestedMappingId, 'auto_sync_assets', true);
    await page.locator('#datto-rmm-refresh-mappings').click();
    await expect(autosync).toHaveAttribute('data-state', 'checked', { timeout: 30_000 });

    // Manual assignment through the picker works for the unsuggested site.
    const plainPickerId = `datto-rmm-site-client-picker-${plainMappingId}`;
    await page.locator(`#${plainPickerId}-trigger`).click();
    await page.locator(`#${plainPickerId}-option-${tenantData.client!.clientId}`).click();
    await waitForMappingClientId(db, tenantData.tenant.tenantId, plainMappingId, tenantData.client!.clientId);
  } finally {
    await db.destroy().catch(() => undefined);
  }
});
