import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import knex, { type Knex } from 'knex';
import { createProductionBrowserActors, type BrowserActors } from './database';
import { buildTenantPortalSlug } from '../../shared/utils/tenantSlug';

export interface Credentials {
  email: string;
  password: string;
}

export interface SessionIdentity {
  id: string;
  email: string;
  tenant: string;
  user_type: string;
}

export const test = base.extend<{ actors: BrowserActors }, { credentials: Credentials; database: Knex; actorData: BrowserActors }>({
  credentials: [async ({}, use) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      throw new Error('Set E2E_USER_EMAIL and E2E_USER_PASSWORD to the isolated installation credentials.');
    }
    await use({ email, password });
  }, { scope: 'worker' }],
  database: [async ({}, use) => {
    if (process.env.E2E_DATABASE_ISOLATED !== 'true' || !process.env.E2E_DB_NAME || !process.env.E2E_DB_PASSWORD) {
      throw new Error('Browser database fixtures require E2E_DATABASE_ISOLATED=true, E2E_DB_NAME and E2E_DB_PASSWORD for a disposable installation.');
    }
    const db = knex({ client: 'pg', connection: {
      host: process.env.E2E_DB_HOST || '127.0.0.1', port: Number(process.env.E2E_DB_PORT || '5432'),
      database: process.env.E2E_DB_NAME, user: process.env.E2E_DB_USER || 'postgres', password: process.env.E2E_DB_PASSWORD,
    }, pool: { min: 0, max: 2 } });
    try { await use(db); } finally { await db.destroy(); }
  }, { scope: 'worker' }],
  actorData: [async ({ database, credentials }, use) => {
    const actors = await createProductionBrowserActors(database, { sourceEmail: credentials.email });
    await use(actors);
  }, { scope: 'worker' }],
  actors: async ({ actorData }, use, testInfo) => {
    // IDs, roles and run identity are sufficient for reproduction; credentials
    // and stored password hashes are not returned by the seeder.
    await testInfo.attach('fixture-identities', { body: JSON.stringify(actorData, null, 2), contentType: 'application/json' });
    await use(actorData);
  },
});

export { expect };

/** Submit through the shipped form, including its CSRF/credentials callback. */
export async function submitCredentials(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/auth/signin');
  await page.locator('[data-automation-id="msp-email-field"]').fill(credentials.email);
  await page.locator('[data-automation-id="msp-password-field"]').fill(credentials.password);
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/auth/callback/credentials'
      && response.request().method() === 'POST'),
    page.locator('[data-automation-id="msp-sign-in-button"]').click(),
  ]);
  expect(response.status(), 'Credentials callback must not return a server error').toBeLessThan(500);
}

export async function signIn(page: Page, credentials: Credentials): Promise<void> {
  await submitCredentials(page, credentials);
  await expect(page).toHaveURL(/\/msp\/dashboard(?:[/?#]|$)/);
}

export async function submitPortalCredentials(page: Page, credentials: Credentials, tenantId: string): Promise<void> {
  await page.goto(`/auth/client-portal/signin?tenant=${buildTenantPortalSlug(tenantId)}`);
  await page.locator('[data-automation-id="client-email-field"]').fill(credentials.email);
  await page.locator('[data-automation-id="client-password-field"]').fill(credentials.password);
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/callback/credentials'
      && response.request().method() === 'POST'),
    page.locator('[data-automation-id="client-sign-in-button"]').click(),
  ]);
  expect(response.status(), 'Portal credentials callback must not return a server error').toBeLessThan(500);
}

export async function signInPortal(page: Page, credentials: Credentials, tenantId: string): Promise<void> {
  await submitPortalCredentials(page, credentials, tenantId);
  await expect(page).toHaveURL(/\/client-portal\/dashboard(?:[/?#]|$)/);
}

/** Uses the browser context's cookies; does not manufacture session state. */
export async function readSession(request: APIRequestContext): Promise<SessionIdentity | undefined> {
  const response = await request.get('/api/auth/session');
  expect(response.ok(), 'Session endpoint must respond successfully').toBe(true);
  const session = await response.json();
  if (!session.user) return undefined;
  const { id, email, tenant, user_type } = session.user;
  return { id, email, tenant, user_type };
}
