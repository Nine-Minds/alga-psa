import { randomUUID } from 'node:crypto';
import { test, expect, readSession, signIn, submitCredentials } from '../fixtures/auth';

test('real sign-in renders the dashboard and preserves the tenant session after reload', async ({ page, browser, credentials, baseURL }, testInfo) => {
  await signIn(page, credentials);
  const title = testInfo.project.metadata.edition === 'enterprise'
    ? 'Welcome to Your MSP Command Center'
    : 'Welcome back';
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform Features', exact: true })).toBeVisible();

  const identity = await readSession(page.request);
  expect(identity).toMatchObject({ email: credentials.email, user_type: 'internal' });
  expect(identity?.id).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  expect(identity?.tenant).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  expect(await readSession(page.request)).toEqual(identity);

  // A separate browser context must not inherit the authenticated tenant.
  const anonymous = await browser.newContext({ baseURL });
  try {
    expect(await readSession(anonymous.request)).toBeUndefined();
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto('/msp/dashboard');
    await expect(anonymousPage).toHaveURL(/\/auth\/(?:msp\/)?signin(?:[/?#]|$)/);
    await expect(anonymousPage.locator('[data-automation-id="msp-email-field"]')).toBeVisible();
    expect(await readSession(anonymous.request)).toBeUndefined();
  } finally {
    await anonymous.close();
  }
});

test('a rejected password shows an actionable error and creates no session', async ({ page, credentials }) => {
  await submitCredentials(page, {
    email: credentials.email,
    password: `incorrect-${randomUUID()}`,
  });
  await expect(page.getByText('Invalid email or password. Please try again.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/(?:msp\/)?signin(?:[/?#]|$)/);
  expect(await readSession(page.request)).toBeUndefined();
});

test('legacy integration settings links redirect before rendering and remain usable after reload', async ({ page, actors, credentials }) => {
  const actor = actors.primary.admin;
  await signIn(page, { email: actor.email, password: credentials.password });
  const legacy = '/msp/settings?tab=integrations&category=accounting';
  const response = await page.request.get(legacy, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const target = new URL(response.headers().location);
  expect(target.pathname).toBe('/msp/settings/integrations');
  expect(target.search).toBe('?category=accounting');

  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(legacy);
  await expect(page).toHaveURL(/\/msp\/settings\/integrations\?category=accounting$/);
  await expect(page.locator('#accounting-integrations-setup')).toBeVisible();
  await page.reload();
  await expect(page.locator('#accounting-integrations-setup')).toBeVisible();
  expect(errors).toEqual([]);
  expect(await readSession(page.request)).toMatchObject({ id: actor.userId, tenant: actor.tenantId });
});
