import { test, expect } from '@playwright/test';

test.describe('Client portal vanity redirects', () => {
  test('unauthenticated vanity request redirects to canonical login', async ({ page }) => {
    const port = process.env.PORT || '3000';
    const vanityHost = 'client-vanity.localhost';
    const vanityUrl = `http://${vanityHost}:${port}/client-portal/dashboard`;
    const response = await page.request.get(vanityUrl, { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    const location = response.headers()['location'];
    expect(location).toBeDefined();

    const redirectUrl = new URL(location!, vanityUrl);
    expect(redirectUrl.host).toBe('canonical.localhost:3000');
    expect(redirectUrl.searchParams.get('callbackUrl')).toBe(vanityUrl);
  });

  test('unauthenticated vanity request to signin redirects to canonical login', async ({ page }) => {
    const port = process.env.PORT || '3000';
    const vanityHost = 'client-vanity.localhost';
    const vanityUrl = `http://${vanityHost}:${port}/auth/client-portal/signin`;
    const response = await page.request.get(vanityUrl, { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    const location = response.headers()['location'];
    expect(location).toBeDefined();

    const redirectUrl = new URL(location!, vanityUrl);
    expect(redirectUrl.host).toBe('canonical.localhost:3000');
    expect(redirectUrl.searchParams.get('callbackUrl')).toBe(vanityUrl);
  });
});
