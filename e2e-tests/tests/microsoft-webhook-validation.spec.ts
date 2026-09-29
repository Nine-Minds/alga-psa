import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

for (const route of [
  '/api/calendar/webhooks/microsoft',
  '/api/email/webhooks/microsoft',
  '/api/teams/webhooks/recordings',
  '/api/telephony/webhooks/teams-calls',
]) {
  test(`Microsoft subscription validation echoes the opaque token: ${route}`, async ({ request }, testInfo) => {
    // Exercise the running app's routing, middleware and response serialization.
    // URL encoding must be undone once, without interpreting '+' or '%' again.
    const token = `contract ${randomUUID()} + %2F / café`;
    const response = await request.post(`${route}?${new URLSearchParams({ validationToken: token })}`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      timeout: testInfo.config.metadata.releaseValidation === false ? 120_000 : 10_000,
    });
    if (process.env.E2E_EDITION !== 'enterprise' && route !== '/api/email/webhooks/microsoft') {
      expect(response.status()).toBe(501);
      expect((await response.json()).success).toBe(false);
      return;
    }
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']?.split(';', 1)[0]).toBe('text/plain');
    expect(await response.text()).toBe(token);
    // Once compiled, the callback must meet Graph's ten-second handshake budget.
    const warmResponse = await request.post(`${route}?${new URLSearchParams({ validationToken: token })}`, {
      headers: { 'content-type': 'text/plain; charset=utf-8' }, timeout: 10_000,
    });
    expect(warmResponse.status()).toBe(200);
    expect(await warmResponse.text()).toBe(token);
  });
}

