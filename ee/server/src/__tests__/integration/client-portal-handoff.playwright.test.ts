/**
 * Client Portal vanity handoff integration smoke test.
 *
 * Validates that the handoff page exchanges a one-time token and
 * redirects to the requested client portal route when the exchange
 * API responds successfully.
 */

import { test, expect, type Page } from '@playwright/test';
import { encode } from '@auth/core/jwt';
import dotenv from 'dotenv';
import { knex as createKnex, type Knex } from 'knex';
import {
  applyPlaywrightDatabaseEnv,
  ensurePlaywrightDatabase,
  PLAYWRIGHT_DB_CONFIG,
} from './utils/playwrightDatabaseConfig';
import { loadClientPortalTestCredentials } from './helpers/clientPortalTestCredentials';

dotenv.config();
applyPlaywrightDatabaseEnv();
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';

const credentials = loadClientPortalTestCredentials();

const BASE_URL = 'http://localhost:3000';
const OTT_TOKEN = 'demo-ott-token';
const RETURN_PATH = '/client-portal/dashboard';
const SESSION_MAX_AGE_SECONDS = 60 * 60;
const SESSION_COOKIE_NAME = 'authjs.session-token';

type ClientPortalSessionUser = {
  userId: string;
  tenantId: string;
  email: string;
  userType: 'client';
};

let sharedDb: Knex | null = null;

function createPlaywrightDbConnection(): Knex {
  if (!sharedDb) {
    sharedDb = createKnex({
      client: 'pg',
      connection: {
        host: PLAYWRIGHT_DB_CONFIG.host,
        port: PLAYWRIGHT_DB_CONFIG.port,
        database: PLAYWRIGHT_DB_CONFIG.database,
        // Use admin credentials for test-side DB access to bypass RLS/permissions
        user: PLAYWRIGHT_DB_CONFIG.adminUser,
        password: PLAYWRIGHT_DB_CONFIG.adminPassword,
        ssl: PLAYWRIGHT_DB_CONFIG.ssl,
      },
      pool: { min: 0, max: 5, idleTimeoutMillis: 30_000 },
    });
  }
  return sharedDb;
}

async function getSeededClientUser(db: Knex, preferredEmail?: string): Promise<ClientPortalSessionUser> {
  if (preferredEmail) {
    const byEmail = await db('users')
      .where({ email: preferredEmail.toLowerCase() })
      .first();
    if (byEmail) {
      return {
        userId: byEmail.user_id,
        tenantId: byEmail.tenant,
        email: byEmail.email,
        userType: (byEmail.user_type as string) || 'client',
      } as ClientPortalSessionUser;
    }
  }

  const anyUser = await db('users').first();
  if (!anyUser) {
    throw new Error(
      'No seeded user found. Ensure server/seeds/dev creates at least one user, or set CLIENT_PORTAL_TEST_EMAIL to a seeded email.'
    );
  }
  return {
    userId: anyUser.user_id,
    tenantId: anyUser.tenant,
    email: anyUser.email,
    userType: (anyUser.user_type as string) || 'client',
  } as ClientPortalSessionUser;
}

async function seedClientPortalSession(
  page: Page,
  sessionUser: ClientPortalSessionUser
): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET must be defined for tests');
  }

  const token = await encode({
    token: {
      sub: sessionUser.userId,
      id: sessionUser.userId,
      email: sessionUser.email,
      tenant: sessionUser.tenantId,
      user_type: sessionUser.userType,
    },
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
    salt: SESSION_COOKIE_NAME,
  });

  const expires = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;

  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      url: BASE_URL,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires,
    },
  ]);
}

async function bootstrapSeededClientSession(db: Knex, email?: string): Promise<ClientPortalSessionUser> {
  const sessionUser = await getSeededClientUser(db, email);
  return sessionUser;
}

function attachFailFastHandlers(page: Page, baseUrl: string) {
  const isRelevant = (url: string) => url.startsWith(baseUrl);

  page.on('pageerror', (error) => {
    throw new Error(`Client-side error detected: ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!isRelevant(url)) return;
    const failure = request.failure();
    if (failure?.errorText === 'net::ERR_ABORTED') {
      return;
    }
    throw new Error(
      `Network request failed for ${url}: ${failure?.errorText ?? 'unknown error'}`
    );
  });
}

test.describe('Client Portal vanity handoff', () => {
  // Allow ample time for DB drop/recreate + full migrations on fresh runs
  test.skip(
    !credentials,
    'Client portal test credentials not configured. Provide CLIENT_PORTAL_TEST_EMAIL/PASSWORD env vars or a .playwright-client-portal-credentials.json file.'
  );

  test.beforeAll(async () => {
    // Database has been reset in globalSetup; just create a connection for this fixture
    sharedDb = createPlaywrightDbConnection();
  });

  test.afterAll(async () => {
    if (sharedDb) {
      await sharedDb.destroy().catch(() => undefined);
      sharedDb = null;
    }
  });

  test('redirects to canonical return path after successful OTT exchange', async ({ page }) => {
    if (!sharedDb || !credentials) {
      throw new Error('Test database or credentials not initialized');
    }

    try {
      const sessionUser = await bootstrapSeededClientSession(sharedDb, credentials.email);

      attachFailFastHandlers(page, BASE_URL);
      await seedClientPortalSession(page, sessionUser);

      await page.route(`${BASE_URL}/api/client-portal/domain-session`, async (route) => {
        const request = route.request();
        let payload: Record<string, unknown> = {};
        try {
          payload = request.postDataJSON();
        } catch {
          // Ignore payload parse errors and fall back to empty object
        }
        const body = payload as { ott?: string; returnPath?: string };
        expect(body.ott).toBe(OTT_TOKEN);
        expect(body.returnPath).toBe(RETURN_PATH);

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ redirectTo: RETURN_PATH, canonicalHost: 'canonical.example.com' }),
        });
      });

      await page.route(`${BASE_URL}${RETURN_PATH}`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html><body>Client Portal Dashboard (test override)</body></html>',
        });
      });

      await page.goto(
        `${BASE_URL}/auth/client-portal/handoff?ott=${OTT_TOKEN}&return=${encodeURIComponent(RETURN_PATH)}`
      );

      await page.waitForURL(`${BASE_URL}${RETURN_PATH}`);
      expect(page.url()).toBe(`${BASE_URL}${RETURN_PATH}`);
    } finally {
      // No cleanup — tests rely on seeded data
    }
  });

  test('shows recovery action when OTT exchange fails', async ({ page }) => {
    if (!sharedDb || !credentials) {
      throw new Error('Test database or credentials not initialized');
    }

    try {
      const sessionUser = await bootstrapSeededClientSession(sharedDb, credentials.email);

      attachFailFastHandlers(page, BASE_URL);
      await seedClientPortalSession(page, sessionUser);

      await page.route(`${BASE_URL}/api/client-portal/domain-session`, async (route) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_or_expired', canonicalHost: 'canonical.example.com' }),
        });
      });

      await page.goto(
        `${BASE_URL}/auth/client-portal/handoff?ott=${OTT_TOKEN}&return=${encodeURIComponent(RETURN_PATH)}`
      );

      await expect(page.getByText('We couldn’t finalize your login')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Return to Sign In' })).toBeVisible();
    } finally {
      // No cleanup — tests rely on seeded data
    }
  });
});
