import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();
const getSessionWithRevocationCheckMock = vi.fn();
const resolveTeamsMicrosoftProviderConfigMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
  getSessionWithRevocationCheck: (...args: unknown[]) => getSessionWithRevocationCheckMock(...args),
  resolveTeamsMicrosoftProviderConfig: (...args: unknown[]) =>
    resolveTeamsMicrosoftProviderConfigMock(...args),
}));

const { resolveTeamsTabAuthState } = await import('server/src/lib/teams/resolveTeamsTabAuthState');

describe('resolveTeamsTabAuthState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockReset();
    getSessionWithRevocationCheckMock.mockReset();
    resolveTeamsMicrosoftProviderConfigMock.mockReset();
    getSessionMock.mockResolvedValue(null);
  });

  it('T151/T157/T161: resolves the Teams tab to the authenticated MSP user and tenant through the existing revocation-checked MSP session path', async () => {
    getSessionWithRevocationCheckMock.mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
        user_type: 'internal',
        name: 'Taylor Tech',
        email: 'taylor@example.com',
      },
    });
    resolveTeamsMicrosoftProviderConfigMock.mockResolvedValue({
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      microsoftTenantId: 'entra-tenant-1',
    });

    await expect(resolveTeamsTabAuthState()).resolves.toEqual({
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

  it('T152/T158/T159/T160/T162: rejects unauthenticated, wrong-tenant, unauthorized, and client-user Teams requests', async () => {
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

    await expect(resolveTeamsTabAuthState({ expectedTenantId: 'tenant-2' })).resolves.toEqual({
      status: 'forbidden',
      reason: 'wrong_tenant',
      tenantId: 'tenant-1',
      message: 'This Teams tab request does not match your PSA tenant.',
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

  it('T163/T164: blocks Teams auth when the selected Microsoft profile is missing or not ready and returns admin-readable remediation state', async () => {
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
});
