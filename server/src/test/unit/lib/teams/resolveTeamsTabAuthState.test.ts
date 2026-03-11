import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();
const getSessionWithRevocationCheckMock = vi.fn();
const resolveTeamsMicrosoftProviderConfigMock = vi.fn();
const getTenantIdBySlugMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionWithRevocationCheck: (...args: unknown[]) => getSessionWithRevocationCheckMock(...args),
  resolveTeamsMicrosoftProviderConfig: (...args: unknown[]) =>
    resolveTeamsMicrosoftProviderConfigMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  getTenantIdBySlug: (...args: unknown[]) => getTenantIdBySlugMock(...args),
  isValidTenantSlug: (value: string) => value.includes('-'),
}));

const { resolveTeamsTabAuthState } = await import('../../../../../../ee/server/src/lib/teams/resolveTeamsTabAuthState');

describe('resolveTeamsTabAuthState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockReset();
    getSessionWithRevocationCheckMock.mockReset();
    resolveTeamsMicrosoftProviderConfigMock.mockReset();
    getTenantIdBySlugMock.mockReset();
    getSessionMock.mockResolvedValue(null);
  });

  it('T151/T157/T161/T167/T173: resolves the Teams tab to the authenticated MSP user and tenant through the existing revocation-checked MSP session path, accepts the matching Microsoft tenant claim, and resolves tenant slugs correctly', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
        user_type: 'internal',
        name: 'Taylor Tech',
        email: 'taylor@example.com',
      },
    });
    getTenantIdBySlugMock.mockResolvedValue('tenant-1');
    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValue({
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    await expect(
      resolveTeamsTabAuthState({
        expectedTenantId: 'acme-helpdesk',
        expectedMicrosoftTenantId: 'ENTRA-TENANT-1',
      })
    ).resolves.toEqual({
      status: 'ready',
      tenantId: 'tenant-1',
      userId: 'user-1',
      userName: 'Taylor Tech',
      userEmail: 'taylor@example.com',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });
    expect(getSessionWithRevocationCheckMock).toHaveBeenCalledTimes(1);
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(resolveTeamsMicrosoftProviderConfigMock).toHaveBeenCalledWith('tenant-1');
  });

  it('T152/T158/T159/T160/T162/T168/T174: rejects unauthenticated, wrong-tenant, wrong-Microsoft-tenant, unresolved tenant-slug, unauthorized, and client-user Teams requests', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValue(null);

    await expect(resolveTeamsTabAuthState()).resolves.toEqual({
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    });

    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'client-user',
        tenant: 'tenant-1',
        user_type: 'client',
      },
    });

    await expect(resolveTeamsTabAuthState()).resolves.toEqual({
      status: 'forbidden',
      reason: 'client_user',
      tenantId: 'tenant-1',
      message: 'Microsoft Teams access is available only to MSP users in v1.',
    });

    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'user-2',
        tenant: 'tenant-1',
        user_type: 'internal',
      },
    });
    getTenantIdBySlugMock.mockResolvedValueOnce('tenant-2');

    await expect(resolveTeamsTabAuthState({ expectedTenantId: 'acme-helpdesk' })).resolves.toEqual({
      status: 'forbidden',
      reason: 'wrong_tenant',
      tenantId: 'tenant-1',
      message: 'This Teams tab request does not match your PSA tenant.',
    });

    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValueOnce({
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    await expect(
      resolveTeamsTabAuthState({ expectedMicrosoftTenantId: 'entra-tenant-2' })
    ).resolves.toEqual({
      status: 'forbidden',
      reason: 'wrong_microsoft_tenant',
      tenantId: 'tenant-1',
      message:
        'This Teams request was issued for a different Microsoft tenant than the one configured for this PSA tenant.',
    });

    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        tenant: 'tenant-1',
        user_type: 'internal',
      },
    });

    await expect(resolveTeamsTabAuthState()).resolves.toEqual({
      status: 'forbidden',
      reason: 'unauthorized',
      tenantId: 'tenant-1',
      message: 'Your session is missing the PSA user context required for Teams.',
    });
  });

  it('T163/T164/T272: blocks Teams auth when the selected Microsoft profile is missing or not ready and returns admin-readable remediation state', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'user-3',
        tenant: 'tenant-1',
        user_type: 'internal',
      },
    });

    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValueOnce({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    await expect(resolveTeamsTabAuthState()).resolves.toEqual({
      status: 'not_configured',
      tenantId: 'tenant-1',
      message: 'Teams is not configured for this tenant',
    });

    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValueOnce({
      status: 'invalid_profile',
      tenantId: 'tenant-1',
      message: 'Selected Teams Microsoft profile is missing or archived',
    });

    await expect(resolveTeamsTabAuthState()).resolves.toEqual({
      status: 'invalid_profile',
      tenantId: 'tenant-1',
      message: 'Selected Teams Microsoft profile is missing or archived',
    });
  });

  it('T175/T176/T271: re-reads the currently selected Teams Microsoft profile on each request so rebinding invalidates stale tenant assumptions', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'user-4',
        tenant: 'tenant-1',
        user_type: 'internal',
      },
    });

    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValueOnce({
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    await expect(
      resolveTeamsTabAuthState({ expectedMicrosoftTenantId: 'entra-tenant-1' })
    ).resolves.toMatchObject({
      status: 'ready',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValueOnce({
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-2',
      microsoftTenantId: 'entra-tenant-2',
    });

    await expect(
      resolveTeamsTabAuthState({ expectedMicrosoftTenantId: 'entra-tenant-1' })
    ).resolves.toEqual({
      status: 'forbidden',
      reason: 'wrong_microsoft_tenant',
      tenantId: 'tenant-1',
      message:
        'This Teams request was issued for a different Microsoft tenant than the one configured for this PSA tenant.',
    });
  });

  it('T183/T184: returns Teams-safe auth remediation messages without leaking raw OAuth or provider error details into Teams surfaces', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValueOnce(null);

    const unauthenticated = await resolveTeamsTabAuthState();
    expect(unauthenticated).toEqual({
      status: 'unauthenticated',
      message: 'Sign in with your MSP account to open Alga PSA in Teams.',
    });

    getSessionWithRevocationCheckMock.mockResolvedValueOnce({
      user: {
        id: 'client-user',
        tenant: 'tenant-1',
        user_type: 'client',
      },
    });

    const clientUser = await resolveTeamsTabAuthState();
    expect(clientUser).toEqual({
      status: 'forbidden',
      reason: 'client_user',
      tenantId: 'tenant-1',
      message: 'Microsoft Teams access is available only to MSP users in v1.',
    });

    getSessionWithRevocationCheckMock.mockResolvedValueOnce({
      user: {
        id: 'user-5',
        tenant: 'tenant-1',
        user_type: 'internal',
      },
    });
    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValueOnce({
      status: 'invalid_profile',
      tenantId: 'tenant-1',
      message: 'Selected Teams Microsoft profile is missing required credentials',
    });

    const invalidProfile = await resolveTeamsTabAuthState();
    expect(invalidProfile).toEqual({
      status: 'invalid_profile',
      tenantId: 'tenant-1',
      message: 'Selected Teams Microsoft profile is missing required credentials',
    });

    for (const state of [unauthenticated, clientUser, invalidProfile]) {
      expect(state.message).not.toMatch(/aadsts|oauth|openid|nextauth|token/i);
    }
  });
});
