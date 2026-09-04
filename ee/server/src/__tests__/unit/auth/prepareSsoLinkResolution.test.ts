import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authMock,
  ensureSsoSettingsPermissionMock,
  hasTenantProviderCredentialsMock,
  hasAppFallbackProviderCredentialsMock,
  createSignedMspSsoResolutionCookieMock,
  getMspSsoSigningSecretMock,
  cookieStore,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  ensureSsoSettingsPermissionMock: vi.fn(),
  hasTenantProviderCredentialsMock: vi.fn(),
  hasAppFallbackProviderCredentialsMock: vi.fn(),
  createSignedMspSsoResolutionCookieMock: vi.fn(),
  getMspSsoSigningSecretMock: vi.fn(),
  cookieStore: { set: vi.fn() },
}));

vi.mock('server/src/app/api/auth/[...nextauth]/auth', () => ({ auth: authMock }));
vi.mock('@alga-psa/auth/actions/auth', () => ({ authenticateUser: vi.fn() }));
vi.mock('server/src/utils/authenticator/authenticator', () => ({ verifyAuthenticator: vi.fn() }));
vi.mock('server/src/lib/auth/sessionCookies', () => ({ getNextAuthSecret: vi.fn(async () => 'secret') }));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTierAccess: vi.fn(async () => undefined) }));
vi.mock('@ee/lib/actions/auth/ssoPermissions', () => ({
  ensureSsoSettingsPermission: ensureSsoSettingsPermissionMock,
}));
vi.mock('next/headers.js', () => ({ cookies: async () => cookieStore }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@alga-psa/auth/lib/sso/mspSsoResolution', () => ({
  MSP_SSO_RESOLUTION_COOKIE: 'msp_sso_resolution',
  MSP_SSO_RESOLUTION_TTL_SECONDS: 300,
  createSignedMspSsoResolutionCookie: createSignedMspSsoResolutionCookieMock,
  getMspSsoSigningSecret: getMspSsoSigningSecretMock,
  hasAppFallbackProviderCredentials: hasAppFallbackProviderCredentialsMock,
  hasTenantProviderCredentials: hasTenantProviderCredentialsMock,
  parseResolverProvider: (value: unknown) =>
    value === 'google' || value === 'azure-ad' ? value : null,
}));
vi.mock('@alga-psa/auth/lib/sso/clientPortalSsoResolution', () => ({
  CLIENT_PORTAL_SSO_DISCOVERY_COOKIE: 'client_portal_sso_discovery',
  CLIENT_PORTAL_SSO_RESOLUTION_COOKIE: 'client_portal_sso_resolution',
}));

import { prepareSsoLinkResolutionAction } from '@ee/lib/actions/auth/connectSso';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('prepareSsoLinkResolutionAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user-1', email: 'admin@example.com', tenant: TENANT_ID } });
    ensureSsoSettingsPermissionMock.mockResolvedValue({
      user: { user_id: 'user-1' },
      tenant: TENANT_ID,
    });
    getMspSsoSigningSecretMock.mockResolvedValue('signing-secret');
    createSignedMspSsoResolutionCookieMock.mockReturnValue({ value: 'cookie-value' });
  });

  it('mints a tenant-sourced cookie from the provider profile without app secrets', async () => {
    hasTenantProviderCredentialsMock.mockResolvedValue(true);
    hasAppFallbackProviderCredentialsMock.mockResolvedValue(false);

    const result = await prepareSsoLinkResolutionAction('azure-ad');

    expect(result).toEqual({ success: true });
    expect(hasTenantProviderCredentialsMock).toHaveBeenCalledWith(TENANT_ID, 'azure-ad');
    expect(createSignedMspSsoResolutionCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'azure-ad', source: 'tenant', tenantId: TENANT_ID })
    );
    expect(cookieStore.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'msp_sso_resolution', value: 'cookie-value' })
    );
  });

  it('clears a stale client-portal handshake that would outrank the MSP cookie', async () => {
    hasTenantProviderCredentialsMock.mockResolvedValue(true);
    hasAppFallbackProviderCredentialsMock.mockResolvedValue(false);

    await prepareSsoLinkResolutionAction('azure-ad');

    for (const name of ['client_portal_sso_discovery', 'client_portal_sso_resolution']) {
      expect(cookieStore.set).toHaveBeenCalledWith(
        expect.objectContaining({ name, value: '', maxAge: 0 })
      );
    }
  });

  it('falls back to the app credential source when the tenant has no profile', async () => {
    hasTenantProviderCredentialsMock.mockResolvedValue(false);
    hasAppFallbackProviderCredentialsMock.mockResolvedValue(true);

    const result = await prepareSsoLinkResolutionAction('azure-ad');

    expect(result).toEqual({ success: true });
    expect(createSignedMspSsoResolutionCookieMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'app', tenantId: undefined })
    );
  });

  it('fails without setting a cookie when neither source has credentials', async () => {
    hasTenantProviderCredentialsMock.mockResolvedValue(false);
    hasAppFallbackProviderCredentialsMock.mockResolvedValue(false);

    const result = await prepareSsoLinkResolutionAction('azure-ad');

    expect(result.success).toBe(false);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('rejects unsupported providers before touching the session', async () => {
    const result = await prepareSsoLinkResolutionAction('okta');

    expect(result.success).toBe(false);
    expect(authMock).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('rejects a session whose user no longer matches the permission context', async () => {
    ensureSsoSettingsPermissionMock.mockResolvedValue({
      user: { user_id: 'someone-else' },
      tenant: TENANT_ID,
    });

    const result = await prepareSsoLinkResolutionAction('azure-ad');

    expect(result.success).toBe(false);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
