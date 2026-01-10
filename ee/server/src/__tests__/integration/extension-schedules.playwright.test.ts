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
    await expect(page.getByRole('heading', { name: 'Schedules' })).toBeVisible();
    await expect(page.getByText('Loading schedules…')).toHaveCount(0);
    await expect(page.locator('[data-automation-id="extension-schedule-endpoint"]')).toBeVisible();
    await expect(page.getByText('No schedules configured.')).toBeVisible();

    // Endpoints should have been materialized from the extension_version manifest.
    const endpointRow = await db('extension_api_endpoint')
      .where({ version_id: versionId, method, path })
      .first(['id']);
    expect(endpointRow?.id).toBeTruthy();

    // Select endpoint.
    await page.locator('[data-automation-id="extension-schedule-endpoint"]').click();
    await page.getByRole('option', { name: `${method} ${path}` }).click();

    // Fill schedule details.
    await page.locator('[data-automation-id="extension-schedule-cron"]').fill('0 1 * * *');
    await page.locator('[data-automation-id="extension-schedule-timezone"]').fill('UTC');
    await page.locator('[data-automation-id="extension-schedule-payload"]').fill('{"hello":"world"}');

    await page.locator('#create-schedule-button').click();

    // Wait for the schedule to be persisted (server actions are async; click doesn't await completion).
    let scheduleRow: any | null = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      scheduleRow = await db('tenant_extension_schedule')
        .where({
          tenant_id: tenantId,
          install_id: installId,
          endpoint_id: endpointRow.id,
        })
        .orderBy('created_at', 'desc')
        .first(['endpoint_id', 'cron', 'timezone', 'payload_json']);
      if (scheduleRow) break;
      await page.waitForTimeout(250);
    }

    expect(scheduleRow).toBeTruthy();
    expect(scheduleRow.endpoint_id).toBe(endpointRow.id);
    expect(String(scheduleRow.cron)).toBe('0 1 * * *');
    expect(String(scheduleRow.timezone)).toBe('UTC');
    expect(scheduleRow.payload_json).toEqual({ hello: 'world' });
  });

  test('defaults schedule timezone to the current user timezone (fallback UTC)', async ({ page }) => {
    page.setDefaultNavigationTimeout(120_000);
    page.setDefaultTimeout(120_000);

    const tenantData = await createTenantAndLogin(db, page, {
      completeOnboarding: true,
      permissions: [{ roleName: 'Admin', permissions }],
      sessionOptions: { baseUrl },
    });

    const tenantId = tenantData.tenant.tenantId;

    const userTz = 'America/New_York';
    await db('users').where({ tenant: tenantId }).update({ timezone: userTz });

    const registryId = uuidv4();
    const versionId = uuidv4();
    const installId = uuidv4();

    await db('extension_registry').insert({
      id: registryId,
      publisher: 'playwright',
      name: `ext-${registryId.slice(0, 8)}`,
      display_name: 'Playwright Scheduled Tasks Timezone Default',
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
      api_endpoints: JSON.stringify([{ method: 'POST', path: '/scheduled', handler: 'handlers.scheduled' }]),
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

    await expect(page.getByRole('heading', { name: 'Schedules' })).toBeVisible();
    await expect(page.getByText('Loading schedules…')).toHaveCount(0);
    await expect(page.locator('[data-automation-id="extension-schedule-timezone"]')).toHaveValue(userTz);
  });

  test('validates cron and payload JSON on create', async ({ page }) => {
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
      display_name: 'Playwright Scheduled Tasks Validation',
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

    await expect(page.getByRole('heading', { name: 'Schedules' })).toBeVisible();
    await expect(page.getByText('Loading schedules…')).toHaveCount(0);
    await expect(page.getByText('No schedules configured.')).toBeVisible();

    await page.locator('[data-automation-id="extension-schedule-endpoint"]').click();
    await page.getByRole('option', { name: `${method} ${path}` }).click();

    // Invalid JSON payload blocks create (client-side validation).
    await page.locator('[data-automation-id="extension-schedule-payload"]').fill('{');
    await page.locator('#create-schedule-button').click();
    await expect(page.getByText('Payload must be valid JSON.')).toBeVisible();

    // Invalid cron blocks create (server-side validation).
    await page.locator('[data-automation-id="extension-schedule-payload"]').fill('{"ok":true}');
    await page.locator('[data-automation-id="extension-schedule-cron"]').fill('not a cron');
    await page.locator('#create-schedule-button').click();
    await expect(page.getByText(/Invalid cron expression/i)).toBeVisible();

    // Valid create persists schedule.
    await page.locator('[data-automation-id="extension-schedule-cron"]').fill('0 1 * * *');
    await page.locator('#create-schedule-button').click();

    let row: any | null = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      row = await db('tenant_extension_schedule')
        .where({ tenant_id: tenantId, install_id: installId })
        .orderBy('created_at', 'desc')
        .first(['id']);
      if (row?.id) break;
      await page.waitForTimeout(250);
    }
    expect(row?.id).toBeTruthy();
  });

  test('shows empty endpoint state when extension declares none', async ({ page }) => {
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

    await db('extension_registry').insert({
      id: registryId,
      publisher: 'playwright',
      name: `ext-${registryId.slice(0, 8)}`,
      display_name: 'Playwright Scheduled Tasks Empty Endpoints',
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
      api_endpoints: JSON.stringify([]),
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

    await expect(page.getByRole('heading', { name: 'Schedules' })).toBeVisible();
    await expect(page.getByText('Loading schedules…')).toHaveCount(0);
    await expect(page.getByText('This extension does not declare any API endpoints, so there is nothing to schedule.')).toBeVisible();
  });

  test('can edit, toggle, run-now, and delete a schedule', async ({ page }) => {
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
      display_name: 'Playwright Scheduled Tasks 2',
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

    await expect(page.getByRole('heading', { name: 'Schedules' })).toBeVisible();
    await expect(page.getByText('Loading schedules…')).toHaveCount(0);

    // Create schedule.
    await page.locator('[data-automation-id="extension-schedule-endpoint"]').click();
    await page.getByRole('option', { name: `${method} ${path}` }).click();
    await page.locator('[data-automation-id="extension-schedule-cron"]').fill('0 1 * * *');
    await page.locator('[data-automation-id="extension-schedule-timezone"]').fill('UTC');
    await page.locator('[data-automation-id="extension-schedule-payload"]').fill('{"hello":"world"}');
    await page.locator('#create-schedule-button').click();

    // Wait for DB row to exist and capture id for stable selectors.
    let scheduleId: string | null = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      const row = await db('tenant_extension_schedule')
        .where({ tenant_id: tenantId, install_id: installId })
        .orderBy('created_at', 'desc')
        .first(['id']);
      scheduleId = row?.id ? String(row.id) : null;
      if (scheduleId) break;
      await page.waitForTimeout(250);
    }
    expect(scheduleId).toBeTruthy();

    const rowContainer = page.locator(`#edit-schedule-${scheduleId}`).locator('xpath=ancestor::div[contains(@class,"border") and contains(@class,"p-3")][1]');

    // Edit schedule.
    await page.locator(`#edit-schedule-${scheduleId}`).waitFor({ timeout: 30_000 });
    await page.locator(`#edit-schedule-${scheduleId}`).click();
    await rowContainer.getByPlaceholder('0 0 * * *').fill('0 2 * * *');
    await rowContainer.getByPlaceholder('UTC').fill('UTC');
    await rowContainer.getByPlaceholder('{"example":"value"}').fill('{"hello":"updated"}');
    await rowContainer.getByRole('button', { name: 'Save' }).click();

    // Verify DB updated.
    let updated: any | null = null;
    const editStartedAt = Date.now();
    while (Date.now() - editStartedAt < 20_000) {
      updated = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first(['cron', 'payload_json']);
      if (String(updated?.cron) === '0 2 * * *' && JSON.stringify(updated?.payload_json) === JSON.stringify({ hello: 'updated' })) {
        break;
      }
      await page.waitForTimeout(250);
    }
    expect(String(updated?.cron)).toBe('0 2 * * *');
    expect(updated?.payload_json).toEqual({ hello: 'updated' });

    // Toggle off then on.
    const toggle = rowContainer.getByRole('switch');
    await toggle.click();
    const disableStartedAt = Date.now();
    let afterDisable: any | null = null;
    while (Date.now() - disableStartedAt < 20_000) {
      afterDisable = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first(['enabled']);
      if (Boolean(afterDisable?.enabled) === false) break;
      await page.waitForTimeout(250);
    }
    expect(Boolean(afterDisable?.enabled)).toBe(false);
    await toggle.click();
    const enableStartedAt = Date.now();
    while (Date.now() - enableStartedAt < 20_000) {
      afterDisable = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first(['enabled']);
      if (Boolean(afterDisable?.enabled) === true) break;
      await page.waitForTimeout(250);
    }
    expect(Boolean(afterDisable?.enabled)).toBe(true);

    // Run now.
    await page.locator(`#run-schedule-now-${scheduleId}`).click();
    await expect(page.getByText('Schedule run enqueued.')).toBeVisible();

    // Delete schedule (accept confirm dialog).
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });
    await page.locator(`#delete-schedule-${scheduleId}`).click();

    // Wait for deletion.
    const startedDelete = Date.now();
    while (Date.now() - startedDelete < 30_000) {
      const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first(['id']);
      if (!row) break;
      await page.waitForTimeout(250);
    }
    const gone = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first(['id']);
    expect(gone).toBeFalsy();
  });
});
