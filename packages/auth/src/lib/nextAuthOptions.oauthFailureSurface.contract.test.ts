/**
 * Contract test for the seam this card is really about: what Auth.js does with
 * an OAuth `profile()` that cannot resolve an AlgaPSA user.
 *
 * The unit tests around `callbacks.signIn` prove our logic in isolation, but the
 * ticket's symptom ("There is a problem with the server configuration") was
 * produced by @auth/core, not by us. Reproducing it in a browser needs real
 * Microsoft/Google credentials, which no dev environment here has, so the
 * library half of the contract is pinned down with @auth/core's own `Auth()`
 * handler driven over a stub OAuth provider:
 *
 *  - throwing from `profile()` (the pre-fix behaviour) is swallowed into
 *    `OAuthProfileParseError` and dead-ends the visitor with no explanation;
 *  - returning our sentinel instead reaches `callbacks.signIn`, whose returned
 *    string Auth.js honours as a redirect to a page that names the email;
 *  - a non-client-safe AuthError still turns into `error=Configuration`, and
 *    `pages.error` keeps it on an app-styled page.
 *
 * If a future @auth/core stops honouring the signIn redirect string, this fails
 * here rather than in front of a trial customer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth, customFetch } from '@auth/core';

const cookieGetMock = vi.fn();
const cookieSetMock = vi.fn();
const cookieDeleteMock = vi.fn();
const applyOAuthAccountHintsMock = vi.fn(async (user: unknown) => user);
const updateLastLoginMock = vi.fn(async () => undefined);
const userSessionCreateMock = vi.fn(async () => 'session-1');

vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/keycloak', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/azure-ad', () => ({ default: (config: unknown) => config }));

vi.mock('./session', () => ({
  getNextAuthSecret: async () => 'unit-test-secret',
  getNextAuthSecretSync: () => 'unit-test-secret',
  getSessionCookieConfig: () => ({ name: 'authjs.session-token', options: {} }),
  getSessionMaxAge: () => 60 * 60,
  isSecureCookieEnvironment: () => false,
  withDevPortSuffix: (value: string) => value,
}));

vi.mock('./PortalDomainSessionToken', () => ({ issuePortalDomainOtt: vi.fn() }));

vi.mock('@alga-psa/validation', () => ({
  buildTenantPortalSlug: () => 'tenant-slug',
  isValidTenantSlug: () => true,
}));

vi.mock('@alga-psa/core/features', () => ({ isEnterprise: true }));

vi.mock('./sso/registry', () => ({
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

vi.mock('./sso/enterpriseRegistryEntry', () => ({
  loadEnterpriseSsoProviderRegistryImpl: async () => null,
}));

vi.mock('./sso/ceOAuthProfileMapper', () => ({
  mapCeOAuthProfileToExtendedUser: vi.fn(),
}));

vi.mock('next/headers.js', () => ({
  cookies: async () => ({
    get: (...args: unknown[]) => cookieGetMock(...args),
    set: (...args: unknown[]) => cookieSetMock(...args),
    delete: (...args: unknown[]) => cookieDeleteMock(...args),
  }),
}));

vi.mock('./sso/mspSsoResolution', () => ({
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

vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    create: (...args: unknown[]) => userSessionCreateMock(...args),
    enforceMaxSessions: vi.fn(async () => undefined),
    updateLocation: vi.fn(async () => undefined),
  },
}));

vi.mock('./sso/clientPortalSsoResolution', () => ({
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE: 'client_portal_sso_discovery',
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE: 'client_portal_sso_resolution',
  parseAndVerifyClientPortalSsoResolutionCookie: vi.fn(() => null),
}));

vi.mock('./ipAddress', () => ({ getClientIp: vi.fn() }));
vi.mock('./deviceFingerprint', () => ({
  generateDeviceFingerprint: vi.fn(),
  getDeviceInfo: vi.fn(),
}));
vi.mock('./geolocation', () => ({ getLocationFromIp: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('./PortalDomainModel', () => ({
  getPortalDomain: vi.fn(),
  getPortalDomainByHostname: vi.fn(),
}));
vi.mock('@alga-psa/db/models/user', () => ({
  default: { updateLastLogin: (...args: unknown[]) => updateLastLoginMock(...args) },
}));

const { getAuthOptions } = await import('./nextAuthOptions');

const ORIGIN = 'http://localhost:3000';
const LINK_STATE_COOKIE_NAME = 'sso-link-state';
const PROVIDER_EMAIL = 'nd@computerbutlereurope.onmicrosoft.com';

function buildLinkStateCookieValue() {
  const payload = JSON.stringify({
    userId: 'user-1',
    nonce: 'nonce-1',
    issuedAt: Date.now(),
    signature: 'deadbeef',
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * A minimal OAuth provider that stands in for Azure AD: the token endpoint is
 * answered locally so the test needs no Microsoft credentials, and `checks` is
 * configurable so the state-failure case can be driven too.
 */
function buildStubProvider({
  profile,
  checks = ['none'],
}: {
  profile: () => unknown;
  checks?: string[];
}) {
  return {
    id: 'azure-ad',
    name: 'Microsoft',
    type: 'oauth',
    issuer: 'https://provider.test',
    clientId: 'stub-client-id',
    clientSecret: 'stub-client-secret',
    authorization: { url: 'https://provider.test/authorize' },
    token: { url: 'https://provider.test/token' },
    userinfo: {
      url: 'https://provider.test/userinfo',
      request: async () => ({ email: PROVIDER_EMAIL, sub: 'provider-object-id' }),
    },
    checks,
    profile,
    [customFetch]: async () =>
      new Response(JSON.stringify({ access_token: 'stub-access-token', token_type: 'bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  };
}

/** The sentinel `mapOAuthProfileToExtendedUser` now returns instead of throwing. */
function sentinelUser(code: string, userType: 'internal' | 'client') {
  return {
    id: '',
    email: '',
    name: '',
    username: '',
    proToken: '',
    user_type: userType,
    authFailure: { code, providerEmail: PROVIDER_EMAIL, userType },
  };
}

async function runOAuthCallback(provider: ReturnType<typeof buildStubProvider>) {
  const options = await getAuthOptions();

  // Real callbacks and real `pages`, stub provider: the parts of the chain this
  // test is pinning are Auth.js's and ours, not the identity provider's.
  const response = await Auth(
    new Request(`${ORIGIN}/api/auth/callback/azure-ad?code=stub-authorization-code`),
    {
      secret: 'contract-test-secret-contract-test-secret',
      trustHost: true,
      basePath: '/api/auth',
      session: { strategy: 'jwt' },
      providers: [provider as any],
      pages: options.pages,
      callbacks: options.callbacks as any,
      logger: { error: () => {}, warn: () => {}, debug: () => {} },
    } as any
  );

  return response as Response;
}

describe('Auth.js surface for OAuth profiles that match no AlgaPSA user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGetMock.mockReturnValue(undefined);
  });

  it('sends a link-mode mapping failure to the profile SSO tab with both emails', async () => {
    cookieGetMock.mockImplementation((name: string) =>
      name === LINK_STATE_COOKIE_NAME ? { value: buildLinkStateCookieValue() } : undefined
    );

    const response = await runOAuthCallback(
      buildStubProvider({ profile: () => sentinelUser('no_matching_user', 'internal') })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/msp/profile?tab=single-sign-on&linkError=no_matching_user&providerEmail=nd%40computerbutlereurope.onmicrosoft.com`
    );
    // The signed link authorization is single-use even on failure.
    expect(cookieDeleteMock).toHaveBeenCalledWith(LINK_STATE_COOKIE_NAME);
    // No session is minted for a sentinel, and no session cookie is set.
    expect(userSessionCreateMock).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie') ?? '').not.toContain('authjs.session-token');
  });

  it('sends a plain sign-in mapping failure to the MSP sign-in page with the reason', async () => {
    const response = await runOAuthCallback(
      buildStubProvider({ profile: () => sentinelUser('no_matching_user', 'internal') })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `${ORIGIN}/auth/msp/signin?error=AccessDenied&reason=no_matching_user&providerEmail=nd%40computerbutlereurope.onmicrosoft.com`
    );
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('documents why the mapper must not throw: Auth.js swallows it into a broken redirect', async () => {
    const response = await runOAuthCallback(
      buildStubProvider({
        profile: () => {
          throw new Error('User not found');
        },
      })
    );

    const location = response.headers.get('location') ?? '';
    // @auth/core logs OAuthProfileParseError, returns no user, and redirects to
    // `${options.url}/signin` -- where options.url is the *callback* URL, query
    // string and all. That is the ticket's dead end: the browser re-enters the
    // callback route with a mangled `code`, the token exchange then fails, and
    // the resulting CallbackRouteError is not client-safe, which is how a
    // mismatched email ended up on "There is a problem with the server
    // configuration" instead of anywhere a user could act.
    expect(location.startsWith(`${ORIGIN}/api/auth/callback/azure-ad`)).toBe(true);
    expect(location.endsWith('/signin')).toBe(true);
    expect(location).not.toContain('linkError');
    expect(location).not.toContain('reason=');
  });

  it('keeps a residual non-client-safe failure on an app page instead of the Auth.js error page', async () => {
    // `checks: ['state']` with no state cookie is the InvalidCheck class of
    // failure, which is not client-safe and so becomes error=Configuration.
    const response = await runOAuthCallback(
      buildStubProvider({
        profile: () => sentinelUser('no_matching_user', 'internal'),
        checks: ['state'],
      })
    );

    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=Configuration');
    // pages.error keeps it off the black /api/auth/error page.
    expect(location).not.toContain('/api/auth/error');
    expect(new URL(location).pathname).toBe('/auth/signin');
  });
});
