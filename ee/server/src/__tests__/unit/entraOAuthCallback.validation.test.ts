import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const axiosPostMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const saveEntraDirectTokenSetMock = vi.fn();
const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock('axios', () => ({
  default: { post: axiosPostMock },
  post: axiosPostMock,
}));

vi.mock('@/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@/lib/integrations/entra/auth/tokenStore', () => ({
  saveEntraDirectTokenSet: saveEntraDirectTokenSetMock,
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

describe('Entra OAuth callback validation', () => {
  beforeEach(() => {
    vi.resetModules();
    axiosPostMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    saveEntraDirectTokenSetMock.mockReset();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
  });

  it('T033: rejects missing and invalid code/state callback requests', async () => {
    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');

    const missingParamsResponse = await GET(
      new NextRequest('http://localhost:3000/api/auth/microsoft/entra/callback')
    );
    const missingLocation = missingParamsResponse.headers.get('location');

    expect(missingParamsResponse.status).toBe(307);
    expect(missingLocation).toContain('entra_status=failure');
    expect(missingLocation).toContain('error=missing_params');

    const invalidStateResponse = await GET(
      new NextRequest(
        'http://localhost:3000/api/auth/microsoft/entra/callback?code=abc123&state=not-base64'
      )
    );
    const invalidLocation = invalidStateResponse.headers.get('location');

    expect(invalidStateResponse.status).toBe(307);
    expect(invalidLocation).toContain('entra_status=failure');
    expect(invalidLocation).toContain('error=invalid_state');

    expect(resolveMicrosoftCredentialsForTenantMock).not.toHaveBeenCalled();
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(saveEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(runWithTenantMock).not.toHaveBeenCalled();
  });

  it('T034: persists token references and marks direct connection active', async () => {
    const nowValue = 'db-now';
    const whereMock = vi.fn().mockReturnThis();
    const updateMock = vi.fn(async () => 1);
    const insertMock = vi.fn(async () => [1]);
    const knexMock = vi.fn(() => ({
      where: whereMock,
      update: updateMock,
      insert: insertMock,
    })) as any;
    knexMock.fn = { now: vi.fn(() => nowValue) };
    knexMock.raw = vi.fn((value: string) => `RAW(${value})`);

    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    resolveMicrosoftCredentialsForTenantMock.mockResolvedValue({
      clientId: 'client-id-1',
      clientSecret: 'client-secret-1',
      tenantId: null,
      source: 'tenant-secret',
    });
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: 'access-token-1',
        refresh_token: 'refresh-token-1',
        expires_in: 3600,
        scope: 'https://graph.microsoft.com/User.Read offline_access',
      },
    });

    const statePayload = {
      tenant: 'tenant-34',
      userId: 'user-34',
      nonce: 'nonce-34',
      timestamp: Date.now(),
      redirectUri: 'http://localhost:3000/api/auth/microsoft/entra/callback',
      provider: 'microsoft',
      integration: 'entra',
      connectionType: 'direct',
    } as const;
    const encodedState = Buffer.from(JSON.stringify(statePayload)).toString('base64');

    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');
    const response = await GET(
      new NextRequest(
        `http://localhost:3000/api/auth/microsoft/entra/callback?code=code-34&state=${encodeURIComponent(encodedState)}`
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('entra_status=success');

    expect(resolveMicrosoftCredentialsForTenantMock).toHaveBeenCalledWith('tenant-34');
    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      expect.stringContaining('code=code-34'),
      expect.objectContaining({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    );
    expect(saveEntraDirectTokenSetMock).toHaveBeenCalledWith(
      'tenant-34',
      expect.objectContaining({
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
        scope: 'https://graph.microsoft.com/User.Read offline_access',
      })
    );

    expect(runWithTenantMock).toHaveBeenCalledWith('tenant-34', expect.any(Function));
    expect(whereMock).toHaveBeenCalledWith({ tenant: 'tenant-34', is_active: true });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
        status: 'disconnected',
        disconnected_at: nowValue,
        updated_at: nowValue,
      })
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-34',
        connection_type: 'direct',
        status: 'connected',
        is_active: true,
        token_secret_ref: 'entra_direct',
        connected_at: nowValue,
        created_by: 'user-34',
        updated_by: 'user-34',
      })
    );
  });
});
