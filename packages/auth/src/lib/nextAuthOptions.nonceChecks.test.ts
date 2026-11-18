import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Microsoft sign-in only binds the ID token to its authorization request when
// Auth.js is told to mint and verify a nonce. This test builds the real option
// sets and inspects what each Microsoft registration declares, so a new
// registration that forgets `nonce` fails here.

const REQUIRED_CHECKS = ['pkce', 'state', 'nonce'];

vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/keycloak', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/azure-ad', () => ({
  default: (config: Record<string, unknown>) => ({ id: 'azure-ad', ...config }),
}));
// The OAuth check cookies are named once, at module load, by the real
// withDevPortSuffix. Pin a public URL with a port before the import so the
// names below are the ones a worktree dev server would set.
const PUBLIC_PORT = '3826';
process.env.NEXTAUTH_URL = `http://localhost:${PUBLIC_PORT}`;

vi.mock('./session', async () => {
  const actual = await vi.importActual<typeof import('./session')>('./session');
  return {
    getNextAuthSecret: async () => 'unit-test-secret',
    getNextAuthSecretSync: () => 'unit-test-secret',
    getSessionCookieConfig: () => ({ name: 'authjs.session-token', options: {} }),
    getSessionMaxAge: () => 3600,
    isSecureCookieEnvironment: () => false,
    withDevPortSuffix: actual.withDevPortSuffix,
  };
});
vi.mock('./PortalDomainSessionToken', () => ({ issuePortalDomainOtt: vi.fn() }));
vi.mock('@alga-psa/validation', () => ({ buildTenantPortalSlug: () => 'tenant-slug', isValidTenantSlug: () => true }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: vi.fn(async () => null),
    getTenantSecret: vi.fn(async () => null),
  })),
}));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  resolveSelfHostTier: vi.fn(() => undefined),
}));
vi.mock('./sso/registry', () => ({
  getSSORegistry: () => ({
    applyOAuthAccountHints: vi.fn(async (user: unknown) => user),
    mapOAuthProfileToExtendedUser: vi.fn(),
    decodeOAuthJwtPayload: vi.fn(() => null),
  }),
  registerSSOProvider: vi.fn(),
}));
vi.mock('./sso/enterpriseRegistryEntry', () => ({ loadEnterpriseSsoProviderRegistryImpl: async () => null }));
vi.mock('./sso/types', () => ({
  OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {},
  isOAuthMappingFailure: (user: { authFailure?: { code?: string } } | null | undefined) =>
    Boolean(user?.authFailure?.code),
}));
vi.mock('./sso/ceOAuthProfileMapper', () => ({ mapCeOAuthProfileToExtendedUser: vi.fn() }));
vi.mock('./sso/teamsMicrosoftProviderResolution', () => ({
  resolveTeamsMicrosoftProviderConfig: vi.fn(async () => ({
    status: 'ready',
    tenantId: 'tenant-1',
    clientId: 'teams-client-id',
    clientSecret: 'teams-client-secret',
    microsoftTenantId: 'teams-entra-tenant',
  })),
}));
vi.mock('./microsoftConsumerProfileResolution', () => ({
  resolveMicrosoftConsumerProfileConfig: vi.fn(async () => ({
    status: 'not_configured',
    tenantId: 'tenant-1',
    consumerType: 'msp_sso',
  })),
}));
vi.mock('next/headers.js', () => ({ cookies: async () => ({ get: vi.fn(), set: vi.fn() }) }));
vi.mock('./sso/mspSsoResolution', () => ({
  // clientPortalSsoResolution re-exports several of these, so the mock has to
  // carry them even though nextAuthOptions itself only reads the cookie helpers.
  MSP_SSO_DISCOVERY_TTL_SECONDS: 300,
  MSP_SSO_GENERIC_FAILURE_MESSAGE:
    "We couldn't start SSO sign-in. Please verify provider setup and try again.",
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
    isRevokedOrIdentityMismatch: (...args: unknown[]) => isRevokedOrIdentityMismatchMock(...(args as [])),
    getRejectionReason: (...args: unknown[]) => getRejectionReasonMock(...(args as [])),
    extendExpiry: (...args: unknown[]) => extendExpiryMock(...(args as [])),
    create: (...args: unknown[]) => createMock(...(args as [])),
    updateLocation: vi.fn(),
  },
}));
vi.mock('./ipAddress', () => ({ getClientIp: vi.fn() }));
vi.mock('./deviceFingerprint', () => ({ generateDeviceFingerprint: vi.fn(), getDeviceInfo: vi.fn() }));
vi.mock('./geolocation', () => ({ getLocationFromIp: vi.fn(async () => null) }));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn() }));
vi.mock('./PortalDomainModel', () => ({ getPortalDomain: vi.fn(), getPortalDomainByHostname: vi.fn() }));
vi.mock('@alga-psa/db/models/user', () => ({ default: { updateLastLogin: vi.fn() } }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => ((table: string) => makeTableQuery(table))),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { buildAuthOptions, buildTeamsAuthOptions } = await import('./nextAuthOptions');

type BuiltProvider = { id?: string; checks?: string[] };
type BuiltCookies = Record<string, { name: string }>;

function azureProviders(options: { providers: BuiltProvider[] }): BuiltProvider[] {
  return options.providers.filter((provider) => provider.id === 'azure-ad');
}

describe('Microsoft SSO nonce checks', () => {
  beforeEach(() => {
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_ID', 'env-client-id');
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_SECRET', 'env-client-secret');
    vi.stubEnv('MICROSOFT_OAUTH_TENANT_ID', 'env-entra-tenant');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('declares pkce, state and nonce on the default Microsoft registration', async () => {
    const providers = azureProviders(await buildAuthOptions());
    expect(providers).toHaveLength(1);
    expect(providers[0].checks).toEqual(REQUIRED_CHECKS);
  });

  it('declares pkce, state and nonce on the Teams-scoped Microsoft registration', async () => {
    const providers = azureProviders(await buildTeamsAuthOptions('tenant-1'));
    expect(providers).toHaveLength(1);
    expect(providers[0].checks).toEqual(REQUIRED_CHECKS);
  });

  it('forwards the same checks to the Microsoft simulator provider', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MICROSOFT_SSO_EMULATOR_MODE', 'true');
    const providers = azureProviders(await buildAuthOptions());
    expect(providers).toHaveLength(1);
    expect(providers[0].checks).toEqual(REQUIRED_CHECKS);
  });

  it('names every OAuth check cookie with the runtime port, so worktrees on one host cannot consume each other\'s', async () => {
    const options = (await buildAuthOptions()) as unknown as { cookies: BuiltCookies };
    const names = Object.fromEntries(
      ['nonce', 'pkceCodeVerifier', 'state', 'callbackUrl', 'csrfToken'].map((key) => [key, options.cookies[key]?.name]),
    );
    expect(names).toEqual({
      nonce: `authjs-port-${PUBLIC_PORT}.nonce`,
      pkceCodeVerifier: `authjs-port-${PUBLIC_PORT}.pkce.code_verifier`,
      state: `authjs-port-${PUBLIC_PORT}.state`,
      callbackUrl: `authjs-port-${PUBLIC_PORT}.callback-url`,
      csrfToken: `authjs-port-${PUBLIC_PORT}.csrf-token`,
    });
  });
});
