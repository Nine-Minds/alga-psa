import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieGetMock = vi.fn();
const cookieSetMock = vi.fn();
const cookieDeleteMock = vi.fn();
const applyOAuthAccountHintsMock = vi.fn(async (user: unknown) => user);
const updateLastLoginMock = vi.fn(async () => undefined);
const userSessionCreateMock = vi.fn(async () => 'session-1');
const parseClientPortalResolutionMock = vi.fn((..._args: unknown[]): unknown => null);
const CLIENT_PORTAL_RESOLUTION_COOKIE_NAME = 'client_portal_sso_resolution';

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
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE: CLIENT_PORTAL_RESOLUTION_COOKIE_NAME,
  parseAndVerifyClientPortalSsoResolutionCookie: (...args: unknown[]) =>
    parseClientPortalResolutionMock(...args),
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

const LINK_STATE_COOKIE_NAME = 'sso-link-state';

function buildLinkStateCookieValue() {
  const payload = JSON.stringify({
    userId: 'user-1',
    nonce: 'nonce-1',
    issuedAt: Date.now(),
    signature: 'deadbeef',
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function failureUser(code: string, userType: 'internal' | 'client', providerEmail?: string) {
  return {
    id: '',
    email: '',
    name: '',
    username: '',
    proToken: '',
    user_type: userType,
    authFailure: { code, providerEmail, userType },
  };
}

async function invokeSignIn(user: unknown) {
  const options = await getAuthOptions();
  const callback = options.callbacks?.signIn;
  if (!callback) {
    throw new Error('Expected signIn callback to be defined');
  }

  return callback({
    user: user as any,
    account: { provider: 'azure-ad', providerAccountId: 'provider-object-id' } as any,
    credentials: undefined,
    profile: undefined,
  } as any);
}

describe('NextAuth OAuth mapping-failure redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGetMock.mockReturnValue(undefined);
    parseClientPortalResolutionMock.mockReturnValue(null);
  });

  it('sends link-mode failures back to the profile SSO tab and clears the link cookie', async () => {
    cookieGetMock.mockImplementation((name: string) =>
      name === LINK_STATE_COOKIE_NAME ? { value: buildLinkStateCookieValue() } : undefined
    );

    const result = await invokeSignIn(
      failureUser('no_matching_user', 'internal', 'nd@computerbutlereurope.onmicrosoft.com')
    );

    // `single-sign-on` is the tab id the profile page resolves; a human label
    // here lands on the Profile tab and the banner is never shown.
    expect(result).toBe(
      '/msp/profile?tab=single-sign-on&linkError=no_matching_user&providerEmail=nd%40computerbutlereurope.onmicrosoft.com'
    );
    expect(cookieDeleteMock).toHaveBeenCalledWith(LINK_STATE_COOKIE_NAME);
    expect(userSessionCreateMock).not.toHaveBeenCalled();
    expect(updateLastLoginMock).not.toHaveBeenCalled();
    expect(applyOAuthAccountHintsMock).not.toHaveBeenCalled();
  });

  it('sends plain MSP sign-in failures to the MSP sign-in page with the reason', async () => {
    const result = await invokeSignIn(
      failureUser('no_matching_user', 'internal', 'ghost@example.com')
    );

    expect(result).toBe(
      '/auth/msp/signin?error=AccessDenied&reason=no_matching_user&providerEmail=ghost%40example.com'
    );
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('sends client portal failures to the client portal sign-in page', async () => {
    const result = await invokeSignIn(
      failureUser('tenant_mismatch', 'client', 'portal@example.com')
    );

    expect(result).toBe(
      '/auth/client-portal/signin?error=AccessDenied&reason=tenant_mismatch&providerEmail=portal%40example.com'
    );
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('carries the portal tenant slug so the message is not lost to tenant discovery', async () => {
    cookieGetMock.mockImplementation((name: string) =>
      name === CLIENT_PORTAL_RESOLUTION_COOKIE_NAME ? { value: 'signed-resolution' } : undefined
    );
    parseClientPortalResolutionMock.mockReturnValue({
      audience: 'client_portal',
      provider: 'azure-ad',
      tenantId: '11111111-2222-3333-4444-555555555555',
    });

    const result = await invokeSignIn(
      failureUser('no_matching_user', 'client', 'portal@example.com')
    );

    // Without `tenant` the portal sign-in page renders the tenant-discovery
    // form, which shows no error at all.
    expect(result).toBe(
      '/auth/client-portal/signin?error=AccessDenied&reason=no_matching_user&providerEmail=portal%40example.com&tenant=tenant-slug'
    );
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('omits providerEmail when the provider never supplied one', async () => {
    const result = await invokeSignIn(failureUser('missing_email', 'internal'));

    expect(result).toBe('/auth/msp/signin?error=AccessDenied&reason=missing_email');
  });

  it('never mints a token for a sentinel user', async () => {
    const options = await getAuthOptions();
    const jwt = options.callbacks?.jwt;
    const session = options.callbacks?.session;

    const token = await jwt!({
      token: { sub: '' },
      user: failureUser('no_matching_user', 'internal', 'ghost@example.com') as any,
      trigger: 'signIn',
    } as any);

    expect(token.id).toBeUndefined();
    expect(token.email).toBeUndefined();
    expect(token.session_id).toBeUndefined();
    expect(userSessionCreateMock).not.toHaveBeenCalled();

    const result = await session!({ session: { user: {} }, token } as any);
    expect(result).toEqual({ expires: '0' });
  });

  it('leaves resolved OAuth sign-ins untouched', async () => {
    applyOAuthAccountHintsMock.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
      tenant: 'tenant-1',
      user_type: 'internal',
    });

    const result = await invokeSignIn({
      id: 'user-1',
      email: 'user@example.com',
      tenant: 'tenant-1',
      user_type: 'internal',
    });

    expect(result).toBe(true);
    expect(applyOAuthAccountHintsMock).toHaveBeenCalled();
  });
});
