import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const axiosPostMock = vi.fn();
const axiosGetMock = vi.fn();
const resolveMicrosoftCredentialsForTenantMock = vi.fn();
const saveEntraDirectTokenSetMock = vi.fn();
const getEntraDirectTokenSetMock = vi.fn();
const clearEntraDirectTokenSetMock = vi.fn();
const clearEntraCippCredentialsMock = vi.fn();
const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const getCurrentUserMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: axiosPostMock,
    get: axiosGetMock,
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
  },
  post: axiosPostMock,
  get: axiosGetMock,
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/microsoftCredentialResolver', () => ({
  resolveMicrosoftCredentialsForTenant: resolveMicrosoftCredentialsForTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/auth/tokenStore', () => ({
  saveEntraDirectTokenSet: saveEntraDirectTokenSetMock,
  getEntraDirectTokenSet: getEntraDirectTokenSetMock,
  clearEntraDirectTokenSet: clearEntraDirectTokenSetMock,
}));

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  clearEntraCippCredentials: clearEntraCippCredentialsMock,
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

const STATE_TENANT = 'tenant-34';

function encodeState(overrides: Record<string, unknown> = {}): string {
  const statePayload = {
    tenant: STATE_TENANT,
    userId: 'user-34',
    nonce: 'nonce-34',
    timestamp: Date.now(),
    redirectUri: 'http://localhost:3000/api/auth/microsoft/entra/callback',
    provider: 'microsoft',
    integration: 'entra',
    connectionType: 'direct',
    ...overrides,
  };
  return Buffer.from(JSON.stringify(statePayload)).toString('base64');
}

function callbackRequest(state: string, code = 'code-34'): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/auth/microsoft/entra/callback?code=${code}&state=${encodeURIComponent(state)}`
  );
}

function knexDouble() {
  const whereMock = vi.fn().mockReturnThis();
  const updateMock = vi.fn(async () => 1);
  const insertMock = vi.fn(async () => [1]);
  const trxMock = vi.fn(() => ({
    where: whereMock,
    update: updateMock,
    insert: insertMock,
  })) as any;
  trxMock.fn = { now: vi.fn(() => 'db-now') };
  trxMock.raw = vi.fn((value: string) => `RAW(${value})`);

  const knexMock = vi.fn(() => ({
    where: whereMock,
    update: updateMock,
    insert: insertMock,
  })) as any;
  knexMock.fn = trxMock.fn;
  knexMock.raw = trxMock.raw;
  // The connection swap runs in one transaction; the double hands the callback
  // a trx that records the same calls.
  knexMock.transaction = vi.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(trxMock));

  return { knexMock, trxMock, whereMock, updateMock, insertMock };
}

describe('Entra OAuth callback validation', () => {
  beforeEach(() => {
    vi.resetModules();
    axiosPostMock.mockReset();
    axiosGetMock.mockReset();
    resolveMicrosoftCredentialsForTenantMock.mockReset();
    saveEntraDirectTokenSetMock.mockReset();
    getEntraDirectTokenSetMock.mockReset();
    clearEntraDirectTokenSetMock.mockReset();
    clearEntraCippCredentialsMock.mockReset();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    getCurrentUserMock.mockReset();
    process.env.NEXTAUTH_URL = 'http://localhost:3000';

    getEntraDirectTokenSetMock.mockResolvedValue(null);
    clearEntraDirectTokenSetMock.mockResolvedValue(undefined);
    clearEntraCippCredentialsMock.mockResolvedValue(undefined);

    getCurrentUserMock.mockResolvedValue({ user_id: 'user-34', tenant: STATE_TENANT });
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

  it('T034: validates against Graph, then persists token references and marks direct connection active', async () => {
    const { knexMock, whereMock, updateMock, insertMock } = knexDouble();

    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    axiosGetMock.mockResolvedValue({ data: { value: [{ tenantId: 'managed-1' }] } });

    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');
    const response = await GET(callbackRequest(encodeState()));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('entra_status=success');

    expect(resolveMicrosoftCredentialsForTenantMock).toHaveBeenCalledWith(STATE_TENANT);
    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      expect.stringContaining('code=code-34'),
      expect.objectContaining({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
    );

    // The Graph probe runs on the freshly exchanged token, before anything is written.
    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/beta/tenantRelationships/managedTenants/tenants?$top=1',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access-token-1' },
      })
    );
    expect(axiosGetMock.mock.invocationCallOrder[0]).toBeLessThan(
      saveEntraDirectTokenSetMock.mock.invocationCallOrder[0]
    );

    expect(saveEntraDirectTokenSetMock).toHaveBeenCalledWith(
      STATE_TENANT,
      expect.objectContaining({
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
        scope: 'https://graph.microsoft.com/User.Read offline_access',
      })
    );

    expect(runWithTenantMock).toHaveBeenCalledWith(STATE_TENANT, expect.any(Function));
    expect(whereMock).toHaveBeenCalledWith({ is_active: true });
    expect(whereMock).toHaveBeenCalledWith('entra_partner_connections.tenant', STATE_TENANT);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
        status: 'disconnected',
        disconnected_at: 'db-now',
        updated_at: 'db-now',
      })
    );
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: STATE_TENANT,
        connection_type: 'direct',
        status: 'connected',
        is_active: true,
        token_secret_ref: 'entra_direct',
        connected_at: 'db-now',
        created_by: 'user-34',
        updated_by: 'user-34',
      })
    );

    // The superseded CIPP credential is retired last. Until the swap commits it
    // is still backing the tenant's active connection.
    expect(clearEntraCippCredentialsMock).toHaveBeenCalledWith(STATE_TENANT);
    expect(insertMock.mock.invocationCallOrder[0]).toBeLessThan(
      clearEntraCippCredentialsMock.mock.invocationCallOrder[0]
    );
  });

  it('T035: a token Graph rejects persists nothing at all', async () => {
    const { knexMock, updateMock, insertMock } = knexDouble();

    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    axiosGetMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403 },
    });

    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');
    const response = await GET(callbackRequest(encodeState()));

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).toContain('entra_status=failure');
    expect(location).toContain('error=consent_missing');
    expect(location).toContain('message=');

    // Nothing is written: no stored token set, and no connection row touched —
    // so a tenant with a working connection still has it.
    expect(saveEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(runWithTenantMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
  });

  it('T036: an unreachable Graph endpoint also persists nothing', async () => {
    const { knexMock, updateMock, insertMock } = knexDouble();

    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    axiosGetMock.mockRejectedValue(new Error('socket hang up'));

    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');
    const response = await GET(callbackRequest(encodeState()));

    expect(response.headers.get('location')).toContain('error=validation_failed');
    expect(saveEntraDirectTokenSetMock).not.toHaveBeenCalled();
    expect(runWithTenantMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
  });

  it('T038: a failed connection swap restores the prior token set and spares the CIPP credential', async () => {
    const { knexMock } = knexDouble();
    const priorTokenSet = {
      accessToken: 'prior-access',
      refreshToken: 'prior-refresh',
      expiresAt: '2026-01-01T00:00:00.000Z',
      scope: 'prior-scope',
    };

    getEntraDirectTokenSetMock.mockResolvedValue(priorTokenSet);
    knexMock.transaction = vi.fn(async () => {
      throw new Error('deadlock detected');
    });
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
    axiosGetMock.mockResolvedValue({ data: { value: [{ tenantId: 'managed-1' }] } });

    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');
    const response = await GET(callbackRequest(encodeState()));

    expect(response.headers.get('location')).toContain('error=callback_error');

    // The token slot holds one set per tenant, so the write above clobbered a
    // Direct connection that still worked. It goes back.
    expect(saveEntraDirectTokenSetMock).toHaveBeenLastCalledWith(STATE_TENANT, priorTokenSet);
    // And the CIPP credential — which may be the one actually backing the
    // active connection — is never touched on a failed swap.
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
  });

  it('T037: a session that does not match the state tenant never reaches the token exchange', async () => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-99', tenant: 'other-tenant' });

    const { GET } = await import('@ee/app/api/auth/microsoft/entra/callback/route');
    const response = await GET(callbackRequest(encodeState()));

    expect(response.headers.get('location')).toContain('error=tenant_mismatch');
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(axiosGetMock).not.toHaveBeenCalled();
    expect(saveEntraDirectTokenSetMock).not.toHaveBeenCalled();
  });
});
