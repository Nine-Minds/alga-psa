import { test, expect, type Page } from '@playwright/test';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { LoginPage } from '../page-objects/LoginPage';
import {
  applyPlaywrightAuthEnvDefaults,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

/**
 * T001 (alga-2026-0002996): MSP SSO on a custom domain runs on the canonical host and the
 * session is handed back.
 *
 * NOT RUN when authored: it needs the running app (canonical host = NEXTAUTH_URL, started with
 * PLAYWRIGHT_FAKE_GOOGLE_OAUTH=true and NEXT_PUBLIC_PLAYWRIGHT_FAKE_GOOGLE_OAUTH=true) and the
 * dev database. The custom host is a name Chromium maps to loopback, so no DNS or proxy is
 * needed; the app finds the tenant through the seeded portal_domains row.
 *
 * Fake-provider mode short-circuits the provider hop (the entry point redirects to
 * /api/auth/e2e/google/complete on the canonical host), so the provider's `redirect_uri` is
 * not observable here. What this pins instead is the property that makes the canonical
 * redirect_uri sufficient: every OAuth-related request goes to the canonical host, none to
 * the custom host's own /api/auth/signin or /api/auth/callback.
 */

applyPlaywrightAuthEnvDefaults();

const CANONICAL_BASE = resolvePlaywrightBaseUrl();
const CUSTOM_HOSTNAME = 'msp.custom-sso.test';
const canonicalUrl = new URL(CANONICAL_BASE);
const CUSTOM_BASE = `${canonicalUrl.protocol}//${CUSTOM_HOSTNAME}${canonicalUrl.port ? `:${canonicalUrl.port}` : ''}`;

test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${CUSTOM_HOSTNAME} 127.0.0.1`] },
});

function createPasswordHash(password: string): string {
  const signingSecret = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  const salt = randomBytes(12).toString('hex');
  const hash = pbkdf2Sync(password, signingSecret + salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function seedCustomDomainAndTechnician(db: ReturnType<typeof createTestDbConnection>) {
  const tenant = await db('tenants').select('tenant').first();
  const role = await db('roles').select('role_id').where({ tenant: tenant.tenant, role_name: 'Admin' }).first();
  if (!tenant?.tenant || !role?.role_id) {
    throw new Error('Expected the Playwright seed tenant and Admin role to exist.');
  }

  const now = new Date();
  await db('portal_domains').where({ tenant: tenant.tenant }).del();
  await db('portal_domains').insert({
    tenant: tenant.tenant,
    domain: CUSTOM_HOSTNAME,
    canonical_host: `${tenant.tenant}.portal.test`,
    surface: 'both',
    status: 'active',
    status_message: 'Your domain is live and protected by HTTPS.',
    verification_details: JSON.stringify({}),
  });

  const password = `Pw!${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const email = `custom-sso.${Date.now()}@test.com`;
  const userId = randomUUID();
  await db('users').insert({
    user_id: userId,
    tenant: tenant.tenant,
    first_name: 'Custom',
    last_name: 'Domain',
    email,
    user_type: 'internal',
    username: email,
    hashed_password: createPasswordHash(password),
    is_inactive: false,
    two_factor_enabled: false,
    is_google_user: false,
    created_at: now,
    updated_at: now,
  });
  await db('user_roles').insert({ user_id: userId, tenant: tenant.tenant, role_id: role.role_id, created_at: now });

  return { tenant: tenant.tenant as string, email, password };
}

async function hasSessionCookie(page: Page, base: string): Promise<boolean> {
  const cookies = await page.context().cookies(base);
  return cookies.some((cookie) => /session-token/.test(cookie.name));
}

test.describe('MSP SSO on a custom domain', () => {
  test('T001: Google on the custom host runs on the canonical host and ends signed in on the custom host; password sign-in stays in place', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();

    try {
      const { email, password } = await seedCustomDomainAndTechnician(db);

      const requested: string[] = [];
      page.on('request', (request) => {
        if (request.isNavigationRequest()) requested.push(request.url());
      });

      // --- SSO (fake Google) from the custom host's sign-in page ---
      await page.goto(`${CUSTOM_BASE}/auth/msp/signin?callbackUrl=${encodeURIComponent('/msp/tickets')}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const loginPage = new LoginPage(page);
      await loginPage.emailInput.fill(email);
      const googleButton = page.locator('#sso-provider-google-button');
      await expect(googleButton).toBeEnabled({ timeout: 30_000 });
      await googleButton.click();

      await page.waitForURL(new RegExp(`^${CUSTOM_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/msp/tickets`), { timeout: 60_000 });

      // The OAuth round trip stayed on the canonical host...
      expect(requested.some((url) => url.startsWith(`${CANONICAL_BASE}/api/auth/msp/sso/start`))).toBe(true);
      expect(requested.some((url) => url.startsWith(`${CUSTOM_BASE}/api/auth/callback`))).toBe(false);
      expect(requested.some((url) => url.startsWith(`${CUSTOM_BASE}/api/auth/signin`))).toBe(false);
      // ...and the session was handed to the custom host through the surface-neutral handoff.
      expect(requested.some((url) => url.startsWith(`${CUSTOM_BASE}/auth/handoff?ott=`))).toBe(true);
      expect(await hasSessionCookie(page, CUSTOM_BASE)).toBe(true);

      // --- a fresh visitor signs in with a password in place on the custom host ---
      const context = await browser.newContext();
      try {
        const passwordPage = await context.newPage();
        await passwordPage.goto(`${CUSTOM_BASE}/auth/msp/signin`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        const passwordLogin = new LoginPage(passwordPage);
        await passwordLogin.fillCredentials(email, password);
        await passwordLogin.submitLogin();
        await passwordPage.waitForURL(new RegExp('/msp/dashboard'), { timeout: 60_000 });
        expect(new URL(passwordPage.url()).hostname).toBe(CUSTOM_HOSTNAME);
      } finally {
        await context.close().catch(() => undefined);
      }

    } finally {
      await db('portal_domains').where({ domain: CUSTOM_HOSTNAME }).del().catch(() => undefined);
      await db.destroy().catch(() => undefined);
    }
  });
});
