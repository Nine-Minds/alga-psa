import { beforeEach, describe, expect, it, vi } from 'vitest';

// connectEntraCipp probes CIPP with the candidate credential before persisting
// anything — no secret-store staging, no connection-row writes on failure.
process.env.EDITION = 'ee';

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
});
