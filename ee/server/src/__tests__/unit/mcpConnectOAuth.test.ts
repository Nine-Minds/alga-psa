import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

/**
 * "Connect with Microsoft/Google" round-trip. The shared-app secret lookup,
 * hosted-enabled checks, and the IdP token exchange (fetch) are mocked; the
 * state/HMAC-cookie binding and id_token claim extraction are real.
 *
 * Load-bearing invariant: an interactive id_token has no `azp`, so the captured
 * subject is `sub` — which is exactly what the Microsoft/Google built-ins resolve
 * against in idpToken.ts (`payload[subjectClaim] ?? payload.sub`).
 */

vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: vi.fn() }));
vi.mock('@ee/lib/mcp/idpBuiltins', () => ({
  hostedMicrosoftEnabled: vi.fn(),
  hostedGoogleEnabled: vi.fn(),
}));

import {
  buildConnectAuthUrl,
  completeConnectCallback,
  listPlatformProviders,
} from '@ee/lib/mcp/connectOAuth';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hostedMicrosoftEnabled, hostedGoogleEnabled } from '@ee/lib/mcp/idpBuiltins';

const mSecrets = vi.mocked(getSecretProviderInstance);
const mMsEnabled = vi.mocked(hostedMicrosoftEnabled);
const mGoogleEnabled = vi.mocked(hostedGoogleEnabled);

const APP_SECRETS: Record<string, string> = {
  MICROSOFT_OAUTH_CLIENT_ID: 'ms-client-id',
  MICROSOFT_OAUTH_CLIENT_SECRET: 'ms-client-secret',
  GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
};

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-mcp-connect';
});

beforeEach(() => {
  vi.clearAllMocks();
  mMsEnabled.mockResolvedValue(true);
  mGoogleEnabled.mockResolvedValue(true);
  mSecrets.mockResolvedValue({
    getAppSecret: vi.fn(async (name: string) => APP_SECRETS[name] ?? ''),
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signIdToken(claims: Record<string, unknown>): Promise<string> {
  // decodeJwt does not verify, so any well-formed JWS works.
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode('signing-key-irrelevant-to-decode'));
}

function stubTokenEndpoint(idToken: string, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => ({ id_token: idToken, access_token: 'should-be-discarded', refresh_token: 'discarded' }),
      text: async () => 'error-body',
    })),
  );
}

describe('buildConnectAuthUrl', () => {
  it('builds a Microsoft authorize URL with OIDC scopes + a signed state cookie', async () => {
    const { authUrl, stateCookie } = await buildConnectAuthUrl({
      provider: 'microsoft',
      tenant: 'tenant-1',
      userId: 'user-1',
      baseUrl: 'http://localhost:3000',
    });
    const u = new URL(authUrl);
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(u.searchParams.get('client_id')).toBe('ms-client-id');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/mcp/connect/callback');
    expect(u.searchParams.get('state')).toBeTruthy();
    expect(stateCookie.name).toBe('mcp_connect_state');
    expect(stateCookie.value).toMatch(/^[a-f0-9]{64}$/); // HMAC-SHA256 hex
  });

  it('refuses when the shared app is not configured', async () => {
    mMsEnabled.mockResolvedValue(false);
    await expect(
      buildConnectAuthUrl({ provider: 'microsoft', tenant: 't', userId: 'u', baseUrl: 'http://x' }),
    ).rejects.toThrow(/not configured/i);
  });
});

describe('completeConnectCallback', () => {
  async function start(provider: 'microsoft' | 'google', tenant = 'tenant-1') {
    const { authUrl, stateCookie } = await buildConnectAuthUrl({
      provider,
      tenant,
      userId: 'user-1',
      baseUrl: 'http://localhost:3000',
    });
    const state = new URL(authUrl).searchParams.get('state') as string;
    return { state, cookie: stateCookie.value };
  }

  it('exchanges the code and returns {issuer, subject=sub, label=email} (Microsoft, no azp)', async () => {
    const { state, cookie } = await start('microsoft');
    const issuer = 'https://login.microsoftonline.com/abc-tenant/v2.0';
    stubTokenEndpoint(await signIdToken({ iss: issuer, sub: 'ms-user-sub', email: 'bot@contoso.com', aud: 'ms-client-id' }));

    const identity = await completeConnectCallback({
      code: 'auth-code',
      state,
      cookieState: cookie,
      baseUrl: 'http://localhost:3000',
      sessionTenant: 'tenant-1',
    });

    expect(identity).toEqual({
      provider: 'microsoft',
      issuer,
      subject: 'ms-user-sub', // captured from sub — matches the built-in azp→sub fallback
      label: 'bot@contoso.com',
    });
  });

  it('extracts the Google identity (sub + email)', async () => {
    const { state, cookie } = await start('google');
    stubTokenEndpoint(
      await signIdToken({ iss: 'https://accounts.google.com', sub: '11622', email: 'ops@acme.com', aud: 'google-client-id' }),
    );
    const identity = await completeConnectCallback({
      code: 'c',
      state,
      cookieState: cookie,
      baseUrl: 'http://localhost:3000',
      sessionTenant: 'tenant-1',
    });
    expect(identity.issuer).toBe('https://accounts.google.com');
    expect(identity.subject).toBe('11622');
    expect(identity.label).toBe('ops@acme.com');
  });

  it('rejects a mismatched state cookie (CSRF binding)', async () => {
    const { state } = await start('microsoft');
    stubTokenEndpoint(await signIdToken({ iss: 'i', sub: 's' }));
    await expect(
      completeConnectCallback({
        code: 'c',
        state,
        cookieState: 'deadbeef'.repeat(8),
        baseUrl: 'http://localhost:3000',
        sessionTenant: 'tenant-1',
      }),
    ).rejects.toThrow(/state\/cookie mismatch/i);
  });

  it('rejects when the session tenant does not match the state tenant', async () => {
    const { state, cookie } = await start('microsoft', 'tenant-1');
    stubTokenEndpoint(await signIdToken({ iss: 'i', sub: 's' }));
    await expect(
      completeConnectCallback({
        code: 'c',
        state,
        cookieState: cookie,
        baseUrl: 'http://localhost:3000',
        sessionTenant: 'tenant-2',
      }),
    ).rejects.toThrow(/tenant mismatch/i);
  });

  it('rejects a token whose audience is not the shared app', async () => {
    const { state, cookie } = await start('microsoft');
    stubTokenEndpoint(await signIdToken({ iss: 'i', sub: 's', aud: 'some-other-app' }));
    await expect(
      completeConnectCallback({
        code: 'c',
        state,
        cookieState: cookie,
        baseUrl: 'http://localhost:3000',
        sessionTenant: 'tenant-1',
      }),
    ).rejects.toThrow(/audience/i);
  });
});

describe('listPlatformProviders', () => {
  it('returns both providers when both shared apps are enabled', async () => {
    const out = await listPlatformProviders('tenant-1');
    expect(out.map((p) => p.provider)).toEqual(['microsoft', 'google']);
    expect(out.find((p) => p.provider === 'google')?.issuer).toBe('https://accounts.google.com');
  });

  it('omits providers whose shared app is absent', async () => {
    mMsEnabled.mockResolvedValue(false);
    const out = await listPlatformProviders('tenant-1');
    expect(out.map((p) => p.provider)).toEqual(['google']);
  });
});
