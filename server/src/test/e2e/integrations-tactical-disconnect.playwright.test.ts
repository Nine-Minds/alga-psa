import { expect, test } from '@playwright/test';
import type { Knex } from 'knex';
import http from 'node:http';
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

async function waitForIntegrationActive(
  db: Knex,
  tenantId: string,
  expected: boolean,
  timeoutMs = 20_000
): Promise<{ is_active: boolean; connected_at: any | null }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = await db('rmm_integrations')
      .where({ tenant: tenantId, provider: 'tacticalrmm' })
      .first(['is_active', 'connected_at']);
    if (row && Boolean(row.is_active) === expected) return row as any;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for rmm_integrations.is_active=${expected}`);
}

function startMockTacticalServer(expectedApiKey: string): Promise<{
  baseUrl: string;
  calls: { clientList: number; lastApiKey: string | null };
  close: () => Promise<void>;
}> {
  const calls = { clientList: 0, lastApiKey: null as string | null };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const method = req.method || 'GET';

    res.setHeader('content-type', 'application/json');

    if (method === 'GET' && url.pathname === '/api/beta/v1/client/') {
      calls.clientList += 1;
      const apiKey = String(req.headers['x-api-key'] || '');
      calls.lastApiKey = apiKey;
      if (apiKey !== expectedApiKey) {
        res.statusCode = 401;
        res.end(JSON.stringify({ detail: 'Unauthorized' }));
        return;
      }
      res.statusCode = 200;
      res.end(JSON.stringify([{ id: 1, name: 'Mock Client' }]));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'Not found' }));
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind mock Tactical server'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        calls,
        close: async () =>
          await new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test('Disconnect clears stored Tactical credentials and marks integration inactive', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  const apiKey = `api_${uuidv4().replace(/-/g, '')}`;
  const tactical = await startMockTacticalServer(apiKey);

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Tactical Disconnect ${uuidv4().slice(0, 6)}`,
      baseUrl,
    });

    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'read');
    await ensureSystemSettingsPermission(db, tenantData.tenant.tenantId, 'update');

    await page.goto(`${baseUrl}/msp/settings?tab=integrations&category=rmm`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });

    const card = page.locator('#tacticalrmm-integration-settings-card');

    await card.locator('#tacticalrmm-instance-url').fill(tactical.baseUrl);
    await card.locator('#tacticalrmm-api-key').fill(apiKey);
    await card.locator('#tacticalrmm-save-config').click();

    // Saved status should reflect persisted secret (masked placeholder + "Saved:" line).
    const last4 = apiKey.slice(-4);
    await expect(card.getByText(/^Saved:/)).toContainText(last4, { timeout: 30_000 });

    // Test connection should mark integration active.
    await card.locator('#tacticalrmm-test-connection').click();
    const activeRow = await waitForIntegrationActive(db, tenantData.tenant.tenantId, true, 30_000);
    expect(activeRow.connected_at).not.toBeNull();
    expect(tactical.calls.clientList).toBeGreaterThanOrEqual(1);
    expect(tactical.calls.lastApiKey).toBe(apiKey);

    // Disconnect should clear secrets and set is_active=false.
    await card.locator('#tacticalrmm-disconnect').click();

    await expect(card.locator('#tacticalrmm-api-key')).toHaveAttribute('placeholder', 'Enter API key', {
      timeout: 30_000,
    });
    await expect(card.getByText(/^Saved:/)).toHaveCount(0);
    await expect(card.getByText('Status: Not configured')).toBeVisible({ timeout: 30_000 });

    const inactiveRow = await waitForIntegrationActive(db, tenantData.tenant.tenantId, false, 30_000);
    expect(inactiveRow.connected_at).toBeNull();
  } finally {
    await tactical.close().catch(() => undefined);
    await db.destroy().catch(() => undefined);
  }
});

