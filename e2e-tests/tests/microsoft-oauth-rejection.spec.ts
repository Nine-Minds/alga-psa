import { test, expect } from '@playwright/test';

const cases = [
  { name: 'missing code', query: { state: 'invalid' }, error: 'missing_parameters' },
  { name: 'missing state', query: { code: 'fixture-code' }, error: 'missing_parameters' },
  { name: 'malformed state', query: { code: 'fixture-code', state: 'invalid-state-not-base64' }, error: 'ms_email_invalid_state' },
  { name: 'unsigned state', query: { code: 'fixture-code', state: Buffer.from(JSON.stringify({ tenant: 'fixture-tenant', nonce: 'fixture-nonce', expiresAt: 4102444800 })).toString('base64url') }, error: 'ms_email_invalid_state' },
];
for (const scenario of cases) {
  test(`Microsoft email callback rejects ${scenario.name} through the popup result`, async ({ page }) => {
    const oauthResults: unknown[] = [];
    await page.exposeFunction('__recordOAuthResult', (result: unknown) => oauthResults.push(result));
    // Install before navigation so a document replacement cannot lose the
    // listener. Keep results in the runner, outside the page execution context.
    await page.addInitScript(() => {
      window.addEventListener('message', event => {
        if (event.origin === window.location.origin && event.data?.type === 'oauth-callback') {
          void (window as any).__recordOAuthResult(event.data);
        }
      });
    });
    await page.goto('/auth/msp/signin');
    if (scenario.name === 'missing code') await page.reload();
    const popupEvent = page.waitForEvent('popup');
    await page.evaluate(url => { window.open(url, 'oauth-rejection'); }, `/api/auth/microsoft/callback?${new URLSearchParams(scenario.query)}`);
    const popup = await popupEvent;
    await expect.poll(() => oauthResults).toEqual([
      expect.objectContaining({ type: 'oauth-callback', provider: 'microsoft', success: false, error: scenario.error }),
    ]);
    await expect.poll(() => popup.isClosed()).toBe(true);
    const session = await page.request.get('/api/auth/session');
    expect(session.ok()).toBe(true);
    expect((await session.json()).user).toBeUndefined();
  });
}
