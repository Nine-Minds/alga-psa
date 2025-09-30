import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import { encode } from '@auth/core/jwt';

dotenv.config();

function normalizeBaseUrl(raw?: string): string {
  if (!raw || raw.length === 0) {
    return '';
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

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

async function seedClientSessionCookie(page: import('@playwright/test').Page, baseUrl: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET must be defined for Playwright tests.');
  }

  const cookieName = getSessionCookieName();
  const maxAge = getSessionMaxAge();
  const issuedAt = Math.floor(Date.now() / 1000);
  const base = new URL(baseUrl);
  const payload = {
    sub: 'playwright-client-user-1',
    id: 'playwright-client-user-1',
    email: 'client@example.com',
    tenant: 'playwright-client-tenant',
    user_type: 'client',
    iat: issuedAt,
    exp: issuedAt + maxAge,
  };

  const sessionToken = await encode({
    token: payload,
    secret,
    salt: cookieName,
    maxAge,
  });

  await page.context().addCookies([
    {
      name: cookieName,
      value: sessionToken,
      domain: base.hostname,
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      expires: issuedAt + maxAge,
    },
  ]);
}

test.describe('Client access to MSP routes', () => {
  test('client user should not hit a redirect loop when visiting /msp/dashboard', async ({ page }) => {
    const canonicalBase = normalizeBaseUrl(process.env.NEXTAUTH_URL) || 'http://canonical.localhost:3000';

    await page.context().clearCookies();
    await seedClientSessionCookie(page, canonicalBase);

    const redirectRecords: Array<{ from: string; to?: string }> = [];
    const navigationPaths: string[] = [];

    page.on('response', (response) => {
      const status = response.status();
      if (status >= 300 && status < 400 && redirectRecords.length < 50) {
        const locationHeader = response.headers()['location'];
        try {
          const fromPath = new URL(response.url()).pathname;
          const toPath = locationHeader ? new URL(locationHeader, response.url()).pathname : undefined;
          redirectRecords.push({ from: fromPath, to: toPath });
        } catch {
          // ignore parse errors
        }
      }
    });

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && navigationPaths.length < 50) {
        try {
          const pathname = new URL(frame.url()).pathname;
          navigationPaths.push(pathname);
        } catch {
          // ignore parse errors
        }
      }
    });

    const mspDashboardUrl = new URL('/msp/dashboard', canonicalBase).toString();
    let navigationError: Error | null = null;
    try {
      await page.goto(mspDashboardUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (error) {
      navigationError = error as Error;
    }

    await page.waitForTimeout(2500);

    const mspVisits = navigationPaths.filter((pathname) => pathname === '/msp/dashboard');
    const signinVisits = navigationPaths.filter((pathname) => pathname.startsWith('/auth/signin'));
    const loopRedirects = redirectRecords.filter((entry) => entry.to === '/msp/dashboard');
    const clientDashboardVisits = navigationPaths.filter((pathname) => pathname === '/client-portal/dashboard');
    const clientDashboardRedirects = redirectRecords.filter(
      (entry) => entry.from === '/msp/dashboard' && entry.to === '/client-portal/dashboard'
    );

    const redirectSummary = redirectRecords.length
      ? redirectRecords.map(({ from, to }, index) => `${index + 1}. ${from} -> ${to ?? '<missing>'}`).join('\n')
      : 'No redirects captured.';
    const navigationSummary = navigationPaths.length ? navigationPaths.join(' -> ') : 'No navigations captured.';
    const diagnostics = `Redirects:\n${redirectSummary}\n\nMain-frame navigation order:\n${navigationSummary}`;

    expect(navigationError, `Navigation to ${mspDashboardUrl} failed.\n${diagnostics}`).toBeNull();
    expect(mspVisits.length, `Visited /msp/dashboard ${mspVisits.length} times.\n${diagnostics}`).toBeLessThanOrEqual(1);
    expect(signinVisits.length, `Visited /auth/signin ${signinVisits.length} times.\n${diagnostics}`).toBe(0);
    expect(loopRedirects.length, `Redirected to /msp/dashboard ${loopRedirects.length} times.\n${diagnostics}`).toBe(0);
    expect(clientDashboardVisits.length, `Never reached client portal dashboard.\n${diagnostics}`).toBeGreaterThanOrEqual(1);
    expect(clientDashboardRedirects.length, `Missing redirect from MSP to client portal dashboard.\n${diagnostics}`).toBeGreaterThanOrEqual(1);

    await expect(page).toHaveURL(new RegExp('^https?://[^/]+/client-portal/dashboard'));
  });
});
