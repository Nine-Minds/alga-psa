import { afterEach, beforeEach, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import xero from '../src/index';

// Independent provider contract, reviewed 2026-09-08:
// https://developer.xero.com/faq/oauth2
// Rotated refresh tokens have a 30-minute retry grace period; unused tokens
// expire after 60 days. Use a private clock so accounting sessions cannot age.
let host: EmulatorHost;
let vendor: string;
const redirectUri = 'http://localhost/xero-fixture-callback';
const scope = 'offline_access accounting.invoices accounting.contacts';
const authorization = `Basic ${Buffer.from('lifecycle-app:fixture-secret').toString('base64')}`;

beforeEach(async () => {
  host = new EmulatorHost({ emulators: [xero], controlPort: 0, ports: { xero: 0 } });
  const { controlPort, ports } = await host.start();
  vendor = `http://127.0.0.1:${ports.xero}`;
  const seeded = await fetch(`http://127.0.0.1:${controlPort}/control/xero/seed/application`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'confidential', clientId: 'lifecycle-app', clientSecret: 'fixture-secret', redirectUris: [redirectUri] }),
  });
  expect((await seeded.json()).ok).toBe(true);
});
afterEach(async () => { await host?.stop(); });

const tokenRequest = (params: Record<string, string>, auth = authorization) => fetch(`${vendor}/connect/token`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: auth },
  body: new URLSearchParams(params),
});
async function authorize(requestedScope = scope) {
  const response = await fetch(`${vendor}/identity/connect/authorize?${new URLSearchParams({
    client_id: 'lifecycle-app', redirect_uri: redirectUri, response_type: 'code', scope: requestedScope, state: 'fixture-state',
  })}`, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get('location')!);
  expect(callback.searchParams.get('state')).toBe('fixture-state');
  const exchanged = await tokenRequest({ grant_type: 'authorization_code', code: callback.searchParams.get('code')!, redirect_uri: redirectUri });
  expect(exchanged.status).toBe(200);
  return exchanged.json();
}

it('does not issue a refresh token without offline_access consent', async () => {
  const tokens = await authorize('accounting.invoices');
  expect(tokens.scope).toBe('accounting.invoices');
  expect(tokens.access_token).toEqual(expect.any(String));
  expect(tokens).not.toHaveProperty('refresh_token');
});

it('recovers a lost refresh response within 30 minutes without extending the old token deadline', async () => {
  const initial = await authorize();
  const params = { grant_type: 'refresh_token', refresh_token: initial.refresh_token };
  const first = await tokenRequest(params);
  expect(first.status).toBe(200);
  const rotated = await first.json();
  expect(rotated.refresh_token).not.toBe(initial.refresh_token);
  host.clock.advance('29m');
  const retried = await tokenRequest(params);
  expect(retried.status).toBe(200);
  const recovered = await retried.json();
  expect(recovered.scope).toBe(scope);
  expect(recovered.refresh_token).not.toBe(initial.refresh_token);
  host.clock.advance('61s');
  const expired = await tokenRequest(params);
  expect(expired.status).toBe(400);
  expect(await expired.json()).toEqual({ error: 'invalid_grant' });
  const continuation = await tokenRequest({ grant_type: 'refresh_token', refresh_token: recovered.refresh_token });
  expect(continuation.status).toBe(200);
});

it('expires an unused refresh token after 60 days', async () => {
  const initial = await authorize();
  host.clock.advance('60d');
  const response = await tokenRequest({ grant_type: 'refresh_token', refresh_token: initial.refresh_token });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'invalid_grant' });
});
