import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosPostMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const getEntraDirectRefreshTokenMock = vi.fn();
const saveEntraDirectTokenSetMock = vi.fn();

vi.mock('axios', () => ({
  default: { post: axiosPostMock },
  post: axiosPostMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/tokenStore', () => ({
  getEntraDirectRefreshToken: getEntraDirectRefreshTokenMock,
  saveEntraDirectTokenSet: saveEntraDirectTokenSetMock,
}));

describe('refreshEntraDirectToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T01:50:00.000Z'));
    axiosPostMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    getEntraDirectRefreshTokenMock.mockReset();
    saveEntraDirectTokenSetMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T035: updates stored access token and expiry fields after refresh', async () => {
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-35',
      clientSecret: 'client-secret-35',
      tenantId: null,
      source: 'tenant-secret',
    });
    getEntraDirectRefreshTokenMock.mockResolvedValue('refresh-token-old');
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'access-token-new',
        refresh_token: 'refresh-token-new',
        expires_in: 3600,
        scope: 'https://graph.microsoft.com/User.Read offline_access',
      },
    });

    const { refreshEntraDirectToken } = await import('@ee/lib/integrations/entra/auth/refreshDirectToken');
    const result = await refreshEntraDirectToken('tenant-35');

    expect(resolveMicrosoftCredentialsForTenantMock).toHaveBeenCalledWith('tenant-35');
    expect(getEntraDirectRefreshTokenMock).toHaveBeenCalledWith('tenant-35');
    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      expect.stringContaining('grant_type=refresh_token'),
      expect.objectContaining({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    );
    expect(axiosPostMock.mock.calls[0][1]).toContain('refresh_token=refresh-token-old');

    const expectedExpiresAt = '2026-02-20T02:50:00.000Z';
    expect(saveEntraDirectTokenSetMock).toHaveBeenCalledWith('tenant-35', {
      accessToken: 'access-token-new',
      refreshToken: 'refresh-token-new',
      expiresAt: expectedExpiresAt,
      scope: 'https://graph.microsoft.com/User.Read offline_access',
    });

    expect(result).toEqual({
      accessToken: 'access-token-new',
      refreshToken: 'refresh-token-new',
      expiresAt: expectedExpiresAt,
      scope: 'https://graph.microsoft.com/User.Read offline_access',
    });
  });
});
