import { test, expect, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { encode } from '@auth/core/jwt';
import { getSessionCookieName } from '@alga-psa/auth/session';
import {
  applyTestEnvDefaults,
  createTestDbConnection,
  createTestTenant,
  getBaseUrl,
} from './helpers/testSetup';

applyTestEnvDefaults();
process.env.DISABLE_FEATURE_FLAGS = 'true';
process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS = 'true';

const TEST_CONFIG = {
  baseUrl: getBaseUrl(),
};

async function setupAuthSessionForUser(
  page: Page,
  params: {
    userId: string;
    email: string;
    tenantId: string;
    name: string;
    userType?: 'internal' | 'client';
  }
) {
  const secret = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  const cookieName = getSessionCookieName();
  const maxAge = 60 * 60 * 24;
  const now = Math.floor(Date.now() / 1000);
  const baseUrl = TEST_CONFIG.baseUrl;

  const payload = {
    sub: params.userId,
    id: params.userId,
    email: params.email,
    tenant: params.tenantId,
    user_type: params.userType || 'internal',
    name: params.name,
    proToken: 'playwright-mock-token',
    iat: now,
    exp: now + maxAge,
  };

  const token = await encode({
    token: payload,
    secret,
    maxAge,
    salt: cookieName,
  });

  const parsedBaseUrl = new URL(baseUrl);
  parsedBaseUrl.pathname = '/';
  parsedBaseUrl.search = '';
  parsedBaseUrl.hash = '';
  const cookieUrl = parsedBaseUrl.toString();

  await page.context().addCookies([
    { name: cookieName, value: token, url: cookieUrl },
  ]);
}

test.describe('Collaborative editing (Playwright)', () => {
  let db: Knex;
  let tenantId: string;
  let adminUserId: string;
  let adminEmail: string;
  let secondUserId: string;
  let secondUserEmail: string;
  let roleId: string;
  let documentId: string;

  test.beforeAll(async () => {
    db = createTestDbConnection();
    const tenantData = await createTestTenant(db, { companyName: 'Collab E2E Tenant' });
    tenantId = tenantData.tenant.tenantId;
    adminUserId = tenantData.adminUser.userId;
    adminEmail = tenantData.adminUser.email;

    const role = await db('roles').where({ tenant: tenantId, role_name: 'Test Admin' }).first();
    roleId = role?.role_id;

    secondUserId = uuidv4();
    secondUserEmail = `editor-${secondUserId.slice(0, 6)}@test.com`;

    await db('users').insert({
      user_id: secondUserId,
      tenant: tenantId,
      username: `editor-${secondUserId.slice(0, 6)}`,
      email: secondUserEmail,
      first_name: 'Editor',
      last_name: 'Two',
      user_type: 'internal',
      is_inactive: false,
      hashed_password: 'not-a-real-hash',
    });

    if (roleId) {
      await db('user_roles').insert({
        tenant: tenantId,
        user_id: secondUserId,
        role_id: roleId,
      });
    }

    documentId = uuidv4();
    const now = new Date();

    await db('documents').insert({
      document_id: documentId,
      document_name: 'Collaborative E2E Doc',
      document_type: 'text',
      tenant: tenantId,
      created_by: adminUserId,
      updated_by: adminUserId,
      created_at: now,
      updated_at: now,
    });

    await db('document_block_content').insert({
      content_id: uuidv4(),
      document_id: documentId,
      block_data: JSON.stringify({ type: 'doc', content: [] }),
      tenant: tenantId,
      created_at: now,
      updated_at: now,
    });
  });

  test.afterAll(async () => {
    if (!db) return;
    const tables = [
      'document_block_content',
      'documents',
      'user_roles',
      'role_permissions',
      'permissions',
      'roles',
      'users',
      'tenant_companies',
      'tenant_settings',
      'clients',
      'tenants',
    ];

    for (const table of tables) {
      try {
        await db(table).where({ tenant: tenantId }).del();
      } catch (error) {
        // ignore cleanup issues in shared test DB
      }
    }
    await db.destroy();
  });

  test('two browser contexts see real-time changes and presence', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await setupAuthSessionForUser(pageA, {
      userId: adminUserId,
      email: adminEmail,
      tenantId,
      name: 'Editor One',
    });

    await setupAuthSessionForUser(pageB, {
      userId: secondUserId,
      email: secondUserEmail,
      tenantId,
      name: 'Editor Two',
    });

    const url = `${TEST_CONFIG.baseUrl}/msp/test/collab?doc=${documentId}`;
    await Promise.all([pageA.goto(url), pageB.goto(url)]);

    await Promise.all([
      pageA.locator('.ProseMirror').waitFor(),
      pageB.locator('.ProseMirror').waitFor(),
    ]);

    await pageA.locator('.ProseMirror').click();
    await pageA.keyboard.type('Hello from A');

    await expect(pageB.locator('.ProseMirror')).toContainText('Hello from A', {
      timeout: 3000,
    });

    await expect(pageB.getByText('Editor One')).toBeVisible();
    await expect(pageB.getByText('Editor Two')).toBeVisible();

    const caretLabel = pageB.locator(
      '.collaboration-caret__label, .collaboration-cursor__label',
      { hasText: 'Editor One' }
    );
    await expect(caretLabel).toBeVisible({ timeout: 5000 });

    await contextA.close();
    await contextB.close();
  });
});
