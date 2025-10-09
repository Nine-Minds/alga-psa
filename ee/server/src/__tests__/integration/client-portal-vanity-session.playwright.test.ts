import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

import { encode } from '@auth/core/jwt';
import { loadClientPortalTestCredentials } from './helpers/clientPortalTestCredentials';

dotenv.config();

const credentials = loadClientPortalTestCredentials();

function getSessionCookieName(): string {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-authjs.session-token'
    : 'authjs.session-token';
}

function getSessionMaxAge(): number {
  const raw = process.env.NEXTAUTH_SESSION_EXPIRES;
  if (!raw) {
    return 60 * 60 * 24;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 60 * 60 * 24 : parsed;
}

async function seedVanitySessionCookie(page: import('@playwright/test').Page) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET must be defined for tests');
  }

  if (!credentials) {
    throw new Error('Client portal test credentials not configured');
  }

  // Query the database for the real user (use admin connection to bypass RLS)
  const { getAdminConnection } = await import('../../../../../shared/db/admin');
  const knex = await getAdminConnection();

  const user = await knex('users')
    .where({
      email: credentials.email,
      user_type: 'client'
    })
    .first();

  if (!user) {
    throw new Error(`Test user not found: ${credentials.email}`);
  }

  const maxAge = getSessionMaxAge();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.user_id,
    id: user.user_id,
    email: user.email,
    tenant: user.tenant,
    user_type: user.user_type,
    iat: issuedAt,
    exp: issuedAt + maxAge,
  };

  const sessionToken = await encode({
    token: payload,
    secret,
    salt: getSessionCookieName(),
    maxAge,
  });

  await page.context().addCookies([
    {
      name: getSessionCookieName(),
      value: sessionToken,
      domain: 'portal.acme.local',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Client portal vanity session continuity', () => {
  test.skip(!credentials, 'Client portal test credentials not configured. Provide CLIENT_PORTAL_TEST_EMAIL/PASSWORD env vars or a .playwright-client-portal-credentials.json file.');

  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('vanity session token keeps the user on the vanity host', async ({ page }) => {
    const vanityDashboardUrl = 'http://portal.acme.local:3000/client-portal/dashboard';

    await seedVanitySessionCookie(page);

    const response = await page.goto(vanityDashboardUrl);
    await page.waitForLoadState('domcontentloaded');

    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(vanityDashboardUrl);
    await expect(page).not.toHaveURL(/canonical\.localhost:3000/);
  });
});
