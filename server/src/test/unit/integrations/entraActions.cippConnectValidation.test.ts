import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest';

// connectEntraCipp probes CIPP with the candidate credential before persisting
// anything — no secret-store staging, no connection-row writes on failure.
const prevEdition = process.env.EDITION;
process.env.EDITION = 'ee';
afterAll(() => {
  if (prevEdition === undefined) delete process.env.EDITION;
  else process.env.EDITION = prevEdition;
});

const hasPermissionMock = vi.fn();
const saveEntraCippCredentialsMock = vi.fn();
const getEntraCippCredentialsMock = vi.fn();
const clearEntraCippCredentialsMock = vi.fn();
const clearEntraDirectTokenSetMock = vi.fn();
const createTenantKnexMock = vi.fn();
const probeCippCredentialsMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@enterprise/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  saveEntraCippCredentials: saveEntraCippCredentialsMock,
  getEntraCippCredentials: getEntraCippCredentialsMock,
  clearEntraCippCredentials: clearEntraCippCredentialsMock,
}));

vi.mock('@enterprise/lib/integrations/entra/providers/cipp/cippProbe', () => ({
  probeCippCredentials: probeCippCredentialsMock,
  // The action narrows through the guard rather than `!probe.valid`, because
  // ee/server compiles without strictNullChecks where that does not narrow.
  isFailedCippProbe: (probe: { valid?: boolean }) => probe.valid === false,
}));

vi.mock('@enterprise/lib/integrations/entra/auth/tokenStore', () => ({
  clearEntraDirectTokenSet: clearEntraDirectTokenSetMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  // The connection swap runs in one transaction; the double runs the callback
  // against the same builder so the assertions below still see the writes.
  withTransaction: async (knexOrTrx: any, callback: (trx: any) => Promise<unknown>) =>
    callback(knexOrTrx),
  tenantDb: (conn: any) => ({
    table: (table: string) => conn(table),
  }),
}));

vi.mock('@alga-psa/integrations/entra/routes/entry', () => ({
  routes: {},
}));

const buildKnexMock = () => {
  const insertMock = vi.fn(async () => [1]);
  const updateMock = vi.fn(async () => 1);
  const knexMock = vi.fn(() => ({
    where: vi.fn().mockReturnThis(),
    update: updateMock,
    insert: insertMock,
  })) as any;
  knexMock.fn = { now: vi.fn(() => 'db-now') };
  knexMock.raw = vi.fn((value: string) => `RAW(${value})`);
  return { knexMock, insertMock, updateMock };
};

describe('connectEntraCipp validates before persisting', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    hasPermissionMock.mockResolvedValue(true);
    saveEntraCippCredentialsMock.mockReset();
    saveEntraCippCredentialsMock.mockResolvedValue(undefined);
    getEntraCippCredentialsMock.mockReset();
    getEntraCippCredentialsMock.mockResolvedValue(null);
    clearEntraCippCredentialsMock.mockReset();
    clearEntraCippCredentialsMock.mockResolvedValue(undefined);
    clearEntraDirectTokenSetMock.mockReset();
    clearEntraDirectTokenSetMock.mockResolvedValue(undefined);
    createTenantKnexMock.mockReset();
    probeCippCredentialsMock.mockReset();
  });

  it('writes nothing at all when CIPP rejects the candidate credential', async () => {
    probeCippCredentialsMock.mockResolvedValue({
      valid: false,
      checkedAt: '2026-07-25T00:00:00.000Z',
      error: 'CIPP credentials were rejected by the remote API.',
      code: 'auth_rejected',
    });
    const { knexMock, insertMock, updateMock } = buildKnexMock();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-1', user_type: 'internal' } as any,
      { tenant: 'tenant-1' },
      { baseUrl: 'https://cipp.example.com', apiToken: 'bad-token' }
    );

    expect(result).toEqual({
      success: false,
      error: 'CIPP credentials were rejected by the remote API.',
      // The probe's (non-secret) classification rides along so the dialog can title it.
      code: 'auth_rejected',
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    // Nothing was staged, so there is nothing to clear or restore.
    expect(saveEntraCippCredentialsMock).not.toHaveBeenCalled();
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
    // A failed connect must not take the direct credential down with it.
    expect(clearEntraDirectTokenSetMock).not.toHaveBeenCalled();
  });

  it('leaves a working credential untouched when a rotation fails validation', async () => {
    getEntraCippCredentialsMock.mockResolvedValue({
      baseUrl: 'https://cipp.example.com',
      apiToken: 'working-token',
    });
    probeCippCredentialsMock.mockResolvedValue({
      valid: false,
      checkedAt: '2026-07-25T00:00:00.000Z',
      error: 'CIPP credentials were rejected by the remote API.',
      code: 'auth_rejected',
    });
    const { knexMock, insertMock } = buildKnexMock();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    await connectEntraCipp(
      { user_id: 'user-2', user_type: 'internal' } as any,
      { tenant: 'tenant-2' },
      { baseUrl: 'https://cipp.example.com', apiToken: 'typo-token' }
    );

    expect(insertMock).not.toHaveBeenCalled();
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
    // The stored credential is never overwritten by an unvalidated one, so no
    // rollback is needed — and the active connection is never stamped
    // validation_failed by the probe.
    expect(saveEntraCippCredentialsMock).not.toHaveBeenCalled();
  });

  it('persists a validated connection with last_validated_at set', async () => {
    probeCippCredentialsMock.mockResolvedValue({
      valid: true,
      checkedAt: '2026-07-25T00:00:00.000Z',
      tenantCountSample: 3,
      endpoint: 'https://cipp.example.com/api/listtenants',
    });
    const { knexMock, insertMock } = buildKnexMock();
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-3', user_type: 'internal' } as any,
      { tenant: 'tenant-3' },
      { baseUrl: 'https://cipp.example.com', apiToken: 'good-token' }
    );

    expect(result.success).toBe(true);
    expect(saveEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-3', {
      authType: 'legacy_api_token',
      baseUrl: 'https://cipp.example.com',
      apiToken: 'good-token',
    });
    const insertedRow = insertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow).toMatchObject({
      tenant: 'tenant-3',
      connection_type: 'cipp',
      status: 'connected',
      is_active: true,
      last_validated_at: 'db-now',
    });

    // The Direct token set is only stale once the swap has committed. Clearing
    // it earlier would strand a tenant whose swap then failed.
    expect(clearEntraDirectTokenSetMock).toHaveBeenCalledWith('tenant-3');
    expect(insertMock.mock.invocationCallOrder[0]).toBeLessThan(
      clearEntraDirectTokenSetMock.mock.invocationCallOrder[0]
    );
  });

  it('restores the previous credential and spares the direct tokens when the swap fails', async () => {
    getEntraCippCredentialsMock.mockResolvedValue({
      baseUrl: 'https://old.example.com',
      apiToken: 'working-token',
    });
    probeCippCredentialsMock.mockResolvedValue({
      valid: true,
      checkedAt: '2026-07-25T00:00:00.000Z',
      tenantCountSample: 1,
      endpoint: 'https://cipp.example.com/api/listtenants',
    });

    const { knexMock } = buildKnexMock();
    knexMock.mockImplementation(() => ({
      where: vi.fn().mockReturnThis(),
      update: vi.fn(async () => 1),
      insert: vi.fn(async () => {
        throw new Error('deadlock detected');
      }),
    }));
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-4', user_type: 'internal' } as any,
      { tenant: 'tenant-4' },
      { baseUrl: 'https://cipp.example.com', apiToken: 'new-token' }
    );

    expect(result).toEqual({
      success: false,
      error: 'Unable to record the CIPP connection. Your previous connection was left in place.',
    });

    // There is one credential slot per tenant, so staging the candidate
    // clobbered a connection that still worked. It goes back.
    expect(saveEntraCippCredentialsMock).toHaveBeenLastCalledWith('tenant-4', {
      baseUrl: 'https://old.example.com',
      apiToken: 'working-token',
    });
    expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
    // And a swap that never committed does not get to retire the Direct tokens.
    expect(clearEntraDirectTokenSetMock).not.toHaveBeenCalled();
  });

  it('clears the staged credential when the swap fails and there was no predecessor', async () => {
    getEntraCippCredentialsMock.mockResolvedValue(null);
    probeCippCredentialsMock.mockResolvedValue({
      valid: true,
      checkedAt: '2026-07-25T00:00:00.000Z',
      tenantCountSample: 1,
      endpoint: 'https://cipp.example.com/api/listtenants',
    });

    const { knexMock } = buildKnexMock();
    knexMock.mockImplementation(() => ({
      where: vi.fn().mockReturnThis(),
      update: vi.fn(async () => 1),
      insert: vi.fn(async () => {
        throw new Error('deadlock detected');
      }),
    }));
    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { connectEntraCipp } = await import(
      '@alga-psa/integrations/actions/integrations/entraActions'
    );

    const result = await connectEntraCipp(
      { user_id: 'user-5', user_type: 'internal' } as any,
      { tenant: 'tenant-5' },
      { baseUrl: 'https://cipp.example.com', apiToken: 'new-token' }
    );

    expect(result.success).toBe(false);
    // Nothing to restore, so the staged credential is removed rather than left
    // behind pointing at a connection row that was never written.
    expect(clearEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-5');
    expect(clearEntraDirectTokenSetMock).not.toHaveBeenCalled();
  });

  describe('API client credentials', () => {
    const apiClient = {
      authType: 'api_client' as const,
      apiUrl: 'https://cipp.example.com/api/',
      clientId: 'client-1',
      clientSecret: 'action-secret-VALUE',
      tenantId: 'dir-1',
    };

    it('probes and saves the normalized candidate (no /api suffix, dossier field names)', async () => {
      probeCippCredentialsMock.mockResolvedValue({
        valid: true,
        checkedAt: '2026-07-25T00:00:00.000Z',
        tenantCountSample: 2,
        endpoint: 'https://cipp.example.com/api/listtenants',
      });
      const { knexMock, insertMock } = buildKnexMock();
      createTenantKnexMock.mockResolvedValue({ knex: knexMock });

      const { connectEntraCipp } = await import(
        '@alga-psa/integrations/actions/integrations/entraActions'
      );
      const result = await connectEntraCipp(
        { user_id: 'user-1', user_type: 'internal' } as any,
        { tenant: 'tenant-ac' },
        apiClient as any
      );

      const expected = {
        authType: 'api_client',
        baseUrl: 'https://cipp.example.com',
        clientId: 'client-1',
        clientSecret: 'action-secret-VALUE',
        directoryId: 'dir-1',
      };
      expect(result.success).toBe(true);
      expect(probeCippCredentialsMock).toHaveBeenCalledWith(expected);
      expect(saveEntraCippCredentialsMock).toHaveBeenCalledWith('tenant-ac', expected);
      expect(JSON.stringify(result)).not.toContain('action-secret-VALUE');
      expect(JSON.stringify(insertMock.mock.calls)).not.toContain('action-secret-VALUE');
    });

    it('persists nothing when the token mint fails, and never echoes the secret', async () => {
      probeCippCredentialsMock.mockResolvedValue({
        valid: false,
        checkedAt: '2026-07-25T00:00:00.000Z',
        error: 'Microsoft rejected the client secret.',
        code: 'token_mint_failed',
      });
      const { knexMock, insertMock, updateMock } = buildKnexMock();
      createTenantKnexMock.mockResolvedValue({ knex: knexMock });

      const { connectEntraCipp } = await import(
        '@alga-psa/integrations/actions/integrations/entraActions'
      );
      const result = await connectEntraCipp(
        { user_id: 'user-1', user_type: 'internal' } as any,
        { tenant: 'tenant-ac' },
        apiClient as any
      );

      expect(result).toEqual({
        success: false,
        error: 'Microsoft rejected the client secret.',
        code: 'token_mint_failed',
      });
      expect(saveEntraCippCredentialsMock).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('action-secret-VALUE');
    });

    it('passes the transport cause of an unreachable host through to the dialog', async () => {
      probeCippCredentialsMock.mockResolvedValue({
        valid: false,
        checkedAt: '2026-07-25T00:00:00.000Z',
        error: 'Could not reach CIPP at cipp.example.com: the host name does not resolve (DNS).',
        code: 'unreachable',
        cause: 'dns',
      });
      const { testEntraCippCredentials } = await import(
        '@alga-psa/integrations/actions/integrations/entraActions'
      );
      const result = await testEntraCippCredentials(
        { user_id: 'user-1', user_type: 'internal' } as any,
        { tenant: 'tenant-ac' },
        apiClient as any
      );
      expect(result).toMatchObject({ success: false, code: 'unreachable', cause: 'dns' });
      expect((result as { error: string }).error).toContain('does not resolve');
      expect(saveEntraCippCredentialsMock).not.toHaveBeenCalled();
    });

    it('tests an API client without persisting anything', async () => {
      probeCippCredentialsMock.mockResolvedValue({
        valid: true,
        checkedAt: '2026-07-25T00:00:00.000Z',
        tenantCountSample: 1,
        endpoint: 'https://cipp.example.com/api/listtenants',
      });
      const { testEntraCippCredentials } = await import(
        '@alga-psa/integrations/actions/integrations/entraActions'
      );
      const result = await testEntraCippCredentials(
        { user_id: 'user-1', user_type: 'internal' } as any,
        { tenant: 'tenant-ac' },
        apiClient as any
      );
      expect(result.success).toBe(true);
      expect(probeCippCredentialsMock).toHaveBeenCalledWith(
        expect.objectContaining({ authType: 'api_client', baseUrl: 'https://cipp.example.com' })
      );
      expect(saveEntraCippCredentialsMock).not.toHaveBeenCalled();
    });

    describe('reconnecting a legacy API-key connection as an API client', () => {
      const legacyOnRecord = {
        authType: 'legacy_api_token' as const,
        baseUrl: 'https://cipp.example.com',
        apiToken: 'legacy-key-VALUE',
      };
      const passingProbe = {
        valid: true,
        checkedAt: '2026-07-25T00:00:00.000Z',
        tenantCountSample: 3,
        endpoint: 'https://cipp.example.com/api/listtenants',
      };

      it('replaces the legacy credential and connection row with the API client', async () => {
        getEntraCippCredentialsMock.mockResolvedValue(legacyOnRecord);
        probeCippCredentialsMock.mockResolvedValue(passingProbe);
        const { knexMock, insertMock, updateMock } = buildKnexMock();
        createTenantKnexMock.mockResolvedValue({ knex: knexMock });

        const { connectEntraCipp } = await import(
          '@alga-psa/integrations/actions/integrations/entraActions'
        );
        const result = await connectEntraCipp(
          { user_id: 'user-r', user_type: 'internal' } as any,
          { tenant: 'tenant-r' },
          apiClient as any
        );

        expect(result.success).toBe(true);
        // The probe ran on the API client, never on the stored legacy key.
        expect(probeCippCredentialsMock).toHaveBeenCalledTimes(1);
        expect(probeCippCredentialsMock.mock.calls[0][0]).toMatchObject({ authType: 'api_client' });
        // The one credential slot now holds the API client.
        expect(saveEntraCippCredentialsMock).toHaveBeenCalledTimes(1);
        expect(saveEntraCippCredentialsMock).toHaveBeenCalledWith(
          'tenant-r',
          expect.objectContaining({ authType: 'api_client', clientId: 'client-1', directoryId: 'dir-1' })
        );
        // The old (legacy) row is retired and a fresh CIPP row recorded.
        expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ is_active: false, status: 'disconnected' }));
        expect(insertMock).toHaveBeenCalledWith(
          expect.objectContaining({ connection_type: 'cipp', status: 'connected', cipp_base_url: 'https://cipp.example.com' })
        );
        expect(JSON.stringify(insertMock.mock.calls)).not.toContain('legacy-key-VALUE');
      });

      it('leaves the legacy connection working when the API client fails its test', async () => {
        getEntraCippCredentialsMock.mockResolvedValue(legacyOnRecord);
        probeCippCredentialsMock.mockResolvedValue({
          valid: false,
          checkedAt: '2026-07-25T00:00:00.000Z',
          error: 'CIPP refused the request from this address.',
          code: 'ip_blocked',
        });
        const { knexMock, insertMock, updateMock } = buildKnexMock();
        createTenantKnexMock.mockResolvedValue({ knex: knexMock });

        const { connectEntraCipp } = await import(
          '@alga-psa/integrations/actions/integrations/entraActions'
        );
        const result = await connectEntraCipp(
          { user_id: 'user-r', user_type: 'internal' } as any,
          { tenant: 'tenant-r' },
          apiClient as any
        );

        expect(result).toMatchObject({ success: false, code: 'ip_blocked' });
        expect(saveEntraCippCredentialsMock).not.toHaveBeenCalled();
        expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
      });

      it('puts the legacy key back, shape and all, when the swap fails', async () => {
        getEntraCippCredentialsMock.mockResolvedValue(legacyOnRecord);
        probeCippCredentialsMock.mockResolvedValue(passingProbe);
        const { knexMock } = buildKnexMock();
        knexMock.mockImplementation(() => ({
          where: vi.fn().mockReturnThis(),
          update: vi.fn(async () => 1),
          insert: vi.fn(async () => {
            throw new Error('deadlock detected');
          }),
        }));
        createTenantKnexMock.mockResolvedValue({ knex: knexMock });

        const { connectEntraCipp } = await import(
          '@alga-psa/integrations/actions/integrations/entraActions'
        );
        const result = await connectEntraCipp(
          { user_id: 'user-r', user_type: 'internal' } as any,
          { tenant: 'tenant-r' },
          apiClient as any
        );

        expect(result.success).toBe(false);
        expect(saveEntraCippCredentialsMock).toHaveBeenLastCalledWith('tenant-r', legacyOnRecord);
        expect(clearEntraCippCredentialsMock).not.toHaveBeenCalled();
        expect(clearEntraDirectTokenSetMock).not.toHaveBeenCalled();
      });
    });

    it('rejects an API client missing its secret before any probe', async () => {
      const { connectEntraCipp } = await import(
        '@alga-psa/integrations/actions/integrations/entraActions'
      );
      const result = await connectEntraCipp(
        { user_id: 'user-1', user_type: 'internal' } as any,
        { tenant: 'tenant-ac' },
        { ...apiClient, clientSecret: '' } as any
      );
      expect(result.success).toBe(false);
      expect(probeCippCredentialsMock).not.toHaveBeenCalled();
      expect(saveEntraCippCredentialsMock).not.toHaveBeenCalled();
    });
  });
});
