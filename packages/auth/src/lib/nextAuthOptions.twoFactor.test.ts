import { beforeEach, describe, expect, it, vi } from 'vitest';
import speakeasy from 'speakeasy';
import { CredentialsSignin } from '@auth/core/errors';

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

const authenticate = vi.hoisted(() => vi.fn());
const protection = vi.hoisted(() => ({ enforce: vi.fn(), failure: vi.fn(), success: vi.fn() }));
vi.mock('./authenticateUserForAuth', () => ({ authenticateUserForAuth: authenticate }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn() }));
vi.mock('./security/loginProtection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./security/loginProtection')>();
  return { ...actual, enforceLoginProtection: protection.enforce,
    recordLoginFailure: protection.failure, recordLoginSuccess: protection.success };
});
const { getAuthOptions } = await import('./nextAuthOptions');


// Exercise the actual Credentials authorize callback and real TOTP verification.
// Only the password/database boundary and external effects are stubbed.
describe.each(['internal', 'client'])('credentials TOTP challenge: %s', (userType) => {
  const seed = 'JBSWY3DPEHPK3PXP';
  const user = { user_id: 'user-1', tenant: 'tenant-1', email: 'totp@example.test',
    username: 'totp', user_type: userType, two_factor_enabled: true,
    two_factor_secret: seed, hashed_password: 'private-hash' };

  async function authorize(password: string, twoFactorCode?: string) {
    const options = await getAuthOptions();
    const provider = options.providers.find((p: any) => typeof p.authorize === 'function');
    return provider.authorize({ email: user.email, password, userType,
      tenant: 'tenant-slug', twoFactorCode }, undefined);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    storedUser.row = { user_type: userType, is_inactive: false };
    authenticate.mockImplementation(async (_email, password) => password === 'correct-password' ? user : null);
  });

  it('challenges only after a valid password without recording success or creating a session', async () => {
    const error = await authorize('correct-password').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialsSignin);
    expect(error).toMatchObject({ type: 'CredentialsSignin', code: '2FA_REQUIRED' });
    expect(authenticate).toHaveBeenCalledWith(user.email, 'correct-password', userType,
      expect.objectContaining({ tenantSlug: 'tenant-slug', requireTenantMatch: true }));
    expect(protection.success).not.toHaveBeenCalled();
    expect(protection.failure).not.toHaveBeenCalled();
    expect(userSessionCreateMock).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain(seed);
  });

  it.each([undefined, '123456'])('rejects a wrong password with code %s without revealing a challenge', async (code) => {
    expect(await authorize('wrong-password', code)).toBeNull();
    expect(protection.failure).toHaveBeenCalledOnce();
    expect(protection.success).not.toHaveBeenCalled();
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid code and counts the failure', async () => {
    const validCode = speakeasy.totp({ secret: seed, encoding: 'base32' });
    const invalidCode = `${(Number(validCode[0]) + 1) % 10}${validCode.slice(1)}`;
    expect(await authorize('correct-password', invalidCode)).toBeNull();
    expect(protection.failure).toHaveBeenCalledOnce();
    expect(protection.success).not.toHaveBeenCalled();
    expect(userSessionCreateMock).not.toHaveBeenCalled();
  });

  it('accepts a valid code on resubmission and returns only public identity', async () => {
    await expect(authorize('correct-password')).rejects.toMatchObject({ code: '2FA_REQUIRED' });
    const code = speakeasy.totp({ secret: seed, encoding: 'base32' });
    const result = await authorize('correct-password', code);
    expect(result).toMatchObject({ id: 'user-1', user_type: userType });
    expect(result).not.toHaveProperty('hashed_password');
    expect(result).not.toHaveProperty('two_factor_secret');
    expect(protection.success).toHaveBeenCalledOnce();
    expect(authenticate).toHaveBeenCalledTimes(2);
  });
});
