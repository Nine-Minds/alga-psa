/**
 * T218–T223 — Hudu asset import actions (single + bulk).
 * T251/T252 — HuduAsset contract fields[] + the attributes namespace write.
 *
 * Unit-mocked like huduAssetMappingActions.test.ts: auth, flag, tiers, knex,
 * the Phase 1 fetch (huduDataActions), createAsset/deleteAsset and the
 * mapping-row writes are fakes; the matcher (assetMatching), the layout-type
 * resolver and the import/attributes helpers (assetImport, assetAttributes)
 * stay REAL.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveHuduAssetTag, huduImportAssetStatus } from '../../lib/integrations/hudu/assetImport';
import { buildHuduFieldsAttribute } from '../../lib/integrations/hudu/assetAttributes';
import type { HuduAsset } from '../../lib/integrations/hudu/contracts';

const TENANT = 'tenant-hudu-import-1';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const HUDU_COMPANY_ID = '55';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();
const assertAddOnAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
let assetsRows: Array<{ asset_id: string; asset_name: string; serial_number: string | null }> = [];
let takenAssetTags: string[] = [];
let attributeUpdates: Array<{
  table: string;
  where: Record<string, unknown> | undefined;
  payload: Record<string, any>;
}> = [];
let attributesUpdateError: Error | null = null;
const knexCallableMock = vi.fn((_table: string) => {
  let whereArg: Record<string, unknown> | undefined;
  const qb: Record<string, any> = {};
  qb.where = vi.fn((arg: Record<string, unknown>) => {
    whereArg = arg;
    return qb;
  });
  qb.select = vi.fn(async () => assetsRows);
  // deriveHuduAssetTag's collision pre-check: where({ tenant, asset_tag }).first(...)
  qb.first = vi.fn(async () =>
    typeof whereArg?.asset_tag === 'string' && takenAssetTags.includes(whereArg.asset_tag as string)
      ? { asset_id: 'asset-owning-tag' }
      : undefined
  );
  // writeHuduAssetAttributes: where({ tenant, asset_id }).update({ attributes: raw })
  qb.update = vi.fn(async (payload: Record<string, any>) => {
    if (attributesUpdateError) {
      throw attributesUpdateError;
    }
    attributeUpdates.push({ table: _table, where: whereArg, payload });
    return 1;
  });
  return qb;
});
(knexCallableMock as any).raw = vi.fn((sql: string, bindings?: unknown) => ({ sql, bindings }));

const getHuduCompanyAssetsMock = vi.fn();
const createAssetMock = vi.fn();
const deleteAssetMock = vi.fn();
const getHuduAssetMappingRowsMock = vi.fn();
const setHuduAssetMappingRowMock = vi.fn();
const resolveAlgaAssetIdForHuduAssetMock = vi.fn();
const getHuduAssetLayoutTypeMapMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      handler(internalUser, { tenant: TENANT }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/feature-flags/featureFlags', () => ({
  featureFlags: { isEnabled: isEnabledMock },
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
}));

vi.mock('server/src/lib/tier-gating/assertAddOnAccess', () => ({
  assertAddOnAccess: assertAddOnAccessMock,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@ee/lib/actions/integrations/huduDataActions', () => ({
  getHuduCompanyAssets: getHuduCompanyAssetsMock,
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  createAsset: createAssetMock,
  deleteAsset: deleteAssetMock,
}));

vi.mock('@ee/lib/integrations/hudu/assetMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduAssetMappingRows: getHuduAssetMappingRowsMock,
  setHuduAssetMappingRow: setHuduAssetMappingRowMock,
  resolveAlgaAssetIdForHuduAsset: resolveAlgaAssetIdForHuduAssetMock,
}));

// Keep resolveAssetTypeForLayout REAL; fake only the settings read.
vi.mock('@ee/lib/integrations/hudu/assetLayoutMap', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduAssetLayoutTypeMap: getHuduAssetLayoutTypeMapMock,
}));

async function importActions() {
  return import('@ee/lib/actions/integrations/huduAssetImportActions');
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
      // Deliberately out of position order — import must sort.
      fields: [
        { id: 13, label: 'Notes', value: 'Dock on desk', position: 3 },
        { id: 11, label: 'Hostname', value: 'EC-WS-001', position: 1 },
        { id: 12, label: 'Warranty Expiry', value: '2027-01-31', position: 2 },
      ],
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
    {
      id: 3,
      company_id: 55,
      name: 'Printer Closet B',
      asset_type: 'Printers',
      asset_layout_id: 12,
      primary_serial: '   ',
      url: null,
      archived: false,
      hudu_url: null,
    },
  ];
}

function okAssetsResult() {
  return {
    state: 'ok',
    items: huduItems(),
    count: 3,
    huduCompanyId: HUDU_COMPANY_ID,
    companyUrl: 'https://hudu.example.com/c/55',
    fetchedAt: '2026-06-11T10:00:00.000Z',
    fromCache: true,
  };
}

const RATE_LIMITED = {
  state: 'error',
  error: 'Hudu rate limit exceeded (429).',
  errorKind: 'rate_limited',
};

beforeEach(() => {
  vi.clearAllMocks();
  assetsRows = [];
  takenAssetTags = [];
  attributeUpdates = [];
  attributesUpdateError = null;

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  assertAddOnAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduCompanyAssetsMock.mockResolvedValue(okAssetsResult());
  createAssetMock.mockImplementation(async (data: { name: string }) => ({
    asset_id: `created-${data.name}`,
    ...data,
  }));
  deleteAssetMock.mockResolvedValue({ success: true, deleted: true });
  getHuduAssetMappingRowsMock.mockResolvedValue([]);
  setHuduAssetMappingRowMock.mockImplementation(async (_knex, _tenant, input: { huduAssetId: number }) => ({
    ok: true,
    mapping: { id: `map-${input.huduAssetId}` },
  }));
  resolveAlgaAssetIdForHuduAssetMock.mockResolvedValue(null);
  getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'workstation' });
});

// ============================================================================
// T218 — single import creates the asset AND the mapping row
// ============================================================================

describe('T218: importHuduAsset', () => {
  it('creates the Alga asset (mapped type/serial/name/client) and the mapping row with the company realm', async () => {
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(createAssetMock).toHaveBeenCalledTimes(1);
    expect(createAssetMock).toHaveBeenCalledWith({
      asset_type: 'workstation',
      client_id: CLIENT_1,
      asset_tag: 'SN-EC-1001',
      name: 'EC-WS-001',
      status: huduImportAssetStatus(),
      serial_number: 'SN-EC-1001',
    });
    // huduCompanyId becomes the row's external_realm_id (= String(hudu company id)).
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledTimes(1);
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      assetId: 'created-EC-WS-001',
      huduAssetId: 1,
      huduCompanyId: HUDU_COMPANY_ID,
      metadata: {
        hudu_asset_name: 'EC-WS-001',
        asset_layout_id: 7,
        asset_layout_name: 'Computer Assets',
        primary_serial: 'SN-EC-1001',
        url: 'https://hudu.example.com/a/1',
      },
    });
    expect(result).toEqual({
      success: true,
      data: {
        asset_id: 'created-EC-WS-001',
        mapping_id: 'map-1',
        asset_tag: 'SN-EC-1001',
        asset_type: 'workstation',
        status: huduImportAssetStatus(),
      },
    });
  });

  it('imports unconfigured layouts as unknown and omits the serial when Hudu has none', async () => {
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 3 });

    expect(createAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ asset_type: 'unknown', name: 'Printer Closet B' })
    );
    expect(result).toMatchObject({ success: true, data: { asset_type: 'unknown' } });

    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 2 });
    expect(createAssetMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'EC-SRV-01', serial_number: undefined })
    );
  });

  it('fails typed without creating anything: unknown Hudu asset, unmapped client, already-mapped Hudu asset', async () => {
    const { importHuduAsset } = await importActions();

    expect(await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 999 })).toMatchObject({
      success: false,
      code: 'hudu_asset_not_found',
    });

    getHuduCompanyAssetsMock.mockResolvedValue({ state: 'unmapped' });
    expect(await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 })).toEqual({
      success: false,
      error: 'Client is not mapped to a Hudu company.',
      code: 'client_not_mapped',
    });

    getHuduCompanyAssetsMock.mockResolvedValue(okAssetsResult());
    resolveAlgaAssetIdForHuduAssetMock.mockResolvedValue('already-mapped-asset');
    expect(await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 })).toMatchObject({
      success: false,
      code: 'hudu_asset_already_mapped',
    });

    expect(createAssetMock).not.toHaveBeenCalled();
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });

  it('on mapping failure after creation it best-effort deletes the orphan and names it either way', async () => {
    setHuduAssetMappingRowMock.mockResolvedValue({
      ok: false,
      code: 'mapping_conflict',
      message: 'This asset or Hudu asset was just mapped by someone else. Refresh and try again.',
    });
    const { importHuduAsset } = await importActions();

    const cleaned = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });
    expect(deleteAssetMock).toHaveBeenCalledWith('created-EC-WS-001', { suppressRevalidate: true });
    expect(cleaned).toMatchObject({
      success: false,
      code: 'mapping_failed',
      orphanAssetId: 'created-EC-WS-001',
      orphanCleanedUp: true,
    });
    expect((cleaned as { error: string }).error).toContain('was removed');

    deleteAssetMock.mockRejectedValue(new Error('Permission denied: Cannot delete assets'));
    const orphaned = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });
    expect(orphaned).toMatchObject({
      success: false,
      code: 'mapping_failed',
      orphanAssetId: 'created-EC-WS-001',
      orphanCleanedUp: false,
    });
    expect((orphaned as { error: string }).error).toContain('created-EC-WS-001');
    expect((orphaned as { error: string }).error).toContain('not mapped');
  });
});

// ============================================================================
// T219 — asset_tag derivation
// ============================================================================

describe('T219: asset_tag derivation', () => {
  it('uses primary_serial when no asset in the tenant already carries it as a tag', async () => {
    expect(await deriveHuduAssetTag(knexCallableMock as any, TENANT, { huduAssetId: 1, primarySerial: 'SN-EC-1001' })).toBe(
      'SN-EC-1001'
    );

    const { importHuduAsset } = await importActions();
    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });
    expect(createAssetMock).toHaveBeenCalledWith(expect.objectContaining({ asset_tag: 'SN-EC-1001' }));
  });

  it('falls back to hudu-<id> when the serial is already used as another asset_tag', async () => {
    takenAssetTags = ['SN-EC-1001'];

    expect(await deriveHuduAssetTag(knexCallableMock as any, TENANT, { huduAssetId: 1, primarySerial: 'SN-EC-1001' })).toBe(
      'hudu-1'
    );

    const { importHuduAsset } = await importActions();
    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });
    expect(createAssetMock).toHaveBeenCalledWith(expect.objectContaining({ asset_tag: 'hudu-1' }));
  });

  it('falls back to hudu-<id> for missing or blank serials', async () => {
    const { importHuduAsset } = await importActions();

    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 2 }); // primary_serial null
    expect(createAssetMock).toHaveBeenLastCalledWith(expect.objectContaining({ asset_tag: 'hudu-2' }));

    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 3 }); // primary_serial blank
    expect(createAssetMock).toHaveBeenLastCalledWith(expect.objectContaining({ asset_tag: 'hudu-3' }));
  });
});

// ============================================================================
// T220 — status default mirrors the manual create form
// ============================================================================

describe('T220: status default', () => {
  it('imports with the same default status as the manual create form (QuickAddAsset)', async () => {
    // QuickAddAsset.tsx initializes formData.status = 'active'.
    expect(huduImportAssetStatus()).toBe('active');

    const { importHuduAsset } = await importActions();
    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(createAssetMock.mock.calls[0][0].status).toBe(huduImportAssetStatus());
  });
});

// ============================================================================
// T221 — guard chain (asset create RBAC + flag)
// ============================================================================

describe('T221: guards', () => {
  it('rejects both actions without asset create permission (403 semantics)', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { importHuduAsset, importAllUnmatchedHuduAssets } = await importActions();

    await expect(importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 })).rejects.toThrow(
      /insufficient permissions \(create\)/
    );
    await expect(importAllUnmatchedHuduAssets({ clientId: CLIENT_1 })).rejects.toThrow(
      /insufficient permissions \(create\)/
    );
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'asset', 'create');
    expect(createAssetMock).not.toHaveBeenCalled();
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });

  it('rejects both actions when the hudu-integration flag is off (404 semantics)', async () => {
    isEnabledMock.mockResolvedValue(false);
    const { importHuduAsset, importAllUnmatchedHuduAssets } = await importActions();

    await expect(importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 })).rejects.toThrow(/disabled for this tenant/);
    await expect(importAllUnmatchedHuduAssets({ clientId: CLIENT_1 })).rejects.toThrow(/disabled for this tenant/);
    expect(createAssetMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T222 — bulk import isolates per-item failures
// ============================================================================

describe('T222: importAllUnmatchedHuduAssets', () => {
  it('imports all unmatched sequentially; a mid-list failure is isolated into the summary', async () => {
    createAssetMock.mockImplementation(async (data: { name: string }) => {
      if (data.name === 'EC-SRV-01') {
        throw new Error('Invalid input data: boom');
      }
      return { asset_id: `created-${data.name}`, ...data };
    });
    const { importAllUnmatchedHuduAssets } = await importActions();

    const result = await importAllUnmatchedHuduAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      success: true,
      data: {
        created: 2,
        skipped: 0,
        failed: [{ huduAssetId: 2, error: 'Invalid input data: boom', code: 'create_failed' }],
      },
    });
    // The two survivors are mapped.
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledTimes(2);
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(
      knexCallableMock,
      TENANT,
      expect.objectContaining({ huduAssetId: 1, huduCompanyId: HUDU_COMPANY_ID })
    );
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(
      knexCallableMock,
      TENANT,
      expect.objectContaining({ huduAssetId: 3, huduCompanyId: HUDU_COMPANY_ID })
    );
  });

  it('skips mapped and suggested Hudu assets — only plain Unmapped rows import', async () => {
    getHuduAssetMappingRowsMock.mockResolvedValue([
      {
        id: 'am-1',
        alga_entity_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        external_entity_id: '1',
        external_realm_id: HUDU_COMPANY_ID,
        metadata: {},
      },
    ]);
    // Exact-name match claims Hudu asset 2 as Suggested.
    assetsRows = [{ asset_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', asset_name: 'EC-SRV-01', serial_number: null }];
    const { importAllUnmatchedHuduAssets } = await importActions();

    const result = await importAllUnmatchedHuduAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ success: true, data: { created: 1, skipped: 0, failed: [] } });
    expect(createAssetMock).toHaveBeenCalledTimes(1);
    expect(createAssetMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Printer Closet B' }));
  });
});

// ============================================================================
// T223 — bulk stops on rate_limited with a partial summary
// ============================================================================

describe('T223: bulk rate-limit stop', () => {
  it('stops the batch on a mid-batch 429 and returns the typed failure with the partial summary', async () => {
    getHuduCompanyAssetsMock
      .mockResolvedValueOnce(okAssetsResult()) // bulk pre-fetch
      .mockResolvedValueOnce(okAssetsResult()) // item 1
      .mockResolvedValueOnce(okAssetsResult()) // item 2
      .mockResolvedValueOnce(RATE_LIMITED); // item 3 → stop
    const { importAllUnmatchedHuduAssets } = await importActions();

    const result = await importAllUnmatchedHuduAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      success: false,
      error: 'Hudu rate limit exceeded (429).',
      code: 'rate_limited',
      errorKind: 'rate_limited',
      partial: { created: 2, skipped: 0, failed: [] },
    });
    expect(createAssetMock).toHaveBeenCalledTimes(2);
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledTimes(2);
  });

  it('a 429 on the bulk pre-fetch is the same typed failure with an empty partial summary', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(RATE_LIMITED);
    const { importAllUnmatchedHuduAssets } = await importActions();

    expect(await importAllUnmatchedHuduAssets({ clientId: CLIENT_1 })).toEqual({
      success: false,
      error: 'Hudu rate limit exceeded (429).',
      code: 'rate_limited',
      errorKind: 'rate_limited',
      partial: { created: 0, skipped: 0, failed: [] },
    });
    expect(createAssetMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T259 — single import of an excluded layout fails typed, nothing created
// ============================================================================

describe('T259: layout_excluded single import', () => {
  it('returns the typed layout_excluded failure without creating or mapping anything', async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'excluded' });
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(result).toMatchObject({ success: false, code: 'layout_excluded' });
    expect((result as { error: string }).error).toContain("Don't import");
    expect(createAssetMock).not.toHaveBeenCalled();
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
    expect(deleteAssetMock).not.toHaveBeenCalled();
  });

  it('only the excluded layout is blocked — other layouts still import', async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'excluded' });
    const { importHuduAsset } = await importActions();

    // Asset 3 is layout 12 (not excluded, unconfigured → unknown).
    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 3 });

    expect(result).toMatchObject({ success: true, data: { asset_type: 'unknown' } });
    expect(createAssetMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// T260 — bulk import skips excluded layouts with an accurate summary
// ============================================================================

describe('T260: bulk import skips excluded layouts', () => {
  it('excluded-layout assets are skipped entirely and counted in the summary', async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'workstation', '12': 'excluded' });
    const { importAllUnmatchedHuduAssets } = await importActions();

    const result = await importAllUnmatchedHuduAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ success: true, data: { created: 2, skipped: 1, failed: [] } });
    // The excluded printer (layout 12) was never attempted.
    expect(createAssetMock).toHaveBeenCalledTimes(2);
    expect(createAssetMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Printer Closet B' })
    );
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledTimes(2);
  });

  it('a mid-batch rate limit keeps the skipped count in the partial summary', async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '12': 'excluded' });
    getHuduCompanyAssetsMock
      .mockResolvedValueOnce(okAssetsResult()) // bulk pre-fetch
      .mockResolvedValueOnce(okAssetsResult()) // item 1
      .mockResolvedValueOnce(RATE_LIMITED); // item 2 → stop
    const { importAllUnmatchedHuduAssets } = await importActions();

    const result = await importAllUnmatchedHuduAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      success: false,
      error: 'Hudu rate limit exceeded (429).',
      code: 'rate_limited',
      errorKind: 'rate_limited',
      partial: { created: 1, skipped: 1, failed: [] },
    });
  });
});

// ============================================================================
// T251 — HuduAsset contract carries asset_layout_id + fields[] (live shape)
// ============================================================================

describe('T251: HuduAsset contract', () => {
  it('a live-shape fixture satisfies the contract and projects position-ordered label/value pairs', () => {
    const asset: HuduAsset = {
      id: 1,
      company_id: 55,
      name: 'EC-WS-001',
      asset_type: 'Computer Assets',
      asset_layout_id: 7,
      primary_serial: 'SN-EC-1001',
      fields: [
        { id: 12, label: 'Warranty Expiry', value: '2027-01-31', position: 2 },
        { id: 11, label: 'Hostname', value: 'EC-WS-001', position: 1 },
        { label: 'Position-less', value: null },
      ],
    };

    expect(asset.asset_layout_id).toBe(7);
    expect(buildHuduFieldsAttribute(asset.fields)).toEqual([
      { label: 'Position-less', value: null },
      { label: 'Hostname', value: 'EC-WS-001' },
      { label: 'Warranty Expiry', value: '2027-01-31' },
    ]);
    expect(buildHuduFieldsAttribute(undefined)).toEqual([]);
  });
});

// ============================================================================
// T252 — import writes the Hudu attributes namespace
// ============================================================================

describe('T252: import attributes write', () => {
  it('jsonb-merges position-ordered hudu_fields + hudu_synced_at onto the created asset', async () => {
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });
    expect(result).toMatchObject({ success: true });

    expect(attributeUpdates).toHaveLength(1);
    expect(attributeUpdates[0].table).toBe('assets');
    expect(attributeUpdates[0].where).toEqual({ tenant: TENANT, asset_id: 'created-EC-WS-001' });

    const raw = attributeUpdates[0].payload.attributes as { sql: string; bindings: string };
    // Sibling-key preservation rides the jsonb merge (proven against the real
    // DB in huduAssetSyncActions.test.ts's persistence block).
    expect(raw.sql).toContain(`coalesce(attributes, '{}'::jsonb) ||`);
    const merged = JSON.parse(raw.bindings);
    expect(merged.hudu_fields).toEqual([
      { label: 'Hostname', value: 'EC-WS-001' },
      { label: 'Warranty Expiry', value: '2027-01-31' },
      { label: 'Notes', value: 'Dock on desk' },
    ]);
    expect(new Date(merged.hudu_synced_at).toISOString()).toBe(merged.hudu_synced_at);
  });

  it('an asset without Hudu fields still gets the namespace with an empty hudu_fields', async () => {
    const { importHuduAsset } = await importActions();

    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 2 });

    expect(attributeUpdates).toHaveLength(1);
    const merged = JSON.parse((attributeUpdates[0].payload.attributes as { bindings: string }).bindings);
    expect(merged.hudu_fields).toEqual([]);
    expect(typeof merged.hudu_synced_at).toBe('string');
  });

  it('a failed attributes write best-effort deletes the just-created asset (typed create_failed)', async () => {
    attributesUpdateError = new Error('attributes write boom');
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(result).toEqual({ success: false, error: 'attributes write boom', code: 'create_failed' });
    expect(deleteAssetMock).toHaveBeenCalledWith('created-EC-WS-001', { suppressRevalidate: true });
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });
});
