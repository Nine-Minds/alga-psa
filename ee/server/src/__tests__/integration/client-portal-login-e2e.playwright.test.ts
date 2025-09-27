import { test, expect } from '@playwright/test';
import { loadClientPortalTestCredentials } from './helpers/clientPortalTestCredentials';

const credentials = loadClientPortalTestCredentials();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBaseUrl(raw?: string): string {
  if (!raw || raw.length === 0) {
    return '';
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

test.describe('Client portal canonical login to vanity handoff', () => {
  test.skip(!credentials, 'Client portal test credentials not configured. Provide CLIENT_PORTAL_TEST_EMAIL/PASSWORD env vars or a .playwright-client-portal-credentials.json file.');

  test('completes login via canonical host and returns to vanity dashboard with session cookie', async ({ page }) => {
    const configuredCredentials = credentials!;
    const vanityBase = normalizeBaseUrl(configuredCredentials.vanityBaseUrl) || 'http://portal.acme.local:3000';
    const canonicalBase = normalizeBaseUrl(configuredCredentials.canonicalBaseUrl) || 'http://canonical.localhost:3000';

    const vanityHostPattern = escapeRegex(new URL(vanityBase).origin);
    const canonicalHostPattern = escapeRegex(new URL(canonicalBase).origin);
    const vanityDashboardUrl = `${vanityBase}/client-portal/dashboard`;

    if (process.env.CLIENT_PORTAL_E2E_DEBUG === '1') {
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
          console.log('[client-portal-e2e] navigated to', frame.url());
        }
      });

      page.on('response', (response) => {
        const status = response.status();
        if (status >= 300 && status < 400) {
          const location = response.headers()['location'];
          if (location) {
            console.log('[client-portal-e2e] redirect', status, response.url(), '->', location);
          }
        }
      });
    }

    await page.goto(vanityDashboardUrl, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`^${canonicalHostPattern}/auth/client-portal/signin`));

    await page.fill('#client-email-field', configuredCredentials.email);
    await page.fill('#client-password-field', configuredCredentials.password);

    const callbackResponsePromise = page.waitForResponse((response) => {
      return response.url().includes('/api/auth/callback/credentials') && response.request().method() === 'POST';
    }, { timeout: 45000 });

    const domainSessionResponsePromise = page.waitForResponse((response) => {
      return response.url().includes('/api/client-portal/domain-session') && response.request().method() === 'POST';
    }, { timeout: 45000 });

    await page.click('#client-sign-in-button');
    const callbackResponse = await callbackResponsePromise;
    const callbackPayload = await callbackResponse.json().catch(() => null);
    console.log('[client-portal-e2e] credentials callback status', callbackResponse.status(), callbackPayload, callbackResponse.request().headers());

    await page.waitForURL(new RegExp(`^${vanityHostPattern}/auth/client-portal/handoff`), { timeout: 45000 });

    const domainSessionResponse = await domainSessionResponsePromise;
    expect(domainSessionResponse.status()).toBeLessThan(400);

    await page.waitForURL(new RegExp(`^${vanityHostPattern}/client-portal/dashboard`), { timeout: 45000 });
    expect(page.url()).toMatch(new RegExp(`^${vanityHostPattern}/client-portal/dashboard`));

    const sessionCookieName = process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token';
    const cookies = await page.context().cookies();
    const vanityHost = new URL(vanityBase).hostname;
    const sessionCookie = cookies.find((cookie) => cookie.name === sessionCookieName && cookie.domain.includes(vanityHost));

    expect(sessionCookie?.value).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBeTruthy();
  });
});
