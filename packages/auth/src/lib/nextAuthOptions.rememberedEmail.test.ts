import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPendingRememberContextCookie,
  MSP_PENDING_REMEMBER_CONTEXT_COOKIE,
} from './mspRememberedEmail';

const cookieGetMock = vi.fn();
const cookieSetMock = vi.fn();
const applyOAuthAccountHintsMock = vi.fn(async (user: unknown) => user);
const updateLastLoginMock = vi.fn(async () => undefined);

vi.mock('next-auth/providers/credentials', () => ({
  default: (config: unknown) => config,
}));
vi.mock('next-auth/providers/keycloak', () => ({
  default: (config: unknown) => config,
}));
vi.mock('next-auth/providers/google', () => ({
  default: (config: unknown) => config,
}));
vi.mock('next-auth/providers/azure-ad', () => ({
  default: (config: unknown) => config,
}));

vi.mock('./session', () => ({
  getNextAuthSecret: async () => 'unit-test-secret',
  getNextAuthSecretSync: () => 'unit-test-secret',
  getSessionCookieConfig: () => ({ name: 'authjs.session-token', options: {} }),
  getSessionMaxAge: () => 60 * 60,
  withDevPortSuffix: (value: string) => value,
}));

vi.mock('./PortalDomainSessionToken', () => ({
  issuePortalDomainOtt: vi.fn(),
}));

vi.mock('@alga-psa/validation', () => ({
  buildTenantPortalSlug: () => 'tenant-slug',
  isValidTenantSlug: () => true,
}));

vi.mock('@alga-psa/core/features', () => ({
  isEnterprise: false,
}));

vi.mock('./sso/registry', () => ({
  getSSORegistry: () => ({
    applyOAuthAccountHints: (...args: unknown[]) => applyOAuthAccountHintsMock(...args),
    mapOAuthProfileToExtendedUser: vi.fn(),
    decodeOAuthJwtPayload: vi.fn(() => null),
  }),
  registerSSOProvider: vi.fn(),
}));

vi.mock('./sso/enterpriseRegistryEntry', () => ({
  loadEnterpriseSsoProviderRegistryImpl: async () => null,
}));

vi.mock('./sso/types', () => ({
  OAuthAccountLinkConflictError: class OAuthAccountLinkConflictError extends Error {},
}));

vi.mock('./sso/ceOAuthProfileMapper', () => ({
  mapCeOAuthProfileToExtendedUser: vi.fn(),
}));

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

vi.mock('@alga-psa/db/models/UserSession', () => ({
  UserSession: {},
}));

vi.mock('./ipAddress', () => ({
  getClientIp: vi.fn(),
}));

vi.mock('./deviceFingerprint', () => ({
  generateDeviceFingerprint: vi.fn(),
  getDeviceInfo: vi.fn(),
}));

vi.mock('./geolocation', () => ({
  getLocationFromIp: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  getConnection: vi.fn(),
}));

vi.mock('./PortalDomainModel', () => ({
  getPortalDomain: vi.fn(),
  getPortalDomainByHostname: vi.fn(),
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    updateLastLogin: (...args: unknown[]) => updateLastLoginMock(...args),
  },
}));

const { getAuthOptions } = await import('./nextAuthOptions');

function buildPendingCookieValue(publicWorkstation: boolean) {
  return createPendingRememberContextCookie({
    email: '  MixedCase@Example.COM  ',
    publicWorkstation,
    secret: 'unit-test-secret',
  }).value;
}

async function invokeOAuthSignIn(pendingCookieValue?: string) {
  cookieGetMock.mockImplementation((name: string) => {
    if (name === MSP_PENDING_REMEMBER_CONTEXT_COOKIE && pendingCookieValue) {
      return { value: pendingCookieValue };
    }
    return undefined;
  });

  const options = await getAuthOptions();
  const callback = options.callbacks?.signIn;
  if (!callback) {
    throw new Error('Expected signIn callback to be defined');
  }

  return callback({
    user: {
      id: 'user-1',
      email: 'user@example.com',
      tenant: 'tenant-1',
      user_type: 'internal',
    } as any,
    account: {
      provider: 'google',
      providerAccountId: 'user-1',
    } as any,
    credentials: undefined,
    profile: undefined,
  } as any);
}

describe('NextAuth remembered-email OAuth finalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyOAuthAccountHintsMock.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      tenant: 'tenant-1',
      user_type: 'internal',
    });
  });

  it('T016: successful OAuth login promotes the pending remember-context email into the durable cookie', async () => {
    const result = await invokeOAuthSignIn(buildPendingCookieValue(false));

    expect(result).toBe(true);
    expect(cookieSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_remembered_email',
        value: 'mixedcase@example.com',
        maxAge: 180 * 24 * 60 * 60,
      })
    );
  });

  it('T017/T018: successful OAuth login with public-workstation clears the durable cookie and clears pending state', async () => {
    const result = await invokeOAuthSignIn(buildPendingCookieValue(true));

    expect(result).toBe(true);
    expect(cookieSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_pending_remember_context',
        value: '',
        maxAge: 0,
      })
    );
    expect(cookieSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_remembered_email',
        value: '',
        maxAge: 0,
      })
    );
  });

  it('T019: missing pending remember-context fails closed without blocking successful OAuth login', async () => {
    const result = await invokeOAuthSignIn();

    expect(result).toBe(true);
    expect(cookieSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_remembered_email',
      })
    );
  });

  it('T019: invalid pending remember-context is cleared without creating a durable cookie', async () => {
    const result = await invokeOAuthSignIn('invalid.pending.value');

    expect(result).toBe(true);
    expect(cookieSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_pending_remember_context',
        value: '',
        maxAge: 0,
      })
    );
    expect(cookieSetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'msp_remembered_email',
        value: 'mixedcase@example.com',
      })
    );
  });
});
