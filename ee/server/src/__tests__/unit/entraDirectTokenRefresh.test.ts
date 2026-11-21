import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosPostMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const getEntraDirectRefreshTokenMock = vi.fn();
const saveEntraDirectTokenSetMock = vi.fn();
const saveEntraDirectRefreshTokenMock = vi.fn();

const isAxiosErrorMock = (error: unknown): boolean =>
  Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError);

vi.mock('axios', () => ({
  default: { post: axiosPostMock, isAxiosError: isAxiosErrorMock },
  post: axiosPostMock,
  isAxiosError: isAxiosErrorMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/tokenStore', () => ({
  getEntraDirectRefreshToken: getEntraDirectRefreshTokenMock,
  saveEntraDirectRefreshToken: saveEntraDirectRefreshTokenMock,
  saveEntraDirectTokenSet: saveEntraDirectTokenSetMock,
}));

describe('refreshEntraDirectToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-20T01:50:00.000Z'));
    axiosPostMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    getEntraDirectRefreshTokenMock.mockReset();
    saveEntraDirectRefreshTokenMock.mockReset();
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

  it('T035b: can mint a customer-tenant access token without replacing the stored partner access token', async () => {
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-35',
      clientSecret: 'client-secret-35',
      tenantId: null,
      source: 'tenant-secret',
    });
    getEntraDirectRefreshTokenMock.mockResolvedValue('refresh-token-old');
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'access-token-customer',
        refresh_token: 'refresh-token-rotated',
        expires_in: 1800,
        scope: 'https://graph.microsoft.com/Directory.Read.All offline_access',
      },
    });

    const { refreshEntraDirectAccessTokenForTenant } = await import('@ee/lib/integrations/entra/auth/refreshDirectToken');
    const result = await refreshEntraDirectAccessTokenForTenant('tenant-35', 'customer-tenant-35');

    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/customer-tenant-35/oauth2/v2.0/token',
      expect.stringContaining('grant_type=refresh_token'),
      expect.objectContaining({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    );
    expect(saveEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(saveEntraDirectRefreshTokenMock).toHaveBeenCalledWith('tenant-35', 'refresh-token-rotated');
    expect(result.accessToken).toBe('access-token-customer');
  });

  it('names the suberror and AADSTS code, and says reconnecting will not fix missing consent', async () => {
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-35',
      clientSecret: 'client-secret-35',
      tenantId: null,
      source: 'tenant-secret',
    });
    getEntraDirectRefreshTokenMock.mockResolvedValue('refresh-token-old');
    axiosPostMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          error: 'invalid_grant',
          suberror: 'consent_required',
          error_description:
            "AADSTS65001: The user or administrator has not consented to use the application with ID 'client-id-35'.",
        },
      },
    });

    const { refreshEntraDirectAccessTokenForTenant } = await import(
      '@ee/lib/integrations/entra/auth/refreshDirectToken'
    );
    await expect(
      refreshEntraDirectAccessTokenForTenant('tenant-35', 'customer-tenant-guid')
    ).rejects.toThrow(
      'Microsoft rejected the stored credentials for this connection (invalid_grant, consent_required, AADSTS65001). '
      + 'The app has not been granted admin consent in the managed tenant — grant consent there, then retry; reconnecting will not help.'
    );
  });

  describe('AADSTS classification', () => {
    const axiosRejection = (status: number, data: Record<string, unknown>) =>
      Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data, headers: { 'request-id': 'req-1' } },
        config: { data: 'client_secret=client-secret-x' },
      });

    beforeEach(() => {
      resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
        clientId: 'client-id-x',
        clientSecret: 'client-secret-x',
        tenantId: null,
        source: 'tenant-secret',
      });
      getEntraDirectRefreshTokenMock.mockResolvedValue('refresh-token-x');
    });

    it('maps 7000222 from the description to the mailbox-flow text and keeps metadata', async () => {
      axiosPostMock.mockRejectedValue(axiosRejection(401, {
        error: 'invalid_client',
        error_codes: [7000222],
        error_description: "AADSTS7000222: The provided client secret keys for app 'x' are expired.",
      }));
      const { refreshEntraDirectToken } = await import('@ee/lib/integrations/entra/auth/refreshDirectToken');
      const { formatMicrosoftOAuthFailureForMailboxFlow } = await import('@alga-psa/shared/services/email/microsoftOAuthErrors');
      const error: any = await refreshEntraDirectToken('tenant-x').catch((e) => e);
      expect(error.name).toBe('EntraOperatorError');
      expect(error.code).toBe('credential-rejected');
      expect(error.message).toBe(formatMicrosoftOAuthFailureForMailboxFlow('expired_client_secret'));
      expect(error.message).toMatch(/^aadsts_7000222_expired_secret: /);
      expect(error.aadstsCode).toBe('AADSTS7000222');
      expect(error.oauthError).toBe('invalid_client');
      expect(error.status).toBe(401);
      expect(error.requestId).toBe('req-1');
      expect(JSON.stringify(error)).not.toContain('client-secret-x');
    });

    it('populates aadstsCode and maps the kind when the code is only in error_codes', async () => {
      axiosPostMock.mockRejectedValue(axiosRejection(401, {
        error: 'invalid_client',
        error_codes: [7000222],
        error_description: 'The client secret has expired.',
      }));
      const { refreshEntraDirectToken } = await import('@ee/lib/integrations/entra/auth/refreshDirectToken');
      const error: any = await refreshEntraDirectToken('tenant-x').catch((e) => e);
      expect(error.code).toBe('credential-rejected');
      expect(error.message).toMatch(/^aadsts_7000222_expired_secret: /);
      expect(error.aadstsCode).toBe('AADSTS7000222');
    });

    it('keeps the existing message for an unmapped 401 (AADSTS70008)', async () => {
      axiosPostMock.mockRejectedValue(axiosRejection(401, {
        error: 'invalid_grant',
        error_codes: [70008],
        error_description: 'AADSTS70008: The refresh token has expired.',
      }));
      const { refreshEntraDirectToken } = await import('@ee/lib/integrations/entra/auth/refreshDirectToken');
      const error: any = await refreshEntraDirectToken('tenant-x').catch((e) => e);
      expect(error.code).toBe('credential-rejected');
      expect(error.message).toBe(
        'Microsoft rejected the stored credentials for this connection (invalid_grant, AADSTS70008). Reconnect Microsoft Entra to resume syncing.'
      );
      expect(error.aadstsCode).toBe('AADSTS70008');
    });
  });
});
