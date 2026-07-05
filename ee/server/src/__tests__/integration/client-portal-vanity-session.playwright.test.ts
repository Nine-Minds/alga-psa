import { test, expect } from '@playwright/test';
import { tenantDb } from '@alga-psa/db';
import { encode } from '@auth/core/jwt';
import { knex as createKnex, type Knex } from 'knex';
import { PLAYWRIGHT_DB_CONFIG } from './utils/playwrightDatabaseConfig';

const TEST_DISCOVERY_TENANT = '__client_portal_vanity_session_test__';

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function unscopedTestTable(db: Knex, table: string, reason: string) {
  return tenantDb(db, TEST_DISCOVERY_TENANT).unscoped(table, reason);
}

function normalizeBaseUrl(raw?: string): string {
  if (!raw || raw.length === 0) return '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

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

async function getSeededUser(db: Knex, email?: string) {
  if (email) {
    const row = await unscopedTestTable(
      db,
      'users',
      'client portal vanity session test locates seeded user by email before tenant context exists'
    ).where({ email: email.toLowerCase() }).first();
    if (row) return row;
  }
  const any = await unscopedTestTable(
    db,
    'users',
    'client portal vanity session test locates any seeded user before tenant context exists'
  ).first();
  if (!any) throw new Error('No seeded users found. Check seeds.');
  return any;
}

async function ensureClientUser(db: Knex): Promise<any> {
  const existing = await unscopedTestTable(
    db,
    'users',
    'client portal vanity session test locates any client portal user before tenant context exists'
  )
    .where({ user_type: 'client' })
    .whereNotNull('contact_id')
    .first();
  if (existing) return existing;

  const contact = await unscopedTestTable(
    db,
    'contacts',
    'client portal vanity session test locates any seeded contact before tenant context exists'
  ).select(['tenant', 'contact_name_id']).first();
  if (!contact) throw new Error('No contacts seeded; cannot prepare client portal user.');

  const user = await tenantTable(db, contact.tenant, 'users').where({ tenant: contact.tenant }).first();
  if (!user) throw new Error('No users found in tenant to convert to client portal user.');

  await tenantTable(db, contact.tenant, 'users')
    .where({ user_id: user.user_id, tenant: contact.tenant })
    .update({ user_type: 'client', contact_id: contact.contact_name_id });

  const updated = await tenantTable(db, contact.tenant, 'users')
    .where({ user_id: user.user_id, tenant: contact.tenant })
    .first();
  return updated;
}

async function setSessionCookie(page: any, user: any, baseUrl: string) {
  const token = await encode({
    token: {
      sub: user.user_id,
      id: user.user_id,
      email: user.email,
      tenant: user.tenant,
      user_type: 'client',
    },
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: 60 * 60,
    salt: 'authjs.session-token',
  });

  await page.context().addCookies([
    {
      name: process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token',
      value: token,
      url: baseUrl,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Client portal vanity session continuity', () => {
  test.setTimeout(180_000);

  let db: Knex;
  const vanityBase = normalizeBaseUrl(process.env.CLIENT_PORTAL_TEST_VANITY_BASE_URL) || 'http://portal.acme.local:3000';
  const vanityDashboardUrl = `${vanityBase}/client-portal/dashboard`;

  test.skip(!process.env.NEXTAUTH_SECRET, 'NEXTAUTH_SECRET is not configured.');

  test.beforeAll(async () => {
    db = adminDb();
    try {
      await db.raw('SELECT 1');
    } catch {
      test.skip(true, 'Database not reachable for Playwright bootstrap. Set PLAYWRIGHT_DB_HOST/PORT to your Postgres.');
    }
  });

  test.afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('vanity session token keeps the user on the vanity host', async ({ page }) => {
    const clientUser = process.env.CLIENT_PORTAL_TEST_EMAIL
      ? await getSeededUser(db, process.env.CLIENT_PORTAL_TEST_EMAIL)
      : await ensureClientUser(db);

    await setSessionCookie(page, clientUser, vanityBase);

    const response = await page.goto(vanityDashboardUrl, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(new RegExp('^http://portal\\.acme\\.local:3000/client-portal/dashboard'));
    await expect(page).not.toHaveURL(/canonical\.localhost:3000/);
  });
});
