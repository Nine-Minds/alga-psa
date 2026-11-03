import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from '@auth/core';

const extendExpiryMock = vi.fn(async () => undefined);
const isRevokedOrIdentityMismatchMock = vi.fn(async () => false);
const getRejectionReasonMock = vi.fn(async (
  _tenant?: string,
  _sessionId?: string,
  _identity?: { userId: string; userType: string },
) => null as string | null);
const durableSessions: Array<{
  sessionId: string;
  tenant: string;
  userId: string;
  userType: string;
  revoked: boolean;
  expiresAt: Date;
  lastActivity: number;
}> = [];
let nextSessionNumber = 1;
let statefulSessionMode = false;
const createMock = vi.fn(async (params?: Record<string, any>) => {
  const sessionId = nextSessionNumber === 1 ? 'sess-created' : `sess-created-${nextSessionNumber}`;
  nextSessionNumber += 1;
  durableSessions.push({
    sessionId,
    tenant: params?.tenant ?? 'tenant-1',
    userId: params?.user_id ?? 'u-1',
    userType: 'internal',
    revoked: false,
    expiresAt: params?.expires_at ?? new Date(Date.now() + 60 * 60 * 1000),
    lastActivity: Date.now(),
  });
  return sessionId;
});
const logLifecycleMock = vi.fn();
const enforceMaxSessionsMock = vi.fn(async (_tenant: string, userId: string, maxSessions: number) => {
  const active = durableSessions
    .filter((row) => !row.revoked && row.userId === userId && row.expiresAt.getTime() > Date.now())
    .sort((a, b) => a.lastActivity - b.lastActivity);
  for (const row of active.slice(0, Math.max(0, active.length - maxSessions + 1))) {
    row.revoked = true;
  }
});

const tenantFirstMock = vi.fn();
const subscriptionFirstMock = vi.fn();
const addonsSelectMock = vi.fn();

function makeTableQuery(table: string) {
  if (table === 'tenants') {
    return {
      select: vi.fn(() => ({ first: tenantFirstMock })),
      where: vi.fn(() => ({ select: vi.fn(() => ({ first: tenantFirstMock })) })),
    };
  }
  if (table === 'stripe_subscriptions') {
    return {
      whereIn: vi.fn(() => ({
        orderByRaw: vi.fn(() => ({ select: vi.fn(() => ({ first: subscriptionFirstMock })) })),
      })),
      where: vi.fn(() => ({
        whereIn: vi.fn(() => ({
          orderByRaw: vi.fn(() => ({ select: vi.fn(() => ({ first: subscriptionFirstMock })) })),
        })),
      })),
    };
  }
  if (table === 'tenant_addons') {
    return { select: addonsSelectMock, where: vi.fn(() => ({ select: addonsSelectMock })) };
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
vi.mock('./sso/types', () => ({
  OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {},
  isOAuthMappingFailure: (user: { authFailure?: { code?: string } } | null | undefined) =>
    Boolean(user?.authFailure?.code),
}));
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
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('../nextauth/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('./assertInteractiveUser', () => ({ assertInteractiveUser: vi.fn(async () => true) }));
vi.mock('./security/loginProtection', () => ({
  enforceLoginProtection: vi.fn(async () => undefined),
  normalizeLoginEmail: (value: string) => value.trim().toLowerCase(),
  recordLoginFailure: vi.fn(async () => undefined),
  recordLoginSuccess: vi.fn(async () => undefined),
}));
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
    create: (...args: unknown[]) => createMock(...(args as [Record<string, any>])),
    enforceMaxSessions: (...args: unknown[]) => enforceMaxSessionsMock(...(args as [string, string, number])),
    logLifecycle: (...args: unknown[]) => logLifecycleMock(...(args as [])),
    updateLocation: vi.fn(),
  },
}));
vi.mock('./ipAddress', () => ({ getClientIp: vi.fn(() => '127.0.0.1') }));
vi.mock('./deviceFingerprint', () => ({
  generateDeviceFingerprint: vi.fn(() => 'test-fingerprint'),
  getDeviceInfo: vi.fn(() => ({ name: 'Test Browser', type: 'desktop' })),
}));
vi.mock('./geolocation', () => ({ getLocationFromIp: vi.fn(async () => null) }));
vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(),
  tenantDb: vi.fn((_connection: unknown, _tenant: string) => ({
    table: (table: string) => makeTableQuery(table),
  })),
}));
vi.mock('./PortalDomainModel', () => ({ getPortalDomain: vi.fn(), getPortalDomainByHostname: vi.fn() }));
vi.mock('@alga-psa/db/models/user', () => ({ default: { updateLastLogin: vi.fn() } }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => ((table: string) => makeTableQuery(table))),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getAuthOptions } = await import('./nextAuthOptions');

describe('nextAuth session expiry sliding', () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    isRevokedOrIdentityMismatchMock.mockResolvedValue(false);
    getRejectionReasonMock.mockResolvedValue(null);
    createMock.mockResolvedValue('sess-created');
    durableSessions.splice(0, durableSessions.length);
    nextSessionNumber = 1;
    createMock.mockImplementation(async (params?: Record<string, any>) => {
      const sessionId = nextSessionNumber === 1 ? 'sess-created' : `sess-created-${nextSessionNumber}`;
      nextSessionNumber += 1;
      durableSessions.push({
        sessionId,
        tenant: params?.tenant ?? 'tenant-1',
        userId: params?.user_id ?? 'u-1',
        userType: 'internal',
        revoked: false,
        expiresAt: params?.expires_at ?? new Date(Date.now() + 60 * 60 * 1000),
        lastActivity: Date.now(),
      });
      return sessionId;
    });
    enforceMaxSessionsMock.mockImplementation(async (_tenant, userId, maxSessions) => {
      const active = durableSessions
        .filter((row) => !row.revoked && row.userId === userId && row.expiresAt.getTime() > Date.now())
        .sort((a, b) => a.lastActivity - b.lastActivity);
      for (const row of active.slice(0, Math.max(0, active.length - maxSessions + 1))) row.revoked = true;
    });
    statefulSessionMode = false;
    getRejectionReasonMock.mockImplementation(async (_tenant, sessionId, identity) => {
      if (!statefulSessionMode) return null;
      const row = durableSessions.find((candidate) => candidate.sessionId === sessionId);
      if (!row) return 'missing';
      if (row.revoked) return 'revoked';
      if (row.userId !== identity?.userId || row.userType !== identity?.userType) return 'identity_mismatch';
      return null;
    });
    logLifecycleMock.mockReset();
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
      user_type: 'internal',
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
      user_type: 'internal',
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
      user_type: 'internal',
      session_id: 'sess-1',
      last_plan_check: Date.now(),
      last_session_extend: Date.now(),
    };

    await runJwt(token);
    getRejectionReasonMock.mockResolvedValue('revoked');

    await expect(runJwt(token)).resolves.toBeNull();
    expect(getRejectionReasonMock).toHaveBeenCalledTimes(2);
  });

  // Returning null here deletes the session cookie, so a pool timeout on this
  // one lookup used to sign a working tenant out. The request is still refused:
  // requireLiveSession repeats the check and returns no session (see
  // getSession.test.ts, 'fails closed when the revocation lookup throws').
  it('keeps the session cookie when durable revocation state cannot be read', async () => {
    getRejectionReasonMock.mockRejectedValue(new Error('database unavailable'));

    const token = {
      id: 'u-1',
      tenant: 'tenant-1',
      user_type: 'internal',
      session_id: 'sess-1',
      // Stale enough that a verified session would have slid its expiry.
      last_plan_check: 0,
      last_session_extend: 0,
    };

    await expect(runJwt(token)).resolves.toMatchObject({ id: 'u-1', session_id: 'sess-1' });
    // An unhappy database is not asked to do the optional writes either.
    expect(extendExpiryMock).not.toHaveBeenCalled();
  });

  it('still drops the cookie when the lookup says the session is revoked', async () => {
    getRejectionReasonMock.mockResolvedValue('revoked');

    await expect(runJwt({
      id: 'u-1',
      tenant: 'tenant-1',
      user_type: 'internal',
      session_id: 'sess-1',
      last_plan_check: Date.now(),
      last_session_extend: Date.now(),
    })).resolves.toBeNull();
  });

  it.each([
    ['missing', 'durable_session_missing'],
    ['user_missing', 'durable_session_user_missing'],
    ['identity_mismatch', 'durable_session_identity_mismatch'],
  ] as const)('correlates the JWT rejection for %s durable-session state', async (reason, loggedReason) => {
    getRejectionReasonMock.mockResolvedValue(reason);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runJwt({
      id: 'u-1', tenant: 'tenant-1', user_type: 'internal', session_id: 'sess-1',
      last_plan_check: Date.now(), last_session_extend: Date.now(),
    })).resolves.toBeNull();

    expect(logLifecycleMock).toHaveBeenCalledWith('rejected', 'sess-1', loggedReason);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sess-1');
    warn.mockRestore();
  });

  it('correlates an unreadable durable-session lookup while preserving its existing cookie behavior', async () => {
    getRejectionReasonMock.mockRejectedValue(new Error('database unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runJwt({
      id: 'u-1', tenant: 'tenant-1', user_type: 'internal', session_id: 'sess-lookup',
      last_plan_check: 0, last_session_extend: 0,
    })).resolves.toMatchObject({ id: 'u-1', session_id: 'sess-lookup' });

    expect(logLifecycleMock).toHaveBeenCalledWith(
      'rejected', 'sess-lookup', 'durable_session_lookup_unavailable',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sess-lookup');
    warn.mockRestore();
  });

  it('correlates missing identity claims when a session identifier is available', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(runJwt({
      id: 'u-1', tenant: 'tenant-1', session_id: 'sess-claims',
      last_plan_check: Date.now(), last_session_extend: Date.now(),
    })).resolves.toBeNull();

    expect(logLifecycleMock).toHaveBeenCalledWith('rejected', 'sess-claims', 'missing_identity_claims');
    expect(getRejectionReasonMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('tests the Auth.js signOut event and passes only its session identifier to diagnostics', async () => {
    const authOptions = await getAuthOptions();
    const signOut = authOptions.events?.signOut;
    expect(signOut).toBeTypeOf('function');

    await signOut!({ token: {
      session_id: 'sess-signout',
      hashed_password: 'must-not-log',
      two_factor_secret: 'must-not-log-either',
    } } as any);

    expect(logLifecycleMock).toHaveBeenCalledWith('signed_out', 'sess-signout');
    expect(JSON.stringify(logLifecycleMock.mock.calls)).not.toContain('must-not-log');
  });

  it('T010: drops the cookie for a token whose user_type is service without consulting the sessions table', async () => {
    await expect(runJwt({
      id: 'u-1',
      tenant: 'tenant-1',
      user_type: 'service',
      session_id: 'sess-1',
      last_plan_check: Date.now(),
      last_session_extend: Date.now(),
    })).resolves.toBeNull();

    expect(getRejectionReasonMock).not.toHaveBeenCalled();
    expect(extendExpiryMock).not.toHaveBeenCalled();
  });

  it('rejects a reused OAuth JWT with no durable session_id', async () => {
    await expect(runJwt({
      id: 'u-1',
      tenant: 'tenant-1',
      last_plan_check: Date.now(),
    })).resolves.toBeNull();

    expect(getRejectionReasonMock).not.toHaveBeenCalled();
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
    expect(getRejectionReasonMock).toHaveBeenCalledWith(
      'tenant-1',
      'sess-created',
      { userId: 'u-1', userType: 'internal' }
    );
  });

  it('runs credentials sign-in through Auth.js with an existing cookie at the session limit', async () => {
    statefulSessionMode = true;
    const options = await getAuthOptions();
    options.providers = [{
      id: 'credentials', name: 'Credentials', type: 'credentials', credentials: {},
      authorize: async () => {
        await enforceMaxSessionsMock('tenant-1', 'u-1', 5);
        return {
          id: 'u-1', email: 'user@example.test', username: 'user', name: 'Test User',
          tenant: 'tenant-1', user_type: 'internal',
        };
      },
    } as any];
    const cookieJar = new Map<string, string>();
    const authConfig = {
      ...options,
      secret: 'auth-handler-session-lifecycle-test-secret',
      trustHost: true,
      basePath: '/api/auth',
    } as any;
    const request = async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (cookieJar.size) headers.set('cookie', [...cookieJar].map(([key, value]) => `${key}=${value}`).join('; '));
      const response = await Auth(new Request(`http://app.test/api/auth/${path}`, { ...init, headers }), authConfig);
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0];
        const separator = pair.indexOf('=');
        cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return response;
    };
    const csrfResponse = await request('csrf');
    const { csrfToken } = await csrfResponse.json();
    const signIn = () => request('callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'test-agent' },
      body: new URLSearchParams({ csrfToken, callbackUrl: 'http://app.test/', email: 'user@example.test', password: 'correct-password' }),
    });

    expect((await signIn()).status).toBe(302);
    const firstSession = durableSessions.find((row) => !row.revoked)!;
    const existingSessionCookie = cookieJar.get('authjs.session-token');
    expect(existingSessionCookie).toBeTruthy();
    for (let index = 0; index < 4; index += 1) {
      durableSessions.push({
        sessionId: `existing-${index}`,
        tenant: 'tenant-1', userId: 'u-1', userType: 'internal', revoked: false,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), lastActivity: Date.now() + index,
      });
    }
    const callbackInputs: Array<Record<string, unknown>> = [];
    const originalJwt = options.callbacks!.jwt!;
    options.callbacks!.jwt = async (args: any) => {
      if (args.user) callbackInputs.push(structuredClone(args.token));
      return originalJwt(args);
    };

    expect((await signIn()).status).toBe(302);
    expect(existingSessionCookie).toBeTruthy();
    expect(cookieJar.get('authjs.session-token')).toBeTruthy();
    expect(callbackInputs).toHaveLength(1);
    expect(callbackInputs[0]).not.toHaveProperty('session_id');
    expect(firstSession.revoked).toBe(true);
    expect(durableSessions.filter((row) => !row.revoked)).toHaveLength(5);

    const decoded = await request('session');
    expect(decoded.status).toBe(200);
    expect(await decoded.json()).toMatchObject({ user: { id: 'u-1', tenant: 'tenant-1' } });
    expect(durableSessions.filter((row) => !row.revoked)).toHaveLength(5);
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
