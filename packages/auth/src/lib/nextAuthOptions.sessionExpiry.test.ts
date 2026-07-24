import { beforeEach, describe, expect, it, vi } from 'vitest';

const extendExpiryMock = vi.fn(async () => undefined);
const isRevokedMock = vi.fn(async () => false);
const createMock = vi.fn(async () => 'sess-created');

const tenantFirstMock = vi.fn();
const subscriptionFirstMock = vi.fn();
const addonsSelectMock = vi.fn();

function makeTableQuery(table: string) {
  if (table === 'tenants') {
    return { where: vi.fn(() => ({ select: vi.fn(() => ({ first: tenantFirstMock })) })) };
  }
  if (table === 'stripe_subscriptions') {
    return {
      where: vi.fn(() => ({
        whereIn: vi.fn(() => ({
          orderByRaw: vi.fn(() => ({ select: vi.fn(() => ({ first: subscriptionFirstMock })) })),
        })),
      })),
    };
  }
  if (table === 'tenant_addons') {
    return { where: vi.fn(() => ({ select: addonsSelectMock })) };
  }
  throw new Error(`Unexpected table ${table}`);
}

// SESSION_MAX_AGE is mocked to 1 hour, so the throttle half-lifetime is 30 minutes.
const SESSION_MAX_AGE_SEC = 60 * 60;

vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/keycloak', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/azure-ad', () => ({ default: (config: unknown) => config }));
vi.mock('./session', () => ({
  getNextAuthSecret: async () => 'unit-test-secret',
  getNextAuthSecretSync: () => 'unit-test-secret',
  getSessionCookieConfig: () => ({ name: 'authjs.session-token', options: {} }),
  getSessionMaxAge: () => SESSION_MAX_AGE_SEC,
  isSecureCookieEnvironment: () => false,
  withDevPortSuffix: (value: string) => value,
}));
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
vi.mock('./sso/types', () => ({ OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {} }));
vi.mock('./sso/ceOAuthProfileMapper', () => ({ mapCeOAuthProfileToExtendedUser: vi.fn() }));
vi.mock('./sso/teamsMicrosoftProviderResolution', () => ({
  resolveTeamsMicrosoftProviderConfig: vi.fn(async () => ({
    status: 'not_configured',
    tenantId: 'tenant-1',
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
  MSP_SSO_RESOLUTION_COOKIE: 'msp_sso_resolution',
  getMspSsoSigningSecret: async () => 'unit-test-secret',
  parseAndVerifyMspSsoResolutionCookie: vi.fn(() => null),
}));
vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {
    isRevoked: (...args: unknown[]) => isRevokedMock(...(args as [])),
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

const { getAuthOptions, options } = await import('./nextAuthOptions');

describe('nextAuth session expiry sliding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRevokedMock.mockResolvedValue(false);
    createMock.mockResolvedValue('sess-created');
    extendExpiryMock.mockResolvedValue(undefined);
    // Keep plan refresh quiet/side-effect-free for these cases.
    tenantFirstMock.mockResolvedValue({ plan: 'pro', product_code: 'psa' });
    subscriptionFirstMock.mockResolvedValue(undefined);
    addonsSelectMock.mockResolvedValue([]);
  });

  async function runJwt(token: Record<string, unknown>) {
    const options = await getAuthOptions();
    const jwt = options.callbacks?.jwt;
    expect(jwt).toBeTypeOf('function');
    return jwt!({ token, trigger: undefined } as any);
  }

  it('slides expires_at on an active session whose last extend is stale', async () => {
    const before = Date.now();
    await runJwt({
      id: 'u-1',
      tenant: 'tenant-1',
      session_id: 'sess-1',
      last_plan_check: before,
      // no last_session_extend -> treated as 0 -> stale -> should fire
    });

    expect(extendExpiryMock).toHaveBeenCalledTimes(1);
    const [tenant, sessionId, expiresAt] = extendExpiryMock.mock.calls[0] as [string, string, Date];
    expect(tenant).toBe('tenant-1');
    expect(sessionId).toBe('sess-1');
    expect(expiresAt).toBeInstanceOf(Date);
    const expectedMs = before + SESSION_MAX_AGE_SEC * 1000;
    expect(Math.abs(expiresAt.getTime() - expectedMs)).toBeLessThan(60_000);
  });

  it('skips the slide when within the throttle window', async () => {
    await runJwt({
      id: 'u-1',
      tenant: 'tenant-1',
      session_id: 'sess-1',
      last_plan_check: Date.now(),
      last_session_extend: Date.now(), // just extended -> inside throttle -> skip
    });

    expect(extendExpiryMock).not.toHaveBeenCalled();
  });

  it('checks revocation on every JWT callback even when the same token is reused', async () => {
    const token = {
      id: 'u-1',
      tenant: 'tenant-1',
      session_id: 'sess-1',
      last_plan_check: Date.now(),
      last_session_extend: Date.now(),
    };

    await runJwt(token);
    isRevokedMock.mockResolvedValue(true);

    await expect(runJwt(token)).resolves.toBeNull();
    expect(isRevokedMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed when durable revocation state cannot be read', async () => {
    isRevokedMock.mockRejectedValue(new Error('database unavailable'));

    await expect(runJwt({
      id: 'u-1',
      tenant: 'tenant-1',
      session_id: 'sess-1',
      last_plan_check: Date.now(),
      last_session_extend: Date.now(),
    })).resolves.toBeNull();
  });

  it('applies immediate fail-closed revocation checks in the synchronous auth config', async () => {
    const jwt = options.callbacks?.jwt;
    expect(jwt).toBeTypeOf('function');
    isRevokedMock.mockResolvedValue(true);

    await expect(jwt!({
      token: {
        id: 'u-1',
        tenant: 'tenant-1',
        session_id: 'sess-1',
        last_plan_check: Date.now(),
        last_session_extend: Date.now(),
      },
      trigger: undefined,
    } as any)).resolves.toBeNull();
  });

  it('rejects a reused OAuth JWT with no durable session_id', async () => {
    await expect(runJwt({
      id: 'u-1',
      tenant: 'tenant-1',
      last_plan_check: Date.now(),
    })).resolves.toBeNull();

    expect(isRevokedMock).not.toHaveBeenCalled();
    expect(extendExpiryMock).not.toHaveBeenCalled();
  });

  it('creates a durable session for a new OAuth login without device metadata', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt;
    expect(jwt).toBeTypeOf('function');

    const token = await jwt!({
      token: {},
      user: {
        id: 'u-1',
        email: 'user@example.com',
        tenant: 'tenant-1',
        user_type: 'internal',
        loginMethod: 'azure-ad',
      },
      trigger: 'signIn',
    } as any);

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-1',
      user_id: 'u-1',
      ip_address: 'unknown',
      user_agent: 'unknown',
      login_method: 'azure-ad',
    }));
    expect(token).toMatchObject({
      session_id: 'sess-created',
      login_method: 'azure-ad',
    });
    expect(isRevokedMock).toHaveBeenCalledWith('tenant-1', 'sess-created');
  });

  it('creates a durable OAuth session in the synchronous auth config', async () => {
    const jwt = options.callbacks?.jwt;
    expect(jwt).toBeTypeOf('function');

    await expect(jwt!({
      token: {},
      user: {
        id: 'u-1',
        email: 'user@example.com',
        tenant: 'tenant-1',
        user_type: 'internal',
        loginMethod: 'azure-ad',
      },
      trigger: 'signIn',
    } as any)).resolves.toMatchObject({
      session_id: 'sess-created',
      login_method: 'azure-ad',
    });
  });

  it('fails closed when an OAuth session cannot be persisted', async () => {
    createMock.mockRejectedValue(new Error('database unavailable'));

    await expect((await getAuthOptions()).callbacks?.jwt!({
      token: {},
      user: {
        id: 'u-1',
        email: 'user@example.com',
        tenant: 'tenant-1',
        user_type: 'internal',
        loginMethod: 'azure-ad',
      },
      trigger: 'signIn',
    } as any)).resolves.toBeNull();
  });
});
