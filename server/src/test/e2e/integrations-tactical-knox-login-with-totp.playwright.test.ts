import { expect, test, type Page } from '@playwright/test';
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

function startMockTacticalServer(): Promise<{
  baseUrl: string;
  token: string;
  calls: {
    checkcreds: number;
    login: number;
    clientList: number;
    lastLoginPayload: any | null;
    lastClientListAuth: string | null;
  };
  close: () => Promise<void>;
}> {
  const token = `knox_${uuidv4().replace(/-/g, '')}`;
  const calls = {
    checkcreds: 0,
    login: 0,
    clientList: 0,
    lastLoginPayload: null as any | null,
    lastClientListAuth: null as string | null,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const method = req.method || 'GET';

    res.setHeader('content-type', 'application/json');

    if (method === 'POST' && url.pathname === '/api/v2/checkcreds/') {
      calls.checkcreds += 1;
      res.statusCode = 200;
      res.end(JSON.stringify({ totp: true }));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/v2/login/') {
      calls.login += 1;
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        try {
          calls.lastLoginPayload = JSON.parse(body || '{}');
        } catch {
          calls.lastLoginPayload = { raw: body };
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ token }));
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/beta/v1/client/') {
      calls.clientList += 1;
      const auth = req.headers.authorization || '';
      calls.lastClientListAuth = auth;
      if (auth !== `Token ${token}`) {
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
        token,
        calls,
        close: async () =>
          await new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test('Tactical Knox auth detects TOTP required and completes login when provided', async ({ page }) => {
  test.setTimeout(300_000);

  const baseUrl = getBaseUrl();
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;
  const tactical = await startMockTacticalServer();

  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Tactical Knox TOTP ${uuidv4().slice(0, 6)}`,
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

    // Configure instance and switch auth mode to Knox.
    await page.locator('#tacticalrmm-instance-url').fill(tactical.baseUrl);

    await page.locator('#tacticalrmm-auth-mode').click();
    await page.getByText('Username/password (Knox token)', { exact: true }).click();
    await expect(page.locator('#tacticalrmm-username')).toBeVisible({ timeout: 10_000 });

    await page.locator('#tacticalrmm-username').fill('admin');
    await page.locator('#tacticalrmm-password').fill('password123');
    await page.locator('#tacticalrmm-save-config').click();

    // First test should detect TOTP required and render a code input (no login attempt yet).
    await page.locator('#tacticalrmm-test-connection').click();
    await expect(page.locator('#tacticalrmm-totp')).toBeVisible({ timeout: 30_000 });
    expect(tactical.calls.checkcreds).toBeGreaterThanOrEqual(1);
    expect(tactical.calls.login).toBe(0);
    expect(tactical.calls.clientList).toBe(0);

    // Second test should include the TOTP in the login payload and persist the Knox token.
    await page.locator('#tacticalrmm-totp').fill('123456');
    await page.locator('#tacticalrmm-test-connection').click();

    const last4 = tactical.token.slice(-4);
    await expect(page.getByText(/Knox token saved:/)).toContainText(last4, { timeout: 30_000 });

    expect(tactical.calls.checkcreds).toBeGreaterThanOrEqual(2);
    expect(tactical.calls.login).toBeGreaterThanOrEqual(1);
    expect(tactical.calls.clientList).toBeGreaterThanOrEqual(1);
    expect(tactical.calls.lastLoginPayload?.twofactor).toBe('123456');
    expect(tactical.calls.lastClientListAuth).toBe(`Token ${tactical.token}`);
  } finally {
    await tactical.close().catch(() => undefined);
    await db.destroy().catch(() => undefined);
  }
});
