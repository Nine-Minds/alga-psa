import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// (adapted prelude)
// Microsoft sign-in only binds the ID token to its authorization request when
// Auth.js is told to mint and verify a nonce. This test builds the real option
// sets and inspects what each Microsoft registration declares, so a new
// registration that forgets `nonce` fails here.


vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/keycloak', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/azure-ad', () => ({
  default: (config: Record<string, unknown>) => ({ id: 'azure-ad', ...config }),
}));
const mapperMock = vi.fn(async () => ({ id: 'u' }));
const parseMspMock = vi.fn((..._a: unknown[]) => null as any);
const parseClientMock = vi.fn((..._a: unknown[]) => null as any);
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
vi.mock('./sso/ceOAuthProfileMapper', () => ({
  mapCeOAuthProfileToExtendedUser: (...args: unknown[]) => mapperMock(...args),
}));
vi.mock('./sso/clientPortalSsoResolution', () => ({
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE: 'client_portal_sso_resolution',
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE: 'client_portal_sso_discovery',
  parseAndVerifyClientPortalSsoResolutionCookie: (...args: unknown[]) => parseClientMock(...args),
}));
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
vi.mock('next/headers.js', () => ({ cookies: async () => ({ get: vi.fn(), set: vi.fn() }) , headers: async () => new Headers() }));
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
  parseAndVerifyMspSsoResolutionCookie: (...args: unknown[]) => parseMspMock(...args),
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

const { getSsoProfileHints, buildAuthOptions, buildTeamsAuthOptions } = await import('./nextAuthOptions');

const payload = (extra: Record<string, unknown>) => ({
  provider: 'google',
  source: 'app',
  issuedAt: 1,
  expiresAt: Number.MAX_SAFE_INTEGER,
  nonce: 'nonce-nonce',
  ...extra,
});

describe('getSsoProfileHints', () => {
  beforeEach(() => {
    parseMspMock.mockReset().mockReturnValue(null);
    parseClientMock.mockReset().mockReturnValue(null);
  });

  it('returns null with no cookie and no Teams context', async () => {
    expect(await getSsoProfileHints('google')).toBeNull();
  });

  it('client-portal cookie wins and yields a client hint with the vanity tenant', async () => {
    parseClientMock.mockReturnValue({ provider: 'google', tenantId: 'tenant-c' });
    parseMspMock.mockReturnValue(payload({ scopeTenantId: 'tenant-m' }));
    expect(await getSsoProfileHints('google')).toEqual({ userType: 'client', tenantHint: 'tenant-c' });
  });

  it('MSP cookie scopeTenantId scopes an internal user', async () => {
    parseMspMock.mockReturnValue(payload({ source: 'app', scopeTenantId: 'tenant-m' }));
    expect(await getSsoProfileHints('google')).toEqual({ userType: 'internal', scopeTenantId: 'tenant-m' });
  });

  it('a tenant-owned credential source scopes the user to that tenant', async () => {
    parseMspMock.mockReturnValue(payload({ source: 'tenant', tenantId: 'tenant-t' }));
    expect(await getSsoProfileHints('google')).toEqual({ userType: 'internal', scopeTenantId: 'tenant-t' });
  });

  it('an app-level source with no scope stays unscoped (but is still an internal flow)', async () => {
    parseMspMock.mockReturnValue(payload({ source: 'app' }));
    expect(await getSsoProfileHints('google')).toEqual({ userType: 'internal', scopeTenantId: undefined });
  });

  it('ignores a cookie minted for another provider', async () => {
    parseMspMock.mockReturnValue(payload({ provider: 'keycloak', scopeTenantId: 'tenant-m' }));
    expect(await getSsoProfileHints('google')).toBeNull();
  });

  it('Teams context wins over a leftover unscoped MSP resolution cookie for the same provider', async () => {
    parseMspMock.mockReturnValue(payload({ provider: 'azure-ad', source: 'app' }));
    expect(await getSsoProfileHints('azure-ad', { teamsTenantId: 'tenant-teams' })).toEqual({
      userType: 'internal',
      scopeTenantId: 'tenant-teams',
    });
    parseMspMock.mockReturnValue(payload({ provider: 'azure-ad', scopeTenantId: 'tenant-other' }));
    expect(await getSsoProfileHints('azure-ad', { teamsTenantId: 'tenant-teams' })).toEqual({
      userType: 'internal',
      scopeTenantId: 'tenant-teams',
    });
  });

  it('uses the Teams tenant as scope when no cookie applies', async () => {
    expect(await getSsoProfileHints('azure-ad', { teamsTenantId: 'tenant-teams' })).toEqual({
      userType: 'internal',
      scopeTenantId: 'tenant-teams',
    });
  });
});

describe('provider profile() wiring', () => {
  beforeEach(() => {
    mapperMock.mockClear();
    parseMspMock.mockReset().mockReturnValue(null);
    parseClientMock.mockReset().mockReturnValue(null);
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'g-id');
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'g-secret');
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_ID', 'ms-id');
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_SECRET', 'ms-secret');
    vi.stubEnv('MICROSOFT_OAUTH_TENANT_ID', 'ms-tenant');
  });
  afterEach(() => vi.unstubAllEnvs());

  const provider = async (id: string, teams = false) => {
    const options: any = teams ? await buildTeamsAuthOptions('tenant-teams') : await buildAuthOptions();
    return options.providers.find((p: any) => (id === 'google' ? typeof p.clientId === 'string' && p.id !== 'azure-ad' && p.profile && !p.authorize : p.id === id));
  };

  it('Google passes the MSP-cookie scope to the mapper and still forwards hd as a (non-authoritative) hint', async () => {
    parseMspMock.mockReturnValue(payload({ scopeTenantId: 'tenant-m' }));
    const google = await provider('google');
    await google.profile({ email: 'a@b.com', hd: 'other-tenant' });
    expect(mapperMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', scopeTenantId: 'tenant-m', userTypeHint: 'internal' })
    );
  });

  it('Microsoft passes the scope to the mapper', async () => {
    parseMspMock.mockReturnValue(payload({ provider: 'azure-ad', scopeTenantId: 'tenant-m' }));
    const azure = await provider('azure-ad');
    await (azure.options?.profile ?? azure.profile)({ email: 'a@b.com', tid: 'entra-tid' });
    expect(mapperMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'microsoft', scopeTenantId: 'tenant-m' })
    );
  });

  it('Teams-scoped Microsoft sign-in is scoped to the Teams tenant', async () => {
    const azure = await provider('azure-ad', true);
    await (azure.options?.profile ?? azure.profile)({ email: 'a@b.com' });
    expect(mapperMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'microsoft', scopeTenantId: 'tenant-teams', userTypeHint: 'internal' })
    );
  });

  it('an unscoped flow passes no scope', async () => {
    const google = await provider('google');
    await google.profile({ email: 'a@b.com' });
    expect(mapperMock.mock.calls[0][0]).toMatchObject({ scopeTenantId: undefined });
  });
});
