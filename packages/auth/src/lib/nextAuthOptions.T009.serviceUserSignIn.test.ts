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
// The REAL assertInteractiveUser runs against this fake users table lookup.
const storedUser = vi.hoisted(() => ({ row: undefined as undefined | { user_type: string; is_inactive: boolean } }));
vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(async () => ({})),
  tenantDb: vi.fn(() => ({
    table: () => ({ where: () => ({ select: () => ({ first: async () => storedUser.row }) }) }),
  })),
}));
vi.mock('./PortalDomainModel', () => ({
  getPortalDomain: vi.fn(),
  getPortalDomainByHostname: vi.fn(),
}));
vi.mock('@alga-psa/db/models/user', () => ({
  default: { updateLastLogin: (...args: unknown[]) => updateLastLoginMock(...args) },
}));

const { getAuthOptions } = await import('./nextAuthOptions');

async function invokeSignIn(user: unknown, account: unknown) {
  const options = await getAuthOptions();
  return options.callbacks!.signIn!({ user: user as any, account: account as any, credentials: undefined, profile: undefined } as any);
}

const candidate = { id: 'user-1', tenant: 'tenant-1', email: 'svc@example.test', name: 'svc', username: 'svc', proToken: '' };
const providers = [
  ['credentials', { provider: 'credentials', type: 'credentials' }],
  ['azure-ad', { provider: 'azure-ad', providerAccountId: 'oid-1' }],
  ['google', { provider: 'google', providerAccountId: 'g-1' }],
] as const;

describe('T009: signIn callback gates on the stored user type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGetMock.mockReturnValue(undefined);
    parseClientPortalResolutionMock.mockReturnValue(null);
    storedUser.row = undefined;
  });

  describe.each(providers)('%s', (_name, account) => {
    it('refuses a service user: false, no durable session, no last_login, no OAuth link', async () => {
      storedUser.row = { user_type: 'service', is_inactive: false };
      // The claim on the candidate says internal: the stored row must win.
      await expect(invokeSignIn({ ...candidate, user_type: 'internal' }, account)).resolves.toBe(false);
      expect(userSessionCreateMock).not.toHaveBeenCalled();
      expect(updateLastLoginMock).not.toHaveBeenCalled();
    });

    it('refuses a missing row (fail closed) and an inactive internal user', async () => {
      storedUser.row = undefined;
      await expect(invokeSignIn({ ...candidate, user_type: 'internal' }, account)).resolves.toBe(false);
      storedUser.row = { user_type: 'internal', is_inactive: true };
      await expect(invokeSignIn({ ...candidate, user_type: 'internal' }, account)).resolves.toBe(false);
      expect(updateLastLoginMock).not.toHaveBeenCalled();
    });

    it.each(['internal', 'client'])('lets an active %s user through and records last_login', async (type) => {
      storedUser.row = { user_type: type, is_inactive: false };
      await expect(invokeSignIn({ ...candidate, user_type: type }, account)).resolves.not.toBe(false);
      expect(updateLastLoginMock).toHaveBeenCalled();
    });
  });
});
