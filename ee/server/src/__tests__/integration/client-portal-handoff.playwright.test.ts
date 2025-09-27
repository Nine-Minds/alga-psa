/**
 * Client Portal vanity handoff integration smoke test.
 *
 * Validates that the handoff page exchanges a one-time token and
 * redirects to the requested client portal route when the exchange
 * API responds successfully.
 */

import { test, expect } from '@playwright/test';
import { encode } from '@auth/core/jwt';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'http://localhost:3000';
const OTT_TOKEN = 'demo-ott-token';
const RETURN_PATH = '/client-portal/dashboard';

async function seedCanonicalSessionCookie(page: import('@playwright/test').Page) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET must be defined for tests');
  }

  const tokenValue = await encode({
    token: {
      sub: 'test-user-id',
      email: 'client@example.com',
      tenant: 'test-tenant',
      user_type: 'client',
    },
    secret,
    maxAge: 60 * 60,
    salt: 'authjs.session-token',
  });

  await page.context().addCookies([
    {
      name: 'authjs.session-token',
      value: tokenValue,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
    },
  ]);
}

test.describe('Client Portal vanity handoff', () => {
  test('redirects to return path after successful OTT exchange', async ({ page }) => {
    await seedCanonicalSessionCookie(page);

    await page.route(`${BASE_URL}/api/client-portal/domain-session`, async (route) => {
      const request = route.request();
      let payload: Record<string, unknown> = {};
      try {
        payload = request.postDataJSON();
      } catch (error) {
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

    await page.goto(`${BASE_URL}/auth/client-portal/handoff?ott=${OTT_TOKEN}&return=${encodeURIComponent(RETURN_PATH)}`);

    await page.waitForURL(`${BASE_URL}${RETURN_PATH}`);
    expect(page.url()).toBe(`${BASE_URL}${RETURN_PATH}`);
  });

  test('shows recovery action when OTT exchange fails', async ({ page }) => {
    await seedCanonicalSessionCookie(page);

    await page.route(`${BASE_URL}/api/client-portal/domain-session`, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_or_expired', canonicalHost: 'canonical.example.com' }),
      });
    });

    await page.goto(`${BASE_URL}/auth/client-portal/handoff?ott=${OTT_TOKEN}&return=${encodeURIComponent(RETURN_PATH)}`);

    await expect(page.getByText('We couldn’t finalize your login')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to Sign In' })).toBeVisible();
  });
});
