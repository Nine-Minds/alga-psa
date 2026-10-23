import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '@alga-psa/emulator-msgraph';

/**
 * The ticket's failure — a Microsoft account whose mail is
 * nd@computerbutlereurope.onmicrosoft.com while the AlgaPSA login is
 * nd@computerbutler.eu — driven over the Microsoft simulator's own login and
 * Graph wire instead of a hand-written profile literal. The authorization
 * redirect, code exchange and `/me` lookup all execute; only the AlgaPSA
 * database and session store are fixtures. Unit coverage of the sentinel lives
 * in packages/auth/src/lib/nextAuthOptions.authFailureRedirect.test.ts; this
 * file pins that the provider the app builds reaches the simulator and that a
 * real Entra-shaped profile ends on a readable URL rather than Auth.js
 * `error=Configuration`.
 *
 * This lives under server/ rather than packages/auth/ because a real,
 * unmocked import of @alga-psa/emulator-msgraph from inside packages/auth
 * closes a project-graph cycle: emulator-msgraph already depends on
 * @alga-psa/integrations, which depends (via email -> tenancy ->
 * user-composition) back on @alga-psa/auth. server/ sits above all of those
 * projects already, so it can import the real simulator without creating a
 * new edge.
 */

const CLIENT_ID = 'simulated-msp-sso-client';
const CLIENT_SECRET = 'simulated-msp-sso-secret';
const PROVIDER_EMAIL = 'ND@computerbutlereurope.onmicrosoft.com';
const ALGA_EMAIL = 'nd@computerbutler.eu';
const LINK_STATE_COOKIE_NAME = 'sso-link-state';

const findUserByEmailAndTypeMock = vi.fn(async (_email: string, _type: string): Promise<unknown> => undefined);
const userSessionCreateMock = vi.fn(async () => 'session-1');
const cookieGetMock = vi.fn((_name: string): { value: string } | undefined => undefined);
const cookieDeleteMock = vi.fn();
const applyOAuthAccountHintsMock = vi.fn(async (user: unknown) => user);

vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/keycloak', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/azure-ad', () => ({ default: (config: unknown) => config }));

vi.mock('@alga-psa/auth/session', () => ({
  getNextAuthSecret: async () => 'unit-test-secret',
  getNextAuthSecretSync: () => 'unit-test-secret',
  getSessionCookieConfig: () => ({ name: 'authjs.session-token', options: {} }),
  getSessionMaxAge: () => 60 * 60,
  isSecureCookieEnvironment: () => false,
  withDevPortSuffix: (value: string) => value,
}));

vi.mock('@alga-psa/auth/lib/PortalDomainSessionToken', () => ({ issuePortalDomainOtt: vi.fn() }));

vi.mock('@alga-psa/validation', () => ({
  buildTenantPortalSlug: () => 'tenant-slug',
  isValidTenantSlug: () => true,
}));

// CE mapping path, so the real ceOAuthProfileMapper decides the outcome.
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: async () => undefined,
  }),
}));

vi.mock('@alga-psa/auth/lib/sso/registry', () => ({
  getSSORegistry: () => ({
    applyOAuthAccountHints: (...args: unknown[]) => applyOAuthAccountHintsMock(...args),
    mapOAuthProfileToExtendedUser: vi.fn(),
    decodeOAuthJwtPayload: vi.fn(() => null),
    findOAuthAccountLink: vi.fn(async () => undefined),
    isAutoLinkEnabledForTenant: vi.fn(async () => false),
    upsertOAuthAccountLink: vi.fn(),
  }),
  registerSSOProvider: vi.fn(),
}));

vi.mock('@alga-psa/auth/lib/sso/enterpriseRegistryEntry', () => ({
  loadEnterpriseSsoProviderRegistryImpl: async () => null,
}));

vi.mock('next/headers.js', () => ({
  cookies: async () => ({
    get: (...args: [string]) => cookieGetMock(...args),
    set: vi.fn(),
    delete: (...args: unknown[]) => cookieDeleteMock(...args),
  }),
}));

vi.mock('@alga-psa/auth/lib/sso/mspSsoResolution', () => ({
  MSP_SSO_DISCOVERY_TTL_SECONDS: 300,
  MSP_SSO_GENERIC_FAILURE_MESSAGE: 'generic failure',
  MSP_SSO_RESOLUTION_COOKIE: 'msp_sso_resolution',
  MSP_SSO_RESOLUTION_TTL_SECONDS: 300,
  getMspSsoSigningSecret: async () => 'unit-test-secret',
  hasAppFallbackProviderCredentials: vi.fn(async () => false),
  hasTenantProviderCredentials: vi.fn(async () => false),
  isValidClientPortalResolverCallbackUrl: vi.fn(() => true),
  normalizeResolverEmail: (value: string) => value.trim().toLowerCase(),
  parseAndVerifyMspSsoResolutionCookie: vi.fn(() => null),
  parseResolverProvider: vi.fn((value: string) => value),
}));

vi.mock('@alga-psa/auth/lib/sso/clientPortalSsoResolution', () => ({
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE: 'client_portal_sso_discovery',
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE: 'client_portal_sso_resolution',
  parseAndVerifyClientPortalSsoResolutionCookie: vi.fn(() => null),
}));

vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    create: (...args: unknown[]) => userSessionCreateMock(...args),
    enforceMaxSessions: vi.fn(async () => undefined),
    updateLocation: vi.fn(async () => undefined),
  },
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUserByEmailAndType: (...args: [string, string]) => findUserByEmailAndTypeMock(...args),
    updateLastLogin: vi.fn(async () => undefined),
  },
}));

vi.mock('@alga-psa/auth/ipAddress', () => ({ getClientIp: vi.fn() }));
vi.mock('@alga-psa/auth/deviceFingerprint', () => ({
  generateDeviceFingerprint: vi.fn(),
  getDeviceInfo: vi.fn(),
}));
vi.mock('@alga-psa/auth/geolocation', () => ({ getLocationFromIp: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/auth/lib/PortalDomainModel', () => ({
  getPortalDomain: vi.fn(),
  getPortalDomainByHostname: vi.fn(),
}));

const { getAuthOptions } = await import('@alga-psa/auth/nextAuthOptions');

let host: EmulatorHost;
let base: string;
let control: string;

async function controlPost(path: string, body: unknown = {}) {
  const response = await fetch(`${control}/control/msgraph/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result;
}

async function microsoftProvider() {
  const options = await getAuthOptions();
  const provider = (options.providers as Array<Record<string, any>>).find(
    (candidate) => candidate?.id === 'azure-ad'
  );
  expect(provider, 'Microsoft provider should be configured').toBeTruthy();
  return provider!;
}

/**
 * Replays the Auth.js authorization-code flow against the simulator exactly as
 * @auth/core does for a non-OIDC provider: authorize redirect, token exchange,
 * then the userinfo request whose body is handed to `profile()`.
 */
async function signInThroughSimulator() {
  const provider = await microsoftProvider();
  const redirectUri = 'http://localhost:3000/api/auth/callback/azure-ad';

  const authorize = new URL(provider.authorization.url);
  authorize.search = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: provider.authorization.params.scope,
    state: 'authjs-state',
  }).toString();
  const authorized = await fetch(authorize, { redirect: 'manual' });
  expect(authorized.status).toBe(302);
  const callback = new URL(authorized.headers.get('location')!);
  expect(callback.searchParams.get('state')).toBe('authjs-state');

  // @auth/core's default client auth is client_secret_basic: the credentials
  // ride in the Authorization header, form-urlencoded, and never in the body.
  const formUrlEncode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');
  const clientSecretBasic = `Basic ${Buffer.from(
    `${formUrlEncode(provider.clientId)}:${formUrlEncode(provider.clientSecret)}`
  ).toString('base64')}`;

  const tokenResponse = await fetch(provider.token.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: clientSecretBasic,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: callback.searchParams.get('code')!,
      redirect_uri: redirectUri,
    }),
  });
  expect(tokenResponse.ok).toBe(true);
  const tokens = await tokenResponse.json();

  const userinfoResponse = await fetch(provider.userinfo.url, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  expect(userinfoResponse.ok).toBe(true);
  const userinfo = await userinfoResponse.json();

  const user = await provider.profile(userinfo);
  return { provider, userinfo, user };
}

async function invokeSignIn(user: unknown) {
  const options = await getAuthOptions();
  return options.callbacks!.signIn!({
    user: user as any,
    account: { provider: 'azure-ad', providerAccountId: 'emulated-user' } as any,
    credentials: undefined,
    profile: undefined,
  } as any);
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await host?.stop();
});

beforeEach(async () => {
  vi.clearAllMocks();
  cookieGetMock.mockReturnValue(undefined);
  findUserByEmailAndTypeMock.mockResolvedValue(undefined);
  // Per test, not in beforeAll: server/src/test/setup.ts sweeps
  // vi.unstubAllEnvs() after every test outside the DB-backed lanes, so a
  // stub established once would be gone from the second test onward.
  vi.stubEnv('MICROSOFT_SSO_EMULATOR_MODE', 'true');
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', `${base}/`);
  vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${base}/v1.0`);
  vi.stubEnv('MICROSOFT_OAUTH_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('MICROSOFT_OAUTH_CLIENT_SECRET', CLIENT_SECRET);
  vi.stubEnv('MICROSOFT_OAUTH_TENANT_ID', 'common');
  await controlPost('reset');
  await controlPost('seed/client', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  // Entra hands out a mail that need not match the UPN; this is the ticket's
  // account, whose mail is on the tenant's .onmicrosoft.com domain.
  await controlPost('seed/signed-in-user', {
    id: 'nd-object-id',
    mail: PROVIDER_EMAIL,
    userPrincipalName: PROVIDER_EMAIL,
    displayName: 'ND',
  });
});

describe('Microsoft sign-in over the Microsoft simulator', () => {
  it('builds the provider against the simulator rather than Entra', async () => {
    const provider = await microsoftProvider();

    expect(new URL(provider.authorization.url).origin).toBe(base);
    expect(new URL(provider.token.url).origin).toBe(base);
    expect(new URL(provider.userinfo.url).origin).toBe(base);
    expect(provider.userinfo.url).toBe(`${base}/v1.0/me`);
  });

  it('turns the simulator profile into a sentinel instead of throwing', async () => {
    const { userinfo, user } = await signInThroughSimulator();

    expect(userinfo.mail).toBe(PROVIDER_EMAIL);
    // Thrown errors become Auth.js OAuthProfileParseError -> error=Configuration.
    expect(user.authFailure).toEqual({
      code: 'no_matching_user',
      providerEmail: PROVIDER_EMAIL.toLowerCase(),
      userType: 'internal',
    });
    expect(user.id).toBe('');
    expect(findUserByEmailAndTypeMock).toHaveBeenCalledWith(PROVIDER_EMAIL.toLowerCase(), 'internal');
  });

  it('sends a failed profile link back to the SSO tab naming the provider email', async () => {
    cookieGetMock.mockImplementation((name: string) =>
      name === LINK_STATE_COOKIE_NAME
        ? {
            value: Buffer.from(
              JSON.stringify({
                userId: 'user-1',
                nonce: 'nonce-1',
                issuedAt: Date.now(),
                signature: 'deadbeef',
              }),
              'utf8'
            ).toString('base64url'),
          }
        : undefined
    );

    const { user } = await signInThroughSimulator();

    expect(await invokeSignIn(user)).toBe(
      '/msp/profile?tab=single-sign-on&linkError=no_matching_user&providerEmail=nd%40computerbutlereurope.onmicrosoft.com'
    );
    expect(cookieDeleteMock).toHaveBeenCalledWith(LINK_STATE_COOKIE_NAME);
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('sends a failed plain sign-in to the MSP sign-in page with the reason', async () => {
    const { user } = await signInThroughSimulator();

    expect(await invokeSignIn(user)).toBe(
      '/auth/msp/signin?error=AccessDenied&reason=no_matching_user&providerEmail=nd%40computerbutlereurope.onmicrosoft.com'
    );
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('still signs in over the same wire when the mail does match an AlgaPSA user', async () => {
    await controlPost('seed/signed-in-user', { mail: ALGA_EMAIL, userPrincipalName: ALGA_EMAIL });
    findUserByEmailAndTypeMock.mockResolvedValue({
      user_id: 'user-1',
      email: ALGA_EMAIL,
      username: ALGA_EMAIL,
      first_name: 'N',
      last_name: 'D',
      user_type: 'internal',
      tenant: 'tenant-1',
      hashed_password: 'hashed',
      is_inactive: false,
    });

    const { user } = await signInThroughSimulator();

    expect(user.authFailure).toBeUndefined();
    expect(user.id).toBe('user-1');
    expect(await invokeSignIn(user)).toBe(true);
  });
});
