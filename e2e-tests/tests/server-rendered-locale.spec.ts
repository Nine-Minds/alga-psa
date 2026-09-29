import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

function expectedTitle(locale: string): string {
  const pack = JSON.parse(readFileSync(path.resolve(__dirname, '../../server/public/locales', locale, 'metadata.json'), 'utf8'));
  const title = pack.auth?.msp?.signin?.title;
  expect(typeof title).toBe('string');
  return title;
}

// Exercise Next's compiled server-rendering boundary; a single-registry unit
// test cannot detect locale resolvers missing from a different webpack layer.
for (const locale of ['de', 'fr', 'en']) {
  test.describe(`server-rendered ${locale} locale`, () => {
    test.use({ locale });
    test('returns translated HTML and preserves it in the browser without persisting a guessed locale', async ({ page }) => {
      const response = await page.goto('/auth/msp/signin');
      expect(response?.status()).toBe(200);
      const html = await response!.text();
      expect(/<html[^>]*\slang="([^"]*)"/.exec(html)?.[1]).toBe(locale);
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
      expect(title).toContain(expectedTitle(locale));
      if (locale !== 'en') expect(title).not.toContain(expectedTitle('en'));
      const cookies = (await response!.headersArray()).filter(header => header.name.toLowerCase() === 'set-cookie');
      expect(cookies.some(header => /^locale=/i.test(header.value))).toBe(false);
      await expect(page.locator('[data-automation-id="msp-email-field"]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      expect(await page.title()).toContain(expectedTitle(locale));
      expect((await page.context().cookies()).some(cookie => cookie.name === 'locale')).toBe(false);
    });
  });
}

test('an explicit locale cookie outranks the browser language in server HTML and the browser', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'pl', url: baseURL! }]);
  const response = await page.goto('/auth/msp/signin');
  expect(response?.status()).toBe(200);
  const html = await response!.text();
  expect(/<html[^>]*\slang="([^"]*)"/.exec(html)?.[1]).toBe('pl');
  expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toContain(expectedTitle('pl'));
  await expect(page.locator('[data-automation-id="msp-email-field"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  expect(await page.title()).toContain(expectedTitle('pl'));
});
