import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

import { encode } from '@auth/core/jwt';

dotenv.config();

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

  const maxAge = getSessionMaxAge();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'vanity-user-1',
    id: 'vanity-user-1',
    email: 'client@example.com',
    tenant: 'tenant-portal-1',
    user_type: 'client',
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
