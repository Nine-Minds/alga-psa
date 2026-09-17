/**
 * Hudu asset action unit tests. Persistence behavior runs separately in
 * huduAssetMappingActions.db.test.ts against the migrated, isolated workspace database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HUDU_MAPPING_TABLE } from '../../lib/integrations/hudu/contracts';
import { setCachedHuduList, clearHuduReferenceCache } from '../../lib/integrations/hudu/referenceData';

const TENANT = 'tenant-hudu-assets-1';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const ASSET_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ASSET_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const HUDU_COMPANY_ID = '55';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const assertTierAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
let assetsRows: Array<{ asset_id: string; asset_name: string; serial_number: string | null }> = [];
const knexCallableMock = vi.fn((_table: string) => {
  const qb: Record<string, unknown> = {};
  qb.where = vi.fn(() => qb);
  qb.select = vi.fn(async () => assetsRows);
  return qb;
});

const getHuduCompanyAssetsMock = vi.fn();
const resolveHuduCompanyIdForClientMock = vi.fn();

const getHuduAssetMappingRowsMock = vi.fn();
const setHuduAssetMappingRowMock = vi.fn();
const clearHuduAssetMappingRowMock = vi.fn();
const getHuduAssetLayoutTypeMapMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@ee/lib/actions/integrations/huduDataActions', () => ({
  getHuduCompanyAssets: getHuduCompanyAssetsMock,
}));

// Keep the REAL constants/shapes; fake only the resolver the actions consume.
vi.mock('@ee/lib/integrations/hudu/companyMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveHuduCompanyIdForClient: resolveHuduCompanyIdForClientMock,
}));

// Keep the REAL module (the DB block reaches it via importActual); fake only
// the knex-level row access for the action layer.
vi.mock('@ee/lib/integrations/hudu/assetMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduAssetMappingRows: getHuduAssetMappingRowsMock,
  setHuduAssetMappingRow: setHuduAssetMappingRowMock,
  clearHuduAssetMappingRow: clearHuduAssetMappingRowMock,
}));

// Keep isLayoutExcluded REAL; fake only the settings read (F259).
vi.mock('@ee/lib/integrations/hudu/assetLayoutMap', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduAssetLayoutTypeMap: getHuduAssetLayoutTypeMapMock,
}));

async function importActions() {
  return import('@ee/lib/actions/integrations/huduAssetMappingActions');
}

function huduItems() {
  return [
    {
      id: 1,
      company_id: 55,
      name: 'EC-WS-001',
      asset_type: 'Computer Assets',
      asset_layout_id: 7,
      primary_serial: 'SN-EC-1001',
      url: '/a/1',
      archived: false,
      hudu_url: 'https://hudu.example.com/a/1',
    },
    {
      id: 2,
      company_id: 55,
      name: 'EC-SRV-01',
      asset_type: 'Computer Assets',
      asset_layout_id: 7,
      primary_serial: null,
      url: '/a/2',
      archived: false,
      hudu_url: 'https://hudu.example.com/a/2',
    },
    { id: 3, company_id: 55, name: 'Printer Closet B', archived: true, hudu_url: null },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  clearHuduReferenceCache();
  assetsRows = [];

  hasPermissionMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduCompanyAssetsMock.mockResolvedValue({
    state: 'ok',
    items: huduItems(),
    count: 3,
    huduCompanyId: HUDU_COMPANY_ID,
    companyUrl: 'https://hudu.example.com/c/55',
    fetchedAt: '2026-06-11T10:00:00.000Z',
    fromCache: true,
  });
  resolveHuduCompanyIdForClientMock.mockResolvedValue(HUDU_COMPANY_ID);
  getHuduAssetMappingRowsMock.mockResolvedValue([]);
  setHuduAssetMappingRowMock.mockResolvedValue({ ok: true, mapping: { id: 'am-9' } });
  clearHuduAssetMappingRowMock.mockResolvedValue(1);
  getHuduAssetLayoutTypeMapMock.mockResolvedValue({});
});

// ============================================================================
// T214/T215 persistence lives in huduAssetMappingActions.db.test.ts.
// ============================================================================

describe('T216: getHuduAssetMappings', () => {
  it('composes Hudu assets + mapping rows + suggestions into the view model', async () => {
    getHuduAssetMappingRowsMock.mockResolvedValue([
      {
        id: 'am-1',
        tenant: TENANT,
        integration_type: 'hudu',
        alga_entity_type: 'asset',
        alga_entity_id: ASSET_1,
        external_entity_id: '1',
        external_realm_id: HUDU_COMPANY_ID,
        metadata: { stale: true },
        asset_name: 'Mapped Asset',
      },
    ]);
    assetsRows = [
      { asset_id: ASSET_1, asset_name: 'Mapped Asset', serial_number: 'SN-EC-1001' },
      { asset_id: ASSET_2, asset_name: 'EC-SRV-1', serial_number: null },
    ];
    const { getHuduAssetMappings } = await importActions();

    const result = await getHuduAssetMappings(CLIENT_1);

    expect(getHuduCompanyAssetsMock).toHaveBeenCalledWith(CLIENT_1, undefined);
    expect(getHuduAssetMappingRowsMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      huduCompanyId: HUDU_COMPANY_ID,
    });

    expect(result).toEqual({
      state: 'ok',
      huduCompanyId: HUDU_COMPANY_ID,
      fetchedAt: '2026-06-11T10:00:00.000Z',
      fromCache: true,
      assets: [
        {
          hudu_asset_id: 1,
          hudu_asset_name: 'EC-WS-001',
          asset_layout_id: 7,
          asset_layout_name: 'Computer Assets',
          primary_serial: 'SN-EC-1001',
          url: 'https://hudu.example.com/a/1',
          archived: false,
          layout_excluded: false,
          mapping: { mapping_id: 'am-1', asset_id: ASSET_1, asset_name: 'Mapped Asset', stale: true },
          suggestion: null,
        },
        {
          hudu_asset_id: 2,
          hudu_asset_name: 'EC-SRV-01',
          asset_layout_id: 7,
          asset_layout_name: 'Computer Assets',
          primary_serial: null,
          url: 'https://hudu.example.com/a/2',
          archived: false,
          layout_excluded: false,
          mapping: null,
          // Near-name fuzzy match against the unmapped Alga asset.
          suggestion: { asset_id: ASSET_2, asset_name: 'EC-SRV-1', source: 'fuzzy_name', confidence: 0.8889 },
        },
        {
          hudu_asset_id: 3,
          hudu_asset_name: 'Printer Closet B',
          asset_layout_id: null,
          asset_layout_name: null,
          primary_serial: null,
          url: null,
          archived: true,
          layout_excluded: false,
          mapping: null,
          suggestion: null,
        },
      ],
    });
  });

  it("T261/F259: rows whose layout is marked 'excluded' carry layout_excluded (layout-less rows do not)", async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'excluded' });
    const { getHuduAssetMappings } = await importActions();

    const result = await getHuduAssetMappings(CLIENT_1);

    if (result.state !== 'ok') throw new Error(`expected ok state, got ${result.state}`);
    expect(result.assets.map((a) => [a.hudu_asset_id, a.layout_excluded])).toEqual([
      [1, true],
      [2, true],
      [3, false], // no asset_layout_id → never excluded
    ]);
  });

  it('short-circuits to the typed unmapped state without touching the DB', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue({ state: 'unmapped' });
    const { getHuduAssetMappings } = await importActions();

    expect(await getHuduAssetMappings(CLIENT_1)).toEqual({ state: 'unmapped' });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('forwards fetch errors (incl. errorKind) from the Phase 1 data action', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
    const { getHuduAssetMappings } = await importActions();

    expect(await getHuduAssetMappings(CLIENT_1)).toEqual({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
  });

  it('is gated on asset read (not system_settings)', async () => {
    const { getHuduAssetMappings } = await importActions();

    await getHuduAssetMappings(CLIENT_1);

    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'asset', 'read');
  });
});

// ============================================================================
// T217 + envelopes — setHuduAssetMapping / clearHuduAssetMapping
// ============================================================================

describe('F213 action wrappers: setHuduAssetMapping / clearHuduAssetMapping', () => {
  it('resolves the client mapped company for the row write and passes metadata through', async () => {
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({
      clientId: CLIENT_1,
      assetId: ASSET_1,
      huduAssetId: 1,
      metadata: { hudu_asset_name: 'EC-WS-001', asset_layout_id: 7, primary_serial: 'SN-EC-1001' },
    });

    expect(result).toEqual({ success: true, data: { mapping_id: 'am-9' } });
    expect(resolveHuduCompanyIdForClientMock).toHaveBeenCalledWith(knexCallableMock, TENANT, CLIENT_1);
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      assetId: ASSET_1,
      huduAssetId: 1,
      huduCompanyId: HUDU_COMPANY_ID,
      metadata: { hudu_asset_name: 'EC-WS-001', asset_layout_id: 7, primary_serial: 'SN-EC-1001' },
    });
  });

  it('enriches missing metadata from the Phase 1 assets cache before writing', async () => {
    setCachedHuduList(TENANT, HUDU_COMPANY_ID, 'assets', huduItems().map(({ hudu_url, ...item }) => item));
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_1, huduAssetId: 1 });

    expect(result).toEqual({ success: true, data: { mapping_id: 'am-9' } });
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      assetId: ASSET_1,
      huduAssetId: 1,
      huduCompanyId: HUDU_COMPANY_ID,
      metadata: {
        hudu_asset_name: 'EC-WS-001',
        asset_layout_id: 7,
        asset_layout_name: 'Computer Assets',
        primary_serial: 'SN-EC-1001',
        url: '/a/1',
      },
    });
  });

  it('fails (typed envelope) when the client has no mapped Hudu company', async () => {
    resolveHuduCompanyIdForClientMock.mockResolvedValue(null);
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_1, huduAssetId: 1 });

    expect(result).toEqual({ success: false, error: 'Client is not mapped to a Hudu company.' });
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });

  it('surfaces the typed one-to-one rejection from the row layer', async () => {
    setHuduAssetMappingRowMock.mockResolvedValue({
      ok: false,
      code: 'hudu_asset_already_mapped',
      message: 'Hudu asset 1 is already mapped to another asset. Clear that mapping first.',
    });
    const { setHuduAssetMapping } = await importActions();

    const result = await setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_2, huduAssetId: 1 });

    expect(result).toEqual({
      success: false,
      code: 'hudu_asset_already_mapped',
      error: 'Hudu asset 1 is already mapped to another asset. Clear that mapping first.',
    });
  });

  it('clearHuduAssetMapping clears by mapping id and reports not_found when nothing was cleared', async () => {
    const { clearHuduAssetMapping } = await importActions();

    expect(await clearHuduAssetMapping({ mappingId: 'am-1' })).toEqual({ success: true, data: { cleared: 1 } });
    expect(clearHuduAssetMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, { mappingId: 'am-1' });

    clearHuduAssetMappingRowMock.mockResolvedValue(0);
    expect(await clearHuduAssetMapping({ huduAssetId: 999 })).toEqual({
      success: false,
      error: 'Mapping not found.',
      code: 'not_found',
    });
  });

  it('T217: set/clear require asset update and reject without it (403 semantics)', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { setHuduAssetMapping, clearHuduAssetMapping } = await importActions();

    await expect(setHuduAssetMapping({ clientId: CLIENT_1, assetId: ASSET_1, huduAssetId: 1 })).rejects.toThrow(
      /insufficient permissions \(update\)/
    );
    await expect(clearHuduAssetMapping({ mappingId: 'am-1' })).rejects.toThrow(/insufficient permissions \(update\)/);
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'asset', 'update');
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
    expect(clearHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });
});
