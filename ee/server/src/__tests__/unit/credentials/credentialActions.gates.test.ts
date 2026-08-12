/**
 * Tier gate + fail-closed reveal audit contracts for the credentials vault:
 *  - server actions reject below Pro via assertTierAccess(TIER_FEATURES.CREDENTIALS)
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
  huduListMock,
  getHuduIntegrationMock,
  getHuduCompanyMappingRowsMock,
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
    huduListMock: vi.fn(async () => []),
    getHuduIntegrationMock: vi.fn(async () => null),
    getHuduCompanyMappingRowsMock: vi.fn(async () => []),
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
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
  nativeCredentialSource: { list: nativeListMock },
}));

vi.mock('@ee/lib/credentials/huduSource', () => ({
  huduCredentialSource: { list: huduListMock },
  isHuduCredentialId: (id: string) => id.startsWith('hudu:'),
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
  getHuduIntegrationMock.mockReset();
  getHuduCompanyMappingRowsMock.mockReset();
  nativeListMock.mockResolvedValue([]);
  huduListMock.mockResolvedValue([]);
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

  it('keeps an assetId-scoped list native-only even when Hudu is connected+mapped', async () => {
    // Asset credentials section calls listCredentials({ assetId }) with no
    // clientId; this must NOT fan out to mapped Hudu companies (v1 Hudu rows
    // have no asset-attachment linkage), so only the native rows come back.
    nativeListMock.mockResolvedValue([
      { id: 'asset-native-1', source: 'alga', clientId: 'c1', attachedAssetIds: ['asset-1'] },
    ]);
    getHuduIntegrationMock.mockResolvedValue({ is_active: true });
    getHuduCompanyMappingRowsMock.mockResolvedValue([
      { alga_entity_id: 'c1', client_name: 'Acme' },
      { alga_entity_id: 'c2', client_name: 'Globex' },
    ]);
    huduListMock.mockResolvedValue([{ id: 'hudu:101:1', source: 'hudu', clientId: 'c1' }]);

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ assetId: 'asset-1' });

    const ids = rows.map((row: { id: string }) => row.id).sort();
    expect(ids).toEqual(['asset-native-1']);
    // No Hudu mapping enumeration or per-client Hudu traffic for an
    // asset-scoped list.
    expect(getHuduIntegrationMock).not.toHaveBeenCalled();
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
    expect(huduListMock).not.toHaveBeenCalled();
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

  it('assetId precedence: a hudu-only selection still returns native and never calls Hudu', async () => {
    // The asset-scoped native-only short-circuit wins over `sources` — Hudu
    // must never be called with an assetId filter, and the native rows are
    // returned even when the caller selects hudu-only.
    nativeListMock.mockResolvedValue([
      { id: 'asset-native-1', source: 'alga', clientId: 'c1', attachedAssetIds: ['asset-1'] },
    ]);
    stubActiveHuduWithMappings();

    const { listCredentials } = await importActions();
    const rows = await listCredentials({ assetId: 'asset-1', sources: ['hudu'] });

    expect(rows.map((row: { id: string }) => row.id)).toEqual(['asset-native-1']);
    expect(nativeListMock).toHaveBeenCalledTimes(1);
    expect(huduListMock).not.toHaveBeenCalled();
    expect(getHuduIntegrationMock).not.toHaveBeenCalled();
    expect(getHuduCompanyMappingRowsMock).not.toHaveBeenCalled();
  });
});
