import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('portal discovery validates email before submission and links to MSP sign-in', async ({ page }) => {
  await page.goto('/auth/client-portal/signin');
  await expect(page.getByRole('heading', { name: 'Find Your Organization' })).toBeVisible();
  await expect(page.getByText(/Enter your email address and we'll send you login links/)).toBeVisible();
  await expect(page.locator('#client-sign-in-button')).toBeHidden();
  const email = page.locator('#tenant-discovery-email');
  const submit = page.locator('#tenant-discovery-submit-button');
  await expect(submit).toBeDisabled();
  await email.fill('invalid-address');
  await expect(submit).toBeEnabled();
  await submit.click();
  expect(await email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  await expect(email).toBeFocused();
  await expect(page.locator('#tenant-discovery-form')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeHidden();
  await email.clear();
  await expect(submit).toBeDisabled();
  await page.getByRole('link', { name: /MSP Staff/i }).click();
  await expect(page).toHaveURL(/\/auth\/msp\/signin(?:[?#]|$)/);
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('a tenant hint selects credential sign-in instead of organization discovery', async ({ page }) => {
  // This exercises form selection only; real tenant authentication lives in portal-identity.spec.ts.
  await page.goto('/auth/client-portal/signin?tenant=abc123def456');
  await expect(page.locator('#client-sign-in-button')).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('#tenant-discovery-form')).toBeHidden();
});

test('unknown email receives generic confirmation and can restart discovery with its callback intact', async ({ page }) => {
  const callback = '/client-portal/tickets';
  await page.goto(`/auth/client-portal/signin?${new URLSearchParams({ callbackUrl: callback })}`);
  await page.locator('#tenant-discovery-email').fill(`discovery-${randomUUID()}@example.invalid`);
  await page.locator('#tenant-discovery-submit-button').click();
  await expect(page.getByRole('heading', { name: 'Check Your Email' })).toBeVisible();
  await expect(page.getByText(/If an account exists with that email address, we've sent you login links/)).toBeVisible();
  await expect(page.locator('#tenant-discovery-form')).toBeHidden();
  expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(callback);
  await page.locator('#tenant-discovery-back-button').click();
  await expect(page.locator('#tenant-discovery-form')).toBeVisible();
  await expect(page.locator('#tenant-discovery-email')).toHaveValue('');
  await expect(page.locator('#tenant-discovery-submit-button')).toBeDisabled();
  expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe(callback);
});

test('anonymous portal dashboard access redirects to discovery with a return destination', async ({ page }) => {
  await page.goto('/client-portal/dashboard');
  await expect(page).toHaveURL(url => url.pathname === '/auth/client-portal/signin'
    && url.searchParams.get('callbackUrl') === '/client-portal/dashboard');
  await expect(page.locator('#tenant-discovery-form')).toBeVisible();
  await expect(page.locator('#client-sign-in-button')).toBeHidden();
});
