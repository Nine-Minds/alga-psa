import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { LoginPage } from '../page-objects/LoginPage';
import {
  applyPlaywrightAuthEnvDefaults,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

const REMEMBERED_EMAIL_COOKIE = 'msp_remembered_email';
const PLAYWRIGHT_FAKE_GOOGLE_OAUTH_MODE_COOKIE = 'playwright_fake_google_oauth_mode';

async function readRememberedEmailCookie(page: Page) {
  const cookies = await page.context().cookies(TEST_CONFIG.baseUrl);
  const cookie = cookies.find((candidate) => candidate.name === REMEMBERED_EMAIL_COOKIE) ?? null;
  if (!cookie) {
    return null;
  }

  return {
    ...cookie,
    value: decodeURIComponent(cookie.value),
  };
}

async function openSignInWithRememberedEmail(
  browser: Browser,
  cookie: Awaited<ReturnType<typeof readRememberedEmailCookie>>,
) {
  const context = await browser.newContext();
  if (cookie) {
    await context.addCookies([cookie]);
  }

  const page = await context.newPage();
  const loginPage = new LoginPage(page);
  await page.goto(`${TEST_CONFIG.baseUrl}/auth/msp/signin`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  return {
    context,
    page,
    loginPage,
  };
}

async function seedRememberedEmailCookie(
  page: Page,
  email: string
) {
  await page.context().addCookies([
    {
      name: REMEMBERED_EMAIL_COOKIE,
      value: email.toLowerCase(),
      url: TEST_CONFIG.baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function setFakeGoogleOauthMode(
  page: Page,
  mode: 'success' | 'cancel',
) {
  await page.context().addCookies([
    {
      name: PLAYWRIGHT_FAKE_GOOGLE_OAUTH_MODE_COOKIE,
      value: mode,
      url: TEST_CONFIG.baseUrl,
      sameSite: 'Lax',
    },
  ]);
}

async function resolveMspSsoStart(
  page: Page,
  email: string,
  publicWorkstation: boolean,
) {
  return await page.evaluate(
    async ({ submittedEmail, submittedPublicWorkstation }) => {
      const response = await fetch('/api/auth/msp/sso/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider: 'google',
          email: submittedEmail,
          publicWorkstation: submittedPublicWorkstation,
          callbackUrl: '/msp/dashboard',
        }),
      });

      const body = await response.json().catch(() => null);
      return {
        status: response.status,
        ok: response.ok,
        body,
      };
    },
    {
      submittedEmail: email,
      submittedPublicWorkstation: publicWorkstation,
    },
  );
}

function createPasswordHash(password: string): string {
  const signingSecret = process.env.NEXTAUTH_SECRET || 'test-nextauth-secret';
  const salt = randomBytes(12).toString('hex');
  const hash = pbkdf2Sync(password, signingSecret + salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function createSeedTenantAdminUser(db: ReturnType<typeof createTestDbConnection>, email: string) {
  const tenant = await db('tenants').select('tenant').first();
  if (!tenant?.tenant) {
    throw new Error('Expected the Playwright seed tenant to exist.');
  }

  const role = await db('roles')
    .select('role_id')
    .where({ tenant: tenant.tenant, role_name: 'Admin' })
    .first();
  if (!role?.role_id) {
    throw new Error('Expected the Playwright seed Admin role to exist.');
  }

  const temporaryPassword = `Pw!${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const userId = randomUUID();
  const now = new Date();

  await db('users').insert({
    user_id: userId,
    tenant: tenant.tenant,
    first_name: 'Playwright',
    last_name: 'Remembered',
    email: email.toLowerCase(),
    user_type: 'internal',
    username: email.toLowerCase(),
    hashed_password: createPasswordHash(temporaryPassword),
    is_inactive: false,
    two_factor_enabled: false,
    is_google_user: false,
    created_at: now,
    updated_at: now,
  });

  await db('user_roles').insert({
    user_id: userId,
    tenant: tenant.tenant,
    role_id: role.role_id,
    created_at: now,
  });

  return {
    email: email.toLowerCase(),
    userId,
    tenantId: tenant.tenant as string,
    temporaryPassword,
  };
}

test.describe('MSP remembered-email credentials flow', () => {
  test('T024: successful credentials sign-in remembers the email and prefills it on a later visit to /auth/msp/signin', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    let revisitContext: BrowserContext | null = null;

    try {
      const tenantUser = await createSeedTenantAdminUser(
        db,
        `remembered.${Date.now()}@test.com`,
      );

      const loginPage = new LoginPage(page);
      await page.goto(`${TEST_CONFIG.baseUrl}/auth/msp/signin`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(loginPage.emailInput).toBeVisible();

      await loginPage.fillCredentials(
        tenantUser.email,
        tenantUser.temporaryPassword
      );
      await loginPage.submitLogin();

      await page.waitForURL(/\/msp\/dashboard/, { timeout: 30_000 });

      const rememberedCookie = await readRememberedEmailCookie(page);
      expect(rememberedCookie?.value).toBe(tenantUser.email);

      const revisit = await openSignInWithRememberedEmail(browser, rememberedCookie);
      revisitContext = revisit.context;
      await expect(revisit.loginPage.emailInput).toHaveValue(
        tenantUser.email
      );
    } finally {
      await revisitContext?.close().catch(() => undefined);
      await db.destroy().catch(() => undefined);
    }
  });

  test('T025: successful credentials sign-in with public-workstation checked clears a previously remembered email and later visits show an empty email field', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    let revisitContext: BrowserContext | null = null;

    try {
      const tenantUser = await createSeedTenantAdminUser(
        db,
        `public.${Date.now()}@test.com`,
      );

      await seedRememberedEmailCookie(page, 'old@example.com');

      const loginPage = new LoginPage(page);
      await page.goto(`${TEST_CONFIG.baseUrl}/auth/msp/signin`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(loginPage.emailInput).toHaveValue('old@example.com');

      await loginPage.fillCredentials(
        tenantUser.email,
        tenantUser.temporaryPassword
      );
      await loginPage.rememberMeCheckbox.check();
      await loginPage.submitLogin();

      await page.waitForURL(/\/msp\/dashboard/, { timeout: 30_000 });

      const rememberedCookie = await readRememberedEmailCookie(page);
      expect(rememberedCookie).toBeNull();

      const revisit = await openSignInWithRememberedEmail(browser, rememberedCookie);
      revisitContext = revisit.context;
      await expect(revisit.loginPage.emailInput).toHaveValue('');
    } finally {
      await revisitContext?.close().catch(() => undefined);
      await db.destroy().catch(() => undefined);
    }
  });

  test('T026: failed credentials sign-in leaves previously remembered email unchanged', async ({ page, browser }) => {
    test.setTimeout(300_000);
    let revisitContext: BrowserContext | null = null;

    try {
      await seedRememberedEmailCookie(page, 'persisted@example.com');

      const loginPage = new LoginPage(page);
      await page.goto(`${TEST_CONFIG.baseUrl}/auth/msp/signin`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(loginPage.emailInput).toHaveValue('persisted@example.com');

      await loginPage.fillCredentials('wrong@example.com', 'wrong-password');
      await loginPage.submitLogin();

      await expect(page.getByText('Invalid email or password. Please try again.')).toBeVisible({
        timeout: 15_000,
      });

      const rememberedCookie = await readRememberedEmailCookie(page);
      expect(rememberedCookie?.value).toBe('persisted@example.com');

      const revisit = await openSignInWithRememberedEmail(browser, rememberedCookie);
      revisitContext = revisit.context;
      await expect(revisit.loginPage.emailInput).toHaveValue('persisted@example.com');
    } finally {
      await revisitContext?.close().catch(() => undefined);
    }
  });
});

test.describe('MSP remembered-email SSO flow', () => {
  test('T027: successful SSO sign-in remembers the email and prefills it on a later visit', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    let revisitContext: BrowserContext | null = null;

    try {
      const tenantUser = await createSeedTenantAdminUser(
        db,
        `remembered-sso.${Date.now()}@test.com`,
      );

      await setFakeGoogleOauthMode(page, 'success');

      const loginPage = new LoginPage(page);
      const googleButton = page.getByRole('button', { name: /sign in with google/i });
      await page.goto(`${TEST_CONFIG.baseUrl}/auth/msp/signin`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(loginPage.emailInput).toBeVisible();
      await loginPage.emailInput.fill(tenantUser.email);
      await expect(googleButton).toBeEnabled({ timeout: 30_000 });

      const ssoStart = await resolveMspSsoStart(page, tenantUser.email, false);
      expect(ssoStart.ok).toBe(true);
      expect(ssoStart.body?.ok).toBe(true);
      await page.goto(`${TEST_CONFIG.baseUrl}/api/auth/e2e/google/complete?callbackUrl=/msp/dashboard`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.waitForURL(/\/msp\/dashboard/, { timeout: 30_000 });

      const rememberedCookie = await readRememberedEmailCookie(page);
      expect(rememberedCookie?.value).toBe(tenantUser.email);

      const revisit = await openSignInWithRememberedEmail(browser, rememberedCookie);
      revisitContext = revisit.context;
      await expect(revisit.loginPage.emailInput).toHaveValue(
        tenantUser.email
      );
    } finally {
      await revisitContext?.close().catch(() => undefined);
      await db.destroy().catch(() => undefined);
    }
  });

  test('T028: successful SSO sign-in with public-workstation checked clears previously remembered email', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    let revisitContext: BrowserContext | null = null;

    try {
      const tenantUser = await createSeedTenantAdminUser(
        db,
        `public-sso.${Date.now()}@test.com`,
      );

      await seedRememberedEmailCookie(page, 'old-sso@example.com');
      await setFakeGoogleOauthMode(page, 'success');

      const loginPage = new LoginPage(page);
      const googleButton = page.getByRole('button', { name: /sign in with google/i });
      await page.goto(`${TEST_CONFIG.baseUrl}/auth/msp/signin`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await expect(loginPage.emailInput).toHaveValue('old-sso@example.com');

      await loginPage.emailInput.fill(tenantUser.email);
      await page.getByLabel('Public workstation - do not remember my email').check();
      await expect(googleButton).toBeEnabled({ timeout: 30_000 });

      const ssoStart = await resolveMspSsoStart(page, tenantUser.email, true);
      expect(ssoStart.ok).toBe(true);
      expect(ssoStart.body?.ok).toBe(true);
      await page.goto(`${TEST_CONFIG.baseUrl}/api/auth/e2e/google/complete?callbackUrl=/msp/dashboard`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      await page.waitForURL(/\/msp\/dashboard/, { timeout: 30_000 });

      const rememberedCookie = await readRememberedEmailCookie(page);
      expect(rememberedCookie).toBeNull();

      const revisit = await openSignInWithRememberedEmail(browser, rememberedCookie);
      revisitContext = revisit.context;
      await expect(revisit.loginPage.emailInput).toHaveValue('');
    } finally {
      await revisitContext?.close().catch(() => undefined);
      await db.destroy().catch(() => undefined);
    }
  });

  test('T029: failed or cancelled SSO does not create a durable remembered-email cookie', async ({ page }) => {
    test.setTimeout(180_000);
    const loginPage = new LoginPage(page);
    const googleButton = page.getByRole('button', { name: /sign in with google/i });

    await setFakeGoogleOauthMode(page, 'cancel');
    await page.goto(`${TEST_CONFIG.baseUrl}/auth/msp/signin`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await expect(loginPage.emailInput).toBeVisible();

    await loginPage.emailInput.fill(`cancelled-sso.${Date.now()}@test.com`);
    await expect(googleButton).toBeEnabled({ timeout: 30_000 });

    await googleButton.click();
    await page.waitForURL(/error=|\/auth\/error|\/auth\/msp\/signin/, { timeout: 30_000 });

    const rememberedCookie = await readRememberedEmailCookie(page);
    expect(rememberedCookie).toBeNull();
  });
});
