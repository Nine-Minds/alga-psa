import { test, expect } from '@playwright/test';

const cases = [
  { name: 'missing code', query: { state: 'invalid' }, error: 'missing_parameters' },
  { name: 'missing state', query: { code: 'fixture-code' }, error: 'missing_parameters' },
  { name: 'malformed state', query: { code: 'fixture-code', state: 'invalid-state-not-base64' }, error: 'ms_email_invalid_state' },
  { name: 'unsigned state', query: { code: 'fixture-code', state: Buffer.from(JSON.stringify({ tenant: 'fixture-tenant', nonce: 'fixture-nonce', expiresAt: 4102444800 })).toString('base64url') }, error: 'ms_email_invalid_state' },
];
for (const scenario of cases) {
  test(`Microsoft email callback rejects ${scenario.name} through the popup result`, async ({ page }) => {
    await page.goto('/auth/msp/signin');
    await page.evaluate(() => {
      (window as any).__oauthResults = [];
      window.addEventListener('message', event => {
        if (event.origin === window.location.origin && event.data?.type === 'oauth-callback') {
          (window as any).__oauthResults.push(event.data);
        }
      });
    });
    const popupEvent = page.waitForEvent('popup');
    await page.evaluate(url => window.open(url, 'oauth-rejection'), `/api/auth/microsoft/callback?${new URLSearchParams(scenario.query)}`);
    const popup = await popupEvent;
    await expect.poll(() => page.evaluate(() => (window as any).__oauthResults)).toEqual([
      expect.objectContaining({ type: 'oauth-callback', provider: 'microsoft', success: false, error: scenario.error }),
    ]);
    await expect.poll(() => popup.isClosed()).toBe(true);
    const session = await page.request.get('/api/auth/session');
    expect(session.ok()).toBe(true);
    expect((await session.json()).user).toBeUndefined();
  });
}
