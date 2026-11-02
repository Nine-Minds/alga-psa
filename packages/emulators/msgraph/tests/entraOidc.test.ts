import { createHash } from 'node:crypto';
import { Auth } from '@auth/core';
import { createLocalJWKSet, decodeJwt, jwtVerify } from 'jose';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraphEmulator from '../src/index';
import { MsGraphCore } from '../src/core';
import { signEntraIdToken } from '../src/entraOidc';
import { buildMicrosoftSsoEmulatorProvider } from '../../../auth/src/lib/sso/microsoftSsoEmulator';

let host: EmulatorHost;
let base: string;
const tenant = '11111111-2222-4333-8444-555555555555';
const clientId = 'co-managed-oidc-test';
const clientSecret = 'synthetic-test-secret';

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
  const { ports, controlPort } = await host.start();
  base = `http://127.0.0.1:${ports.msgraph}`;
  await fetch(`http://127.0.0.1:${controlPort}/control/msgraph/seed/client`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }),
  });
});
// Per test, not in beforeAll: server/src/test/setup.ts sweeps
// vi.unstubAllEnvs() after every unit test, so a stub established once would
// send every later provider to the default simulator port instead.
beforeEach(() => { vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', base); });
afterAll(async () => { vi.unstubAllEnvs(); await host.stop(); });

async function authorization(nonce = 'request-nonce', challenge?: string) {
  const url = new URL(`${base}/${tenant}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: 'http://app.test/callback',
    scope: 'openid email profile', nonce,
    ...(challenge ? { code_challenge: challenge, code_challenge_method: 'S256' } : {}),
  }).toString();
  const response = await fetch(url, { redirect: 'manual' });
  return new URL(response.headers.get('location')!).searchParams.get('code')!;
}
async function redeem(code: string, verifier?: string) {
  return fetch(`${base}/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
      redirect_uri: 'http://app.test/callback', code, ...(verifier ? { code_verifier: verifier } : {}),
    }),
  });
}

it('discovers a signed authority and binds the ID token to issuer, audience, tenant and nonce', async () => {
  const issuer = `${base}/${tenant}/v2.0`;
  const discovery = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
  expect(discovery.issuer).toBe(issuer);
  expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
  const keys = createLocalJWKSet(await (await fetch(discovery.jwks_uri)).json());
  const tokens = await (await redeem(await authorization())).json();
  const { payload, protectedHeader } = await jwtVerify(tokens.id_token, keys, { issuer, audience: clientId });
  expect(protectedHeader.alg).toBe('RS256');
  expect(payload).toMatchObject({ tid: tenant, nonce: 'request-nonce', sub: 'emulated-user' });
  // One 5-minute token, no refresh path.
  expect(payload.exp! - payload.iat!).toBe(300);
  expect(tokens.refresh_token).toBeUndefined();
  await expect(jwtVerify(tokens.id_token, keys, { issuer, audience: 'another-client' })).rejects.toThrow();
  await expect(jwtVerify(tokens.id_token, keys, { issuer: `${base}/another-tenant/v2.0`, audience: clientId })).rejects.toThrow();
  const [header, body, signature] = tokens.id_token.split('.');
  const forged = `${header}.${body}.${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
  await expect(jwtVerify(forged, keys, { issuer, audience: clientId })).rejects.toThrow();
});

it('refuses missing or wrong PKCE verifiers without consuming a usable code, then refuses replay', async () => {
  const verifier = 'v'.repeat(64);
  const code = await authorization('pkce-nonce', createHash('sha256').update(verifier).digest('base64url'));
  expect((await redeem(code)).status).toBe(400);
  expect((await redeem(code, 'w'.repeat(64))).status).toBe(400);
  expect((await redeem(code, verifier)).status).toBe(200);
  expect((await redeem(code, verifier)).status).toBe(400);
});

it('refuses exchanging a code at another tenant authority', async () => {
  const code = await authorization();
  const response = await fetch(`${base}/another-tenant/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
      redirect_uri: 'http://app.test/callback', code }),
  });
  expect(response.status).toBe(400);
  expect((await redeem(code)).status).toBe(200);
});

it('binds an authorization code to its original user despite another account signing in before redemption', () => {
  const core = new MsGraphCore({ clock: { now: () => new Date() }, rng: () => 0.5, log: () => undefined });
  core.registerClient(clientId, clientSecret);
  core.signedInUser = { id: 'first-admin', mail: 'first@example.test', userPrincipalName: 'first@example.test' };
  const code = core.authorize(clientId, 'http://app.test/callback', { nonce: 'first-nonce' });
  core.signedInUser = { id: 'other-admin', mail: 'other@example.test', userPrincipalName: 'other@example.test' };
  const tokens = core.grantToken({ client_id: clientId, client_secret: clientSecret,
    grant_type: 'authorization_code', code, redirect_uri: 'http://app.test/callback' });
  expect(decodeJwt(tokens.id_token!)).toMatchObject({ sub: 'first-admin', email: 'first@example.test', nonce: 'first-nonce' });
});

it.each([
  ['issuer', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
  ['audience', 'ERR_JWT_CLAIM_VALIDATION_FAILED'],
  ['signature', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED'],
] as const)('the application provider rejects an ID token with a forged %s', async (field, code) => {
  const tokens = await (await redeem(await authorization())).json();
  const claims = decodeJwt(tokens.id_token);
  if (field === 'issuer') claims.iss = `${base}/another-tenant/v2.0`;
  if (field === 'audience') claims.aud = 'another-application';
  let forged = signEntraIdToken(claims, Math.floor(Date.now() / 1000));
  if (field === 'signature') {
    const parts = forged.split('.');
    parts[2] = `${parts[2].startsWith('A') ? 'B' : 'A'}${parts[2].slice(1)}`;
    forged = parts.join('.');
  }
  const provider = buildMicrosoftSsoEmulatorProvider({ clientId, clientSecret, authority: tenant, profile: async profile => profile });
  // The verification error itself, so an unreachable JWKS cannot pass this.
  await expect(provider.token.conform(new Response(JSON.stringify({ ...tokens, id_token: forged }))))
    .rejects.toMatchObject({ code });
});

it('the application provider rejects a correctly signed expired ID token', async () => {
  const tokens = await (await redeem(await authorization())).json();
  const expired = signEntraIdToken(decodeJwt(tokens.id_token), Math.floor(Date.now() / 1000) - 7200);
  const provider = buildMicrosoftSsoEmulatorProvider({ clientId, clientSecret, authority: tenant, profile: async profile => profile });
  await expect(provider.token.conform(new Response(JSON.stringify({ ...tokens, id_token: expired })))).rejects.toThrow(/exp/);
});

async function authJourney(tamper?: 'state' | 'nonce') {
  const jar = new Map<string, string>();
  const provider = buildMicrosoftSsoEmulatorProvider({ clientId, clientSecret, authority: tenant,
    profile: async profile => ({ id: profile.sub, name: profile.name, email: profile.email }),
  });
  expect(provider.checks).toEqual(['pkce', 'state', 'nonce']);
  const errors: unknown[] = [];
  const config = { secret: 'synthetic-session-secret-with-enough-length', trustHost: true, basePath: '/api/auth',
    providers: [provider], logger: { error: (error: unknown) => { errors.push(error); } },
  };
  const request = async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
    const response = await Auth(new Request(url, { ...init, headers }), config);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const index = pair.indexOf('=');
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  };
  const csrf = await (await request('http://app.test/api/auth/csrf')).json();
  const signIn = await request('http://app.test/api/auth/signin/azure-ad', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: 'http://app.test/' }),
  });
  const authorize = new URL(signIn.headers.get('location')!);
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize.searchParams.get('nonce')).toBeTruthy();
  if (tamper === 'nonce') authorize.searchParams.set('nonce', 'foreign-authorization-nonce');
  const callback = new URL((await fetch(authorize, { redirect: 'manual' })).headers.get('location')!);
  if (tamper === 'state') callback.searchParams.set('state', 'foreign-browser-state');
  await request(callback.toString());
  const session = await (await request('http://app.test/api/auth/session')).json();
  return { session, errors };
}

it('runs the application emulator provider through real Auth.js discovery, callback and session creation', async () => {
  const { session, errors } = await authJourney();
  expect(errors).toEqual([]);
  expect(session.user.email).toBe('support@example.test');
});

it.each(['state', 'nonce'] as const)('refuses a callback with a different %s and creates no session', async tamper => {
  const { session, errors } = await authJourney(tamper);
  expect(errors.length).toBeGreaterThan(0);
  expect(session).toBeNull();
});
