import { afterEach, beforeEach, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import qbo from '../src/index';

// Intuit SDK: JSON { token }, Basic auth, either token type, empty 200 success.
// https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js
// https://github.com/intuit/oauth-jsclient/blob/master/test/OAuthClientTest.js
// Unknown/repeated success and grant-wide invalidation are RFC 7009 choices:
// https://www.rfc-editor.org/rfc/rfc7009.html#section-2
// These edge semantics are not independently verified against Intuit.
let host: EmulatorHost;
let vendor: string;
const auth = (client = 'revoke-app', secret = 'fixture-secret') =>
  `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}`;
beforeEach(async () => {
  host = new EmulatorHost({ emulators: [qbo], controlPort: 0, ports: { qbo: 0 } });
  const { controlPort, ports } = await host.start();
  vendor = `http://127.0.0.1:${ports.qbo}`;
  for (const clientId of ['revoke-app', 'other-app']) {
    const seeded = await fetch(`http://127.0.0.1:${controlPort}/control/qbo/seed/client`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret: 'fixture-secret' }),
    });
    expect((await seeded.json()).ok).toBe(true);
  }
});
afterEach(async () => { await host?.stop(); });
const revoke = (token: unknown, authorization = auth()) => fetch(`${vendor}/v2/oauth2/tokens/revoke`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: JSON.stringify({ token }),
});
const tokenRequest = (params: Record<string, string>) => fetch(`${vendor}/oauth2/v1/tokens/bearer`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: auth() },
  body: new URLSearchParams(params),
});
const refresh = (token: string) => tokenRequest({ grant_type: 'refresh_token', refresh_token: token });
const company = (token: string) => fetch(`${vendor}/v3/company/realm-sim/companyinfo/realm-sim`, {
  headers: { authorization: `Bearer ${token}` },
});
async function authorize() {
  const redirectUri = 'http://localhost/revoke-callback';
  const response = await fetch(`${vendor}/connect/oauth2?${new URLSearchParams({ client_id: 'revoke-app', redirect_uri: redirectUri })}`, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
  const result = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  expect(result.status).toBe(200);
  return result.json();
}
it.each(['refresh_token', 'access_token'])('revoking %s disables both credentials and reauthorization recovers', async (field) => {
  const initial = await authorize();
  expect((await company(initial.access_token)).status).toBe(200);
  const response = await revoke(initial[field]);
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('');
  expect((await company(initial.access_token)).status).toBe(401);
  const rejected = await refresh(initial.refresh_token);
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: 'invalid_grant' });
  const replacement = await authorize();
  expect((await company(replacement.access_token)).status).toBe(200);
});
it('revokes surviving access tokens from the refreshed grant without disabling a separate grant', async () => {
  const original = await authorize();
  const independent = await authorize();
  const renewedResponse = await refresh(original.refresh_token);
  expect(renewedResponse.status).toBe(200);
  const renewed = await renewedResponse.json();
  expect((await revoke(renewed.refresh_token)).status).toBe(200);
  for (const access of [original.access_token, renewed.access_token]) expect((await company(access)).status).toBe(401);
  expect((await refresh(renewed.refresh_token)).status).toBe(400);
  expect((await company(independent.access_token)).status).toBe(200);
  expect((await refresh(independent.refresh_token)).status).toBe(200);
});
it('keeps unknown and repeated revocation idempotent', async () => {
  const initial = await authorize();
  expect((await revoke('unknown-token')).status).toBe(200);
  expect((await company(initial.access_token)).status).toBe(200);
  expect((await revoke(initial.refresh_token)).status).toBe(200);
  expect((await revoke(initial.refresh_token)).status).toBe(200);
  expect((await company(initial.access_token)).status).toBe(401);
});
it('authenticates before token handling and rejects missing or malformed tokens', async () => {
  const initial = await authorize();
  for (const authorization of [auth('revoke-app', 'wrong-secret'), auth('unknown-app'), '']) {
    const rejected = await revoke(initial.refresh_token, authorization);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({ error: 'invalid_client' });
  }
  for (const token of [undefined, null, '', [], {}]) {
    const missing = await revoke(token);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'invalid_request' });
  }
  expect((await company(initial.access_token)).status).toBe(200);
  expect((await refresh(initial.refresh_token)).status).toBe(200);
});
it('cannot revoke a token issued to another authenticated client', async () => {
  const initial = await authorize();
  const rejected = await revoke(initial.refresh_token, auth('other-app'));
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toMatchObject({ error: 'invalid_grant' });
  expect((await company(initial.access_token)).status).toBe(200);
  expect((await refresh(initial.refresh_token)).status).toBe(200);
});
