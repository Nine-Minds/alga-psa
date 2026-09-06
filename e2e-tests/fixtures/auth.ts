import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

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

export const test = base.extend<{}, { credentials: Credentials }>({
  credentials: [async ({}, use) => {
    const email = process.env.E2E_USER_EMAIL;
    const password = process.env.E2E_USER_PASSWORD;
    if (!email || !password) {
      throw new Error('Set E2E_USER_EMAIL and E2E_USER_PASSWORD to the isolated installation credentials.');
    }
    await use({ email, password });
  }, { scope: 'worker' }],
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

/** Uses the browser context's cookies; does not manufacture session state. */
export async function readSession(request: APIRequestContext): Promise<SessionIdentity | undefined> {
  const response = await request.get('/api/auth/session');
  expect(response.ok(), 'Session endpoint must respond successfully').toBe(true);
  const session = await response.json();
  if (!session.user) return undefined;
  const { id, email, tenant, user_type } = session.user;
  return { id, email, tenant, user_type };
}
