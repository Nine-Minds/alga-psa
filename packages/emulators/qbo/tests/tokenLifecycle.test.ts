import { afterEach, beforeEach, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import qbo from '../src/index';

// Intuit documents finite refresh validity and reauthorization after expiry:
// https://developers.intuit.com/app/developer/qbpayments/docs/develop/authentication-and-authorization/oauth-2.0
// The Ruby SDK documents the response's x_refresh_token_expires_in field:
// https://developers.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/ruby/oauth-ruby-client
// Exercise the advertised lifetime rather than assuming a fixed 100/101 days
// or asserting undocumented rotation grace semantics. Each case owns its clock.
let host: EmulatorHost;
let vendor: string;
const redirectUri = 'http://localhost/qbo-lifecycle-callback';
const authorization = `Basic ${Buffer.from('lifecycle-app:fixture-secret').toString('base64')}`;

beforeEach(async () => {
  host = new EmulatorHost({ emulators: [qbo], controlPort: 0, ports: { qbo: 0 } });
  const { controlPort, ports } = await host.start();
  vendor = `http://127.0.0.1:${ports.qbo}`;
  const seeded = await fetch(`http://127.0.0.1:${controlPort}/control/qbo/seed/client`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 'lifecycle-app', clientSecret: 'fixture-secret' }),
  });
  expect((await seeded.json()).ok).toBe(true);
});
afterEach(async () => { await host?.stop(); });

const tokenRequest = (params: Record<string, string>, auth = authorization) => fetch(`${vendor}/oauth2/v1/tokens/bearer`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: auth },
  body: new URLSearchParams(params),
});
const refresh = (token: string) => tokenRequest({ grant_type: 'refresh_token', refresh_token: token });

async function authorize() {
  const response = await fetch(`${vendor}/connect/oauth2?${new URLSearchParams({
    client_id: 'lifecycle-app', redirect_uri: redirectUri, response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting', state: 'fixture-state',
  })}`, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get('location')!);
  expect(callback.searchParams.get('state')).toBe('fixture-state');
  const exchanged = await tokenRequest({ grant_type: 'authorization_code', code: callback.searchParams.get('code')!, redirect_uri: redirectUri });
  expect(exchanged.status).toBe(200);
  const tokens = await exchanged.json();
  expect(tokens.x_refresh_token_expires_in).toBeGreaterThan(0);
  return tokens;
}

it('rejects an unused refresh token at its advertised deadline and recovers through reauthorization', async () => {
  const initial = await authorize();
  host.clock.advance(`${initial.x_refresh_token_expires_in}s`);
  const expired = await refresh(initial.refresh_token);
  expect(expired.status).toBe(400);
  expect(await expired.json()).toMatchObject({ error: 'invalid_grant' });
  const replacement = await authorize();
  const company = await fetch(`${vendor}/v3/company/realm-sim/companyinfo/realm-sim`, {
    headers: { authorization: `Bearer ${replacement.access_token}` },
  });
  expect(company.status).toBe(200);
  expect((await company.json()).CompanyInfo.Id).toBe('realm-sim');
  expect((await refresh(initial.refresh_token)).status).toBe(400);
});

it('renews before the deadline and applies the returned lifetime to the newly issued refresh token', async () => {
  const initial = await authorize();
  host.clock.advance(`${initial.x_refresh_token_expires_in - 1}s`);
  const renewed = await refresh(initial.refresh_token);
  expect(renewed.status).toBe(200);
  let tokens = await renewed.json();
  expect(tokens.x_refresh_token_expires_in).toBeGreaterThan(1);
  // Crossing the original token's deadline must not expire the new token.
  host.clock.advance('1s');
  const continuation = await refresh(tokens.refresh_token);
  expect(continuation.status).toBe(200);
  tokens = await continuation.json();
  expect(tokens.x_refresh_token_expires_in).toBeGreaterThan(0);
  host.clock.advance(`${tokens.x_refresh_token_expires_in}s`);
  const expired = await refresh(tokens.refresh_token);
  expect(expired.status).toBe(400);
  expect(await expired.json()).toMatchObject({ error: 'invalid_grant' });
});

it('does not consume a valid refresh token when client authentication fails', async () => {
  const initial = await authorize();
  const rejected = await tokenRequest({ grant_type: 'refresh_token', refresh_token: initial.refresh_token },
    `Basic ${Buffer.from('lifecycle-app:wrong-secret').toString('base64')}`);
  expect(rejected.status).toBe(401);
  expect(await rejected.json()).toMatchObject({ error: 'invalid_client' });
  expect((await refresh(initial.refresh_token)).status).toBe(200);
});
