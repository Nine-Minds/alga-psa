import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { knex as createKnex } from 'knex';
import { PLAYWRIGHT_DB_CONFIG } from './utils/playwrightDatabaseConfig';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
  type TenantPermissionTuple,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

function adminDb() {
  return createKnex({
    client: 'pg',
    connection: {
      host: PLAYWRIGHT_DB_CONFIG.host,
      port: PLAYWRIGHT_DB_CONFIG.port,
      database: PLAYWRIGHT_DB_CONFIG.database,
      user: PLAYWRIGHT_DB_CONFIG.adminUser,
      password: PLAYWRIGHT_DB_CONFIG.adminPassword,
    },
    pool: { min: 0, max: 5 },
  });
}

test.describe('Extension Scheduled Tasks (UI)', () => {
  test.setTimeout(240_000);

  let db: any;
  const baseUrl = resolvePlaywrightBaseUrl();

  const permissions: TenantPermissionTuple[] = [
    { resource: 'settings', action: 'read' },
    { resource: 'extension', action: 'read' },
    { resource: 'extension', action: 'write' },
  ];

  test.beforeAll(async () => {
    db = adminDb();
    try {
      await db.raw('SELECT 1');
    } catch {
      test.skip(true, 'Database not reachable for Playwright tests.');
    }
  });

  test.afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  test('creates a schedule from the extension settings page', async ({ page }) => {
    page.setDefaultNavigationTimeout(120_000);
    page.setDefaultTimeout(120_000);

    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [{ roleName: 'Admin', permissions }],
      sessionOptions: { baseUrl },
    });

    const tenantId = tenantData.tenant.tenantId;

    const registryId = uuidv4();
    const versionId = uuidv4();
    const installId = uuidv4();

    const method = 'POST';
    const path = '/scheduled';

    await db('extension_registry').insert({
      id: registryId,
      publisher: 'playwright',
      name: `ext-${registryId.slice(0, 8)}`,
      display_name: 'Playwright Scheduled Tasks',
      description: 'Playwright test extension',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('extension_version').insert({
      id: versionId,
      registry_id: registryId,
      version: '1.0.0',
      runtime: 'node',
      main_entry: 'index.js',
      api: JSON.stringify({}),
      ui: null,
      capabilities: JSON.stringify([]),
      api_endpoints: JSON.stringify([{ method, path, handler: 'handlers.scheduled' }]),
      created_at: db.fn.now(),
    });

    await db('tenant_extension_install').insert({
      id: installId,
      tenant_id: tenantId,
      registry_id: registryId,
      version_id: versionId,
      granted_caps: JSON.stringify([]),
      config: JSON.stringify({}),
      is_enabled: true,
      status: 'enabled',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const settingsUrl = `${baseUrl}/msp/settings/extensions/${registryId}/settings`;
    await page.goto(settingsUrl, { waitUntil: 'domcontentloaded' });

    // Wait for schedule controls to be ready (endpoints loaded).
    await expect(page.getByText('Schedules')).toBeVisible();
    await expect(page.locator('[data-automation-id="extension-schedule-endpoint"]')).toBeVisible();

    // Select endpoint.
    await page.locator('[data-automation-id="extension-schedule-endpoint"]').click();
    await page.getByRole('option', { name: `${method} ${path}` }).click();

    // Fill schedule details.
    await page.locator('[data-automation-id="extension-schedule-cron"]').fill('0 1 * * *');
    await page.locator('[data-automation-id="extension-schedule-timezone"]').fill('UTC');
    await page.locator('[data-automation-id="extension-schedule-payload"]').fill('{"hello":"world"}');

    await page.locator('#create-schedule-button').click();

    // Should show up in the list.
    await expect(page.getByText(`${method} ${path}`)).toBeVisible();

    // Verify DB row was created and endpoint reference is correct.
    const endpointRow = await db('extension_api_endpoint')
      .where({ version_id: versionId, method, path })
      .first(['id']);
    expect(endpointRow?.id).toBeTruthy();

    const scheduleRow = await db('tenant_extension_schedule')
      .where({ tenant_id: tenantId, install_id: installId })
      .orderBy('created_at', 'desc')
      .first(['endpoint_id', 'cron', 'timezone', 'payload_json']);

    expect(scheduleRow).toBeTruthy();
    expect(scheduleRow.endpoint_id).toBe(endpointRow.id);
    expect(String(scheduleRow.cron)).toBe('0 1 * * *');
    expect(String(scheduleRow.timezone)).toBe('UTC');
    expect(scheduleRow.payload_json).toEqual({ hello: 'world' });
  });
});
