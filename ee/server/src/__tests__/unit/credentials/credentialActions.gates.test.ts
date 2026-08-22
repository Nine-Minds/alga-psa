/**
 * Tier gate + fail-closed reveal audit contracts for the credentials vault:
 *  - save actions return a safe result below Pro via assertTierAccess(TIER_FEATURES.CREDENTIALS)
 *  - reveal is fail-closed: if the audit insert fails, the action throws and no
 *    value is returned (no audit row ⇒ no value).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  hasPermissionMock,
  assertTierAccessMock,
  TierAccessErrorMock,
  auditLogMock,
  nativeListMock,
  nativeListByIdsMock,
  nativeResolveOwnerClientIdMock,
  huduListMock,
  huduResolveByIdsMock,
  huduResolveOwnerClientIdMock,
  huduCreateMock,
  huduUpdateMock,
  getHuduIntegrationMock,
  getHuduCompanyMappingRowsMock,
  loadAssociationsForEntityMock,
  pruneAssociationRefsMock,
  resolveEntityClientIdMock,
  nativeCreateMock,
  nativeUpdateMock,
  loggerErrorMock,
} = vi.hoisted(() => {
  class TierAccessErrorMock extends Error {
    readonly statusCode = 403;
    readonly code = 'TIER_ACCESS_DENIED';
  }
  return {
    hasPermissionMock: vi.fn(),
    assertTierAccessMock: vi.fn(),
    TierAccessErrorMock,
    auditLogMock: vi.fn(),
    nativeListMock: vi.fn(async () => []),
    nativeListByIdsMock: vi.fn(async () => []),
    nativeResolveOwnerClientIdMock: vi.fn(async () => null),
    huduListMock: vi.fn(async () => []),
    huduResolveByIdsMock: vi.fn(async () => []),
    huduResolveOwnerClientIdMock: vi.fn(async () => null),
    huduCreateMock: vi.fn(),
    huduUpdateMock: vi.fn(),
    getHuduIntegrationMock: vi.fn(async () => null),
    getHuduCompanyMappingRowsMock: vi.fn(async () => []),
    loadAssociationsForEntityMock: vi.fn(async () => []),
    pruneAssociationRefsMock: vi.fn(async () => undefined),
    resolveEntityClientIdMock: vi.fn(async () => null),
    nativeCreateMock: vi.fn(),
    nativeUpdateMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: unknown[]) => Promise<unknown>) => (...args: unknown[]) =>
    handler(internalUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
  TierAccessError: TierAccessErrorMock,
}));

vi.mock('@alga-psa/types', () => {
  const TIER_FEATURES = { CREDENTIALS: 'CREDENTIALS' };
  return { TIER_FEATURES };
});

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
}));

vi.mock('server/src/lib/logging/auditLog', () => ({
  auditLog: auditLogMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: getHuduIntegrationMock,
}));

vi.mock('@ee/lib/integrations/hudu/companyMapping', () => ({
  getHuduCompanyMappingRows: getHuduCompanyMappingRowsMock,
}));

vi.mock('@ee/lib/credentials/nativeSource', () => ({
  nativeCredentialSource: {
    list: nativeListMock,
    listByIds: nativeListByIdsMock,
    resolveOwnerClientId: nativeResolveOwnerClientIdMock,
    create: nativeCreateMock,
    update: nativeUpdateMock,
  },
}));

vi.mock('@ee/lib/credentials/huduSource', () => ({
  huduCredentialSource: {
    list: huduListMock,
    resolveByIds: huduResolveByIdsMock,
    resolveOwnerClientId: huduResolveOwnerClientIdMock,
    create: huduCreateMock,
    update: huduUpdateMock,
  },
  isHuduCredentialId: (id: string) => id.startsWith('hudu:'),
}));

vi.mock('@ee/lib/credentials/associations', () => ({
  loadAssociationsForEntity: loadAssociationsForEntityMock,
  pruneAssociationRefs: pruneAssociationRefsMock,
  resolveEntityClientId: resolveEntityClientIdMock,
  addCredentialToEntity: vi.fn(),
  removeCredentialFromEntity: vi.fn(),
  setEntityCredentials: vi.fn(),
}));

const internalUser = {
  user_id: 'user-1',
  tenant: 'tenant-1',
  user_type: 'internal',
  roles: [],
};

async function importActions() {
  return import('@ee/lib/actions/credentials/credentialActions');
}

beforeEach(() => {
  vi.resetModules();
  hasPermissionMock.mockReset();
  assertTierAccessMock.mockReset();
  hasPermissionMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  auditLogMock.mockReset();
  auditLogMock.mockResolvedValue(undefined);
  nativeListMock.mockReset();
  huduListMock.mockReset();
  nativeListByIdsMock.mockReset();
  nativeResolveOwnerClientIdMock.mockReset();
  huduResolveByIdsMock.mockReset();
  huduResolveOwnerClientIdMock.mockReset();
  huduCreateMock.mockReset();
  huduUpdateMock.mockReset();
  loadAssociationsForEntityMock.mockReset();
  pruneAssociationRefsMock.mockReset();
  resolveEntityClientIdMock.mockReset();
  nativeCreateMock.mockReset();
  nativeUpdateMock.mockReset();
  loggerErrorMock.mockReset();
  getHuduIntegrationMock.mockReset();
  getHuduCompanyMappingRowsMock.mockReset();
  nativeListMock.mockResolvedValue([]);
  huduListMock.mockResolvedValue([]);
  nativeListByIdsMock.mockResolvedValue([]);
  nativeResolveOwnerClientIdMock.mockResolvedValue(null);
  huduResolveByIdsMock.mockResolvedValue([]);
  huduResolveOwnerClientIdMock.mockResolvedValue(null);
  huduCreateMock.mockResolvedValue({ id: 'hudu:1:1' });
  huduUpdateMock.mockResolvedValue({ id: 'hudu:1:1' });
  loadAssociationsForEntityMock.mockResolvedValue([]);
  pruneAssociationRefsMock.mockResolvedValue(undefined);
  resolveEntityClientIdMock.mockResolvedValue(null);
  getHuduIntegrationMock.mockResolvedValue(null);
  getHuduCompanyMappingRowsMock.mockResolvedValue([]);
});

describe('credentials actions — tier gate', () => {
  it('rejects the action when the tenant tier is below Pro (assertTierAccess throws)', async () => {
    assertTierAccessMock.mockRejectedValue(new TierAccessErrorMock());
    const { listCredentials } = await importActions();

    await expect(listCredentials({})).rejects.toBeInstanceOf(TierAccessErrorMock);
    expect(assertTierAccessMock).toHaveBeenCalledWith('CREDENTIALS');
  });

  it('passes when the Pro tier is granted', async () => {
    const { getCredentialsContext } = await importActions();
    const result = await getCredentialsContext();

    expect(assertTierAccessMock).toHaveBeenCalledWith('CREDENTIALS');
    expect(result.tierOk).toBe(true);
    expect(result.state).toBe('ok');
  });

  it('rejects users without the credential:read permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { listCredentials } = await importActions();

    await expect(listCredentials({})).rejects.toThrow(/Forbidden/);
  });
});

describe('credential save safe-error boundary', () => {
  const secretInput = { destination: 'alga' as const, clientId: 'client-1', name: 'secret-name', password: 'do-not-log', otpSecret: 'GEZDGNBVGY3TQOJQ', username: 'admin', url: '', description: '' };

  it('returns successful create and update results without emitting a failure log', async () => {
    nativeCreateMock.mockResolvedValue({ id: 'credential-1' });
    nativeUpdateMock.mockResolvedValue({ id: 'credential-1' });
    const { createCredential, updateCredential } = await importActions();

    await expect(createCredential(secretInput)).resolves.toEqual({ ok: true, credential: { id: 'credential-1' } });
    await expect(updateCredential('credential-1', { name: 'updated' })).resolves.toEqual({ ok: true, credential: { id: 'credential-1' } });
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it('converts authorization and tier failures before the handler into PERMISSION_DENIED and redacted logs', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { createCredential } = await importActions();
    await expect(createCredential(secretInput)).resolves.toEqual({ ok: false, code: 'PERMISSION_DENIED' });
    expect(loggerErrorMock).toHaveBeenCalledWith('[CredentialActions] credential save failed', expect.objectContaining({ operation: 'create', code: 'PERMISSION_DENIED', tenant: 'tenant-1', userId: 'user-1', clientId: 'client-1' }));
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('do-not-log');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('GEZDGNBVGY3TQOJQ');
  });

  it('converts tier denial before create into PERMISSION_DENIED with the same redacted log shape', async () => {
    assertTierAccessMock.mockRejectedValue(new TierAccessErrorMock());
    const { createCredential } = await importActions();
    await expect(createCredential(secretInput)).resolves.toEqual({ ok: false, code: 'PERMISSION_DENIED' });
    expect(loggerErrorMock).toHaveBeenCalledWith('[CredentialActions] credential save failed', expect.objectContaining({ operation: 'create', code: 'PERMISSION_DENIED', tenant: 'tenant-1', userId: 'user-1' }));
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('do-not-log');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('GEZDGNBVGY3TQOJQ');
  });

  it('logs create and update source failures with safe context only', async () => {
    nativeCreateMock.mockRejectedValue(Object.assign(new Error('client mismatch'), { code: 'CREDENTIAL_CLIENT_MISMATCH' }));
    nativeUpdateMock.mockRejectedValue(new Error('unexpected query payload password=do-not-log'));
    const { createCredential, updateCredential } = await importActions();
    await expect(createCredential(secretInput)).resolves.toEqual({ ok: false, code: 'CLIENT_MISMATCH' });
    await expect(updateCredential('credential-1', { clientId: 'client-1', password: 'do-not-log' })).resolves.toEqual({ ok: false, code: 'UNKNOWN' });
    expect(loggerErrorMock).toHaveBeenCalledWith('[CredentialActions] credential save failed', expect.objectContaining({ operation: 'update', credentialId: 'credential-1', code: 'UNKNOWN' }));
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('do-not-log');
  });

  it('maps validation, configuration, and Hudu upstream failures without serializing raw errors', async () => {
    nativeCreateMock
      .mockRejectedValueOnce(new Error('Invalid base32 TOTP secret character: "SENSITIVE".'))
      .mockRejectedValueOnce(new Error('Credential vault encryption key is not configured.'));
    huduCreateMock.mockRejectedValue(new Error('upstream response body contains token=do-not-log'));
    const { createCredential } = await importActions();

    await expect(createCredential(secretInput)).resolves.toEqual({ ok: false, code: 'VALIDATION' });
    await expect(createCredential(secretInput)).resolves.toEqual({ ok: false, code: 'CONFIGURATION' });
    await expect(createCredential({ ...secretInput, destination: 'hudu' })).resolves.toEqual({ ok: false, code: 'HUDU_API' });
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('SENSITIVE');
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain('do-not-log');
  });
});

describe('getCredentialsContext — non-throwing probe', () => {
  it("resolves { tierOk: false, state: 'tier' } below Pro instead of throwing", async () => {
    assertTierAccessMock.mockRejectedValue(new TierAccessErrorMock());
    const { getCredentialsContext } = await importActions();

    const result = await getCredentialsContext();

    expect(result).toMatchObject({ tierOk: false, state: 'tier', huduConnected: false });
  });

  it("resolves { tierOk: false, state: 'forbidden' } without credential:read", async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { getCredentialsContext } = await importActions();

    const result = await getCredentialsContext();

    expect(result).toMatchObject({ tierOk: false, state: 'forbidden' });
    expect(assertTierAccessMock).not.toHaveBeenCalled();
  });

  it("resolves { tierOk: false, state: 'unavailable' } when the probe itself fails", async () => {
    getHuduIntegrationMock.mockRejectedValue(new Error('db down'));
    const { getCredentialsContext } = await importActions();

    const result = await getCredentialsContext();

    expect(result).toMatchObject({ tierOk: false, state: 'unavailable' });
  });

  it('does not mistake a non-tier failure from assertTierAccess for a tier denial', async () => {
    assertTierAccessMock.mockRejectedValue(new Error('session backend down'));
    const { getCredentialsContext } = await importActions();

    const result = await getCredentialsContext();

    expect(result).toMatchObject({ tierOk: false, state: 'unavailable' });
  });
});

describe('fail-closed reveal audit (writeCredentialAudit)', () => {
  it('propagates an audit-insert failure so the caller never gets a value', async () => {
    const { writeCredentialAudit } = await import('@ee/lib/credentials/audit');

    // The transaction runner is the audit module's own knex wrapper; simulate a
    // failed insert inside the audit sink by making the underlying auditLog throw.
    auditLogMock.mockRejectedValue(new Error('audit insert failed'));

    await expect(
      writeCredentialAudit(
        { transaction: async (cb: (trx: unknown) => Promise<void>) => {
          await cb({ raw: async () => undefined });
        } } as never,
        'tenant-1',
        'credential_reveal',
        { userId: 'user-1', credentialId: 'cred-1', clientId: 'client-1' }
      )
    ).rejects.toThrow('audit insert failed');
  });
});

describe('credentials actions — tenant-wide aggregation', () => {
  it('aggregates native + every mapped client Hudu rows for a tenant-wide list', async () => {
    nativeListMock.mockResolvedValue([{ id: 'native-1', source: 'alga', clientId: 'c1' }]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });
    getHuduCompanyMappingRowsMock.mockResolvedValue([
      { alga_entity_id: 'c1', client_name: 'Acme' },
      { alga_entity_id: 'c2', client_name: 'Globex' },
    ]);
    huduListMock.mockImplementation(async (_ctx: unknown, filter: { clientId: string }) =>
      filter.clientId === 'c1'
        ? [{ id: 'hudu:101:1', source: 'hudu', clientId: 'c1' }]
        : [{ id: 'hudu:102:2', source: 'hudu', clientId: 'c2' }]
    );

    const { listCredentials } = await importActions();
    const rows = await listCredentials({});

    // Both sources, across all mapped clients.
    const ids = rows.map((row: { id: string }) => row.id).sort();
    expect(ids).toEqual(['hudu:101:1', 'hudu:102:2', 'native-1']);
    expect(getHuduCompanyMappingRowsMock).toHaveBeenCalledTimes(1);
    expect(huduListMock).toHaveBeenCalledTimes(2);
  });

  it('returns native-only rows when Hudu is not connected (no mapping traffic)', async () => {
    nativeListMock.mockResolvedValue([{ id: 'native-1', source: 'alga', clientId: 'c1' }]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: false });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({});

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['native-1']);
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
    expect(huduListMock).not.toHaveBeenCalled();
  });

  it('merges native + Hudu for a client-scoped list (client tab)', async () => {
    nativeListMock.mockResolvedValue([{ id: 'native-1', source: 'alga', clientId: 'c1' }]);
    huduListMock.mockResolvedValue([{ id: 'hudu:101:1', source: 'hudu', clientId: 'c1' }]);

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ clientId: 'c1' });

    const ids = rows.map((row: { id: string }) => row.id).sort();
    expect(ids).toEqual(['hudu:101:1', 'native-1']);
    // Client-scoped list does not enumerate mappings.
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
  });
});

describe('credentials actions — entity-scoped lists are association-driven (both sources)', () => {
  const nativeRow = (id: string) => ({ id, source: 'alga', clientId: 'c1', attachments: [] });
  const huduRow = (id: string) => ({ id, source: 'hudu', clientId: 'c1', attachments: [] });

  it('merges native ids and LIVE Hudu refs from the association rows (asset section)', async () => {
    loadAssociationsForEntityMock.mockResolvedValue([
      { credential_id: 'native-1', credential_ref: null, entity_id: 'asset-1', entity_type: 'asset' },
      { credential_id: null, credential_ref: 'hudu:101:1', entity_id: 'asset-1', entity_type: 'asset' },
    ]);
    nativeListByIdsMock.mockResolvedValue([nativeRow('native-1')]);
    huduResolveByIdsMock.mockResolvedValue([{ ref: 'hudu:101:1', summary: huduRow('hudu:101:1'), prune: false }]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ entityType: 'asset', entityId: 'asset-1' });

    const ids = rows.map((row: { id: string }) => row.id).sort();
    expect(ids).toEqual(['hudu:101:1', 'native-1']);
    // Native short-circuit is GONE: the association rows drive both sources,
    // and no tenant-wide Hudu mapping fan-out happens.
    expect(loadAssociationsForEntityMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'asset', 'asset-1');
    expect(nativeListByIdsMock).toHaveBeenCalledWith(expect.anything(), ['native-1']);
    expect(huduResolveByIdsMock).toHaveBeenCalledWith(expect.anything(), ['hudu:101:1']);
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
    expect(pruneAssociationRefsMock).not.toHaveBeenCalled();
  });

  it('omits a ref Hudu CONFIRMED gone (404) and lazily prunes its association row', async () => {
    loadAssociationsForEntityMock.mockResolvedValue([
      { credential_id: 'native-1', credential_ref: null, entity_id: 'asset-1', entity_type: 'asset' },
      { credential_id: null, credential_ref: 'hudu:404:9', entity_id: 'asset-1', entity_type: 'asset' },
    ]);
    nativeListByIdsMock.mockResolvedValue([nativeRow('native-1')]);
    huduResolveByIdsMock.mockResolvedValue([{ ref: 'hudu:404:9', summary: null, prune: true }]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ entityType: 'asset', entityId: 'asset-1' });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['native-1']);
    expect(pruneAssociationRefsMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'asset', 'asset-1', ['hudu:404:9']);
  });

  it('omits a ref on TRANSPORT error but NEVER prunes its association row', async () => {
    loadAssociationsForEntityMock.mockResolvedValue([
      { credential_id: null, credential_ref: 'hudu:101:1', entity_id: 'asset-1', entity_type: 'asset' },
    ]);
    huduResolveByIdsMock.mockResolvedValue([{ ref: 'hudu:101:1', summary: null, prune: false }]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ entityType: 'asset', entityId: 'asset-1' });

    expect(rows).toEqual([]);
    expect(pruneAssociationRefsMock).not.toHaveBeenCalled();
  });

  it('omits Hudu refs without resolving when Hudu is not connected (never prunes)', async () => {
    loadAssociationsForEntityMock.mockResolvedValue([
      { credential_id: null, credential_ref: 'hudu:101:1', entity_id: 'asset-1', entity_type: 'asset' },
    ]);
    nativeListByIdsMock.mockResolvedValue([nativeRow('native-1')]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: false });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ entityType: 'asset', entityId: 'asset-1' });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['native-1']);
    expect(huduResolveByIdsMock).not.toHaveBeenCalled();
    expect(pruneAssociationRefsMock).not.toHaveBeenCalled();
  });

  it("['alga'] on an entity list omits Hudu refs for that response and never resolves/prunes them", async () => {
    loadAssociationsForEntityMock.mockResolvedValue([
      { credential_id: 'native-1', credential_ref: null, entity_id: 'asset-1', entity_type: 'asset' },
      { credential_id: null, credential_ref: 'hudu:101:1', entity_id: 'asset-1', entity_type: 'asset' },
    ]);
    nativeListByIdsMock.mockResolvedValue([nativeRow('native-1')]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ entityType: 'asset', entityId: 'asset-1', sources: ['alga'] });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['native-1']);
    expect(huduResolveByIdsMock).not.toHaveBeenCalled();
    expect(pruneAssociationRefsMock).not.toHaveBeenCalled();
  });

  it("['hudu'] on an entity list returns resolved refs only and never calls the native source", async () => {
    loadAssociationsForEntityMock.mockResolvedValue([
      { credential_id: 'native-1', credential_ref: null, entity_id: 'asset-1', entity_type: 'asset' },
      { credential_id: null, credential_ref: 'hudu:101:1', entity_id: 'asset-1', entity_type: 'asset' },
    ]);
    nativeListByIdsMock.mockResolvedValue([nativeRow('native-1')]);
    huduResolveByIdsMock.mockResolvedValue([{ ref: 'hudu:101:1', summary: huduRow('hudu:101:1'), prune: false }]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ entityType: 'asset', entityId: 'asset-1', sources: ['hudu'] });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['hudu:101:1']);
    expect(nativeListByIdsMock).not.toHaveBeenCalled();
  });
});

describe('credentials actions — sources selection is authoritative', () => {
  const nativeRow = (id: string) => ({ id, source: 'alga', clientId: 'c1' });
  const huduRow = (id: string, clientId = 'c1') => ({ id, source: 'hudu', clientId });

  function stubActiveHuduWithMappings() {
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });
    getHuduCompanyMappingRowsMock.mockResolvedValue([
      { alga_entity_id: 'c1', client_name: 'Acme' },
      { alga_entity_id: 'c2', client_name: 'Globex' },
    ]);
    huduListMock.mockImplementation(async (_ctx: unknown, filter: { clientId: string }) =>
      filter.clientId === 'c1'
        ? [huduRow('hudu:101:1', 'c1')]
        : [huduRow('hudu:102:2', 'c2')]
    );
  }

  it("['alga'] tenant-wide never touches Hudu even when it is active+mapped, and returns native only", async () => {
    nativeListMock.mockResolvedValue([nativeRow('native-1')]);
    stubActiveHuduWithMappings();

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ sources: ['alga'] });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['native-1']);
    expect(nativeListMock).toHaveBeenCalledTimes(1);
    expect(huduListMock).not.toHaveBeenCalled();
    expect(getHuduIntegrationMock).not.toHaveBeenCalled();
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
  });

  it("['hudu'] tenant-wide never calls the native source and returns Hudu rows only", async () => {
    nativeListMock.mockResolvedValue([nativeRow('native-1')]);
    stubActiveHuduWithMappings();

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ sources: ['hudu'] });

    expect(rows.map((row: { id: string }) => row.id).sort()).toEqual(['hudu:101:1', 'hudu:102:2']);
    expect(nativeListMock).not.toHaveBeenCalled();
    expect(huduListMock).toHaveBeenCalledTimes(2);
    expect(getHuduIntegrationMock).toHaveBeenCalledTimes(1);
    expect(getHuduCompanyMappingRowsMock).toHaveBeenCalledTimes(1);
  });

  it("['hudu'] tenant-wide returns an empty list when Hudu is inactive, without calling the native source", async () => {
    nativeListMock.mockResolvedValue([nativeRow('native-1')]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: false });

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ sources: ['hudu'] });

    expect(rows).toEqual([]);
    expect(nativeListMock).not.toHaveBeenCalled();
    expect(huduListMock).not.toHaveBeenCalled();
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
  });

  it("['alga'] client-scoped list returns native only and never calls Hudu", async () => {
    nativeListMock.mockResolvedValue([nativeRow('native-1')]);
    huduListMock.mockResolvedValue([huduRow('hudu:101:1')]);

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ clientId: 'c1', sources: ['alga'] });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['native-1']);
    expect(nativeListMock).toHaveBeenCalledTimes(1);
    expect(huduListMock).not.toHaveBeenCalled();
  });

  it("['hudu'] client-scoped list returns Hudu only and never calls the native source", async () => {
    nativeListMock.mockResolvedValue([nativeRow('native-1')]);
    huduListMock.mockResolvedValue([huduRow('hudu:101:1')]);

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ clientId: 'c1', sources: ['hudu'] });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['hudu:101:1']);
    expect(nativeListMock).not.toHaveBeenCalled();
    expect(huduListMock).toHaveBeenCalledTimes(1);
  });

  it("['alga','hudu'] client-scoped list invokes and merges both sources", async () => {
    nativeListMock.mockResolvedValue([nativeRow('native-1')]);
    huduListMock.mockResolvedValue([huduRow('hudu:101:1')]);

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ clientId: 'c1', sources: ['alga', 'hudu'] });

    expect(rows.map((row: { id: string }) => row.id).sort()).toEqual(['hudu:101:1', 'native-1']);
    expect(nativeListMock).toHaveBeenCalledTimes(1);
    expect(huduListMock).toHaveBeenCalledTimes(1);
  });

  it('omitted or empty sources mean "all": both backends are invoked', async () => {
    nativeListMock.mockResolvedValue([nativeRow('native-1')]);
    stubActiveHuduWithMappings();

    const { listCredentials } = await importActions();
    const omittedRows = await listCredentials({});
    const emptyRows = await listCredentials({ sources: [] });

    expect(omittedRows.map((row: { id: string }) => row.id).sort()).toEqual([
      'hudu:101:1',
      'hudu:102:2',
      'native-1',
    ]);
    expect(emptyRows.map((row: { id: string }) => row.id).sort()).toEqual([
      'hudu:101:1',
      'hudu:102:2',
      'native-1',
    ]);
    expect(nativeListMock).toHaveBeenCalledTimes(2);
    expect(huduListMock).toHaveBeenCalledTimes(4);
    expect(getHuduCompanyMappingRowsMock).toHaveBeenCalledTimes(2);
  });

  it('entity-scoped lists never trigger the tenant-wide Hudu mapping fan-out', async () => {
    // An entity-scoped list is association-driven; the aggregation must not
    // fall through to the per-mapped-client Hudu fan-out even when Hudu is
    // connected+mapped (the pre-expansion short-circuit's original hazard).
    loadAssociationsForEntityMock.mockResolvedValue([]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });
    getHuduCompanyMappingRowsMock.mockResolvedValue([
      { alga_entity_id: 'c1', client_name: 'Acme' },
      { alga_entity_id: 'c2', client_name: 'Globex' },
    ]);
    huduListMock.mockResolvedValue([{ id: 'hudu:101:1', source: 'hudu', clientId: 'c1' }]);

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ entityType: 'asset', entityId: 'asset-1' });

    expect(rows).toEqual([]);
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
    expect(huduListMock).not.toHaveBeenCalled();
  });
});

describe('credentials actions — entity association CRUD is gated and delegates', () => {
  it('rejects addCredentialToEntity below Pro (assertTierAccess throws)', async () => {
    assertTierAccessMock.mockRejectedValue(new TierAccessErrorMock());
    const { addCredentialToEntity } = await importActions();

    await expect(addCredentialToEntity('ticket', 'ticket-1', 'cred-1')).rejects.toBeInstanceOf(
      TierAccessErrorMock
    );
  });

  it('rejects removeCredentialFromEntity without credential:update permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { removeCredentialFromEntity } = await importActions();

    await expect(
      removeCredentialFromEntity('contact', 'contact-1', 'cred-1')
    ).rejects.toThrow(/Forbidden/);
  });

  it('delegates setEntityCredentials to the association service after gating', async () => {
    const { setEntityCredentials } = await importActions();

    await setEntityCredentials('ticket', 'ticket-1', ['cred-1', 'cred-2']);

    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'credential', 'update');
  });
});
