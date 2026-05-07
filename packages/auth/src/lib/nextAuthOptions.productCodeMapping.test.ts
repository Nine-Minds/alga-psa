import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieGetMock = vi.fn();
const cookieSetMock = vi.fn();
const applyOAuthAccountHintsMock = vi.fn(async (user: unknown) => user);
const updateLastLoginMock = vi.fn(async () => undefined);

const tenantFirstMock = vi.fn();
const subscriptionFirstMock = vi.fn();
const addonsSelectMock = vi.fn();

function makeTableQuery(table: string) {
  if (table === 'tenants') {
    return {
      where: vi.fn(() => ({
        select: vi.fn(() => ({
          first: tenantFirstMock,
        })),
      })),
    };
  }

  if (table === 'stripe_subscriptions') {
    return {
      where: vi.fn(() => ({
        whereIn: vi.fn(() => ({
          orderByRaw: vi.fn(() => ({
            select: vi.fn(() => ({
              first: subscriptionFirstMock,
            })),
          })),
        })),
      })),
    };
  }

  if (table === 'tenant_addons') {
    return {
      where: vi.fn(() => ({
        select: addonsSelectMock,
      })),
    };
  }

  throw new Error(`Unexpected table ${table}`);
}

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
vi.mock('@alga-psa/validation', () => ({ buildTenantPortalSlug: () => 'tenant-slug', isValidTenantSlug: () => true }));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
vi.mock('./sso/registry', () => ({
  getSSORegistry: () => ({
    applyOAuthAccountHints: (...args: unknown[]) => applyOAuthAccountHintsMock(...args),
    mapOAuthProfileToExtendedUser: vi.fn(),
    decodeOAuthJwtPayload: vi.fn(() => null),
  }),
  registerSSOProvider: vi.fn(),
}));
vi.mock('./sso/enterpriseRegistryEntry', () => ({ loadEnterpriseSsoProviderRegistryImpl: async () => null }));
vi.mock('./sso/types', () => ({ OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {} }));
vi.mock('./sso/ceOAuthProfileMapper', () => ({ mapCeOAuthProfileToExtendedUser: vi.fn() }));
vi.mock('next/headers.js', () => ({
  cookies: async () => ({
    get: (...args: unknown[]) => cookieGetMock(...args),
    set: (...args: unknown[]) => cookieSetMock(...args),
  }),
}));
vi.mock('./sso/mspSsoResolution', () => ({
  MSP_SSO_RESOLUTION_COOKIE: 'msp_sso_resolution',
  getMspSsoSigningSecret: async () => 'unit-test-secret',
  parseAndVerifyMspSsoResolutionCookie: vi.fn(() => null),
}));
vi.mock('@alga-psa/db/models/UserSession', () => ({ UserSession: {} }));
vi.mock('./ipAddress', () => ({ getClientIp: vi.fn() }));
vi.mock('./deviceFingerprint', () => ({ generateDeviceFingerprint: vi.fn(), getDeviceInfo: vi.fn() }));
vi.mock('./geolocation', () => ({ getLocationFromIp: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: vi.fn() }));
vi.mock('./PortalDomainModel', () => ({ getPortalDomain: vi.fn(), getPortalDomainByHostname: vi.fn() }));
vi.mock('@alga-psa/db/models/user', () => ({ default: { updateLastLogin: (...args: unknown[]) => updateLastLoginMock(...args) } }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => ((table: string) => makeTableQuery(table))),
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), trace: vi.fn(), error: vi.fn() } }));

const { getAuthOptions } = await import('./nextAuthOptions');

describe('nextAuth product_code mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantFirstMock.mockResolvedValue({ plan: 'pro', product_code: 'algadesk' });
    subscriptionFirstMock.mockResolvedValue({
      status: 'trialing',
      current_period_end: new Date('2027-01-01T00:00:00.000Z'),
      metadata: {
        solo_pro_trial: 'true',
        solo_pro_trial_end: '2027-02-01T00:00:00.000Z',
        premium_trial: 'confirmed',
        premium_trial_effective_date: '2027-03-01T00:00:00.000Z',
      },
    });
    addonsSelectMock.mockResolvedValue([
      { addon_key: 'voice', expires_at: null },
      { addon_key: 'expired-addon', expires_at: '2000-01-01T00:00:00.000Z' },
    ]);
  });

  it('maps product_code into jwt and session user while preserving plan/addons/trial fields', async () => {
    const options = await getAuthOptions();
    const jwt = options.callbacks?.jwt;
    const session = options.callbacks?.session;

    expect(jwt).toBeTypeOf('function');
    expect(session).toBeTypeOf('function');

    const token = await jwt!({
      token: {},
      user: {
        id: 'u-1',
        email: 'u@example.com',
        name: 'User',
        tenant: 'tenant-1',
        user_type: 'internal',
      } as any,
      trigger: 'signIn',
    } as any);

    expect(token.product_code).toBe('algadesk');
    expect(token.plan).toBe('pro');
    expect(token.addons).toEqual(['voice']);
    expect(token.trial_end).toBe('2027-01-01T00:00:00.000Z');
    expect(token.solo_pro_trial_end).toBe('2027-02-01T00:00:00.000Z');
    expect(token.premium_trial_confirmed).toBe(true);
    expect(token.premium_trial_effective_date).toBe('2027-03-01T00:00:00.000Z');

    const sessionResult = await session!({
      session: { user: {} },
      token,
    } as any);

    expect((sessionResult.user as any).product_code).toBe('algadesk');
    expect((sessionResult.user as any).plan).toBe('pro');
    expect((sessionResult.user as any).addons).toEqual(['voice']);
    expect((sessionResult.user as any).trial_end).toBe('2027-01-01T00:00:00.000Z');
  });
});
