/**
 * T218–T223 — Hudu asset import actions (single + bulk).
 * T251/T252 — HuduAsset contract fields[] + the attributes namespace (now
 * riding createAsset's attributes payload — single write, F317).
 * T264/T265 — tenant-wide serial-conflict pre-check (typed serial_conflict,
 * per-row in bulk, batch never aborted).
 * T320 — custom-target import: registry-validated resolve (F315) + schema-key
 * projection alongside hudu_fields (F317).
 *
 * Unit-mocked like huduAssetMappingActions.test.ts: auth, flag, tiers, knex,
 * the Phase 1 fetch (huduDataActions), createAsset/deleteAsset, the registry
 * read (listAssetTypes) and the mapping-row writes are fakes; the matcher
 * (assetMatching), the layout-type resolver and the import/attributes/
 * projection helpers (assetImport, assetAttributes, layoutFieldSchema) stay
 * REAL.
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

const createTenantKnexMock = vi.fn();
let assetsRows: Array<{ asset_id: string; asset_name: string; serial_number: string | null }> = [];
let takenAssetTags: string[] = [];
// F261 serial-conflict pre-check: tenant assets matchable by trimmed,
// lowercased serial (mirrors the lower(trim(serial_number)) SQL).
let serialConflictRows: Array<{
  asset_id: string;
  name: string;
  client_id: string | null;
  serial_number: string;
}> = [];
let serialConflictQueries: Array<{ sql: string; bindings: unknown[] }> = [];
// F317 regression: the import must NOT issue any post-create knex update —
// attributes ride createAsset's payload now. Any update lands here.
let attributeUpdates: Array<{
  table: string;
  where: Record<string, unknown> | undefined;
  payload: Record<string, any>;
}> = [];
const knexCallableMock = vi.fn((_table: string) => {
  let whereArg: Record<string, unknown> | undefined;
  let whereRawArgs: { sql: string; bindings: unknown[] } | undefined;
  const qb: Record<string, any> = {};
  qb.where = vi.fn((arg: Record<string, unknown>) => {
    whereArg = arg;
    return qb;
  });
  qb.whereRaw = vi.fn((sql: string, bindings?: unknown[]) => {
    whereRawArgs = { sql, bindings: bindings ?? [] };
    serialConflictQueries.push(whereRawArgs);
    return qb;
  });
  qb.select = vi.fn(async () => assetsRows);
  // findSerialConflict: where({ tenant }).whereRaw(lower(trim(...))).first(...)
  // deriveHuduAssetTag's collision pre-check: where({ tenant, asset_tag }).first(...)
  qb.first = vi.fn(async () => {
    if (whereRawArgs) {
      const needle = String(whereRawArgs.bindings[0]);
      const hit = serialConflictRows.find(
        (row) => row.serial_number.trim().toLowerCase() === needle
      );
      return hit ? { asset_id: hit.asset_id, name: hit.name, client_id: hit.client_id } : undefined;
    }
    return typeof whereArg?.asset_tag === 'string' && takenAssetTags.includes(whereArg.asset_tag as string)
      ? { asset_id: 'asset-owning-tag' }
      : undefined;
  });
  qb.update = vi.fn(async (payload: Record<string, any>) => {
    attributeUpdates.push({ table: _table, where: whereArg, payload });
    return 1;
  });
  return qb;
});
(knexCallableMock as any).raw = vi.fn((sql: string, bindings?: unknown) => ({ sql, bindings }));

const getHuduCompanyAssetsMock = vi.fn();
const createAssetMock = vi.fn();
const deleteAssetMock = vi.fn();
const listAssetTypesMock = vi.fn();
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

// F315: the registry read is knex-level — fake it; the resolver stays REAL.
vi.mock('@alga-psa/assets/lib/assetTypeRegistry', () => ({
  listAssetTypes: listAssetTypesMock,
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

// The six built-ins as the default tenant registry (custom entries per test).
const BUILTIN_REGISTRY = ['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown'].map(
  (slug) => ({ slug, name: slug, is_builtin: true, fields_schema: [] })
);

beforeEach(() => {
  vi.clearAllMocks();
  assetsRows = [];
  takenAssetTags = [];
  serialConflictRows = [];
  serialConflictQueries = [];
  attributeUpdates = [];

  hasPermissionMock.mockResolvedValue(true);
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  listAssetTypesMock.mockResolvedValue(BUILTIN_REGISTRY);
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
      // F317: the Hudu namespace rides createAsset's attributes (single write).
      attributes: {
        hudu_fields: [
          { label: 'Hostname', value: 'EC-WS-001' },
          { label: 'Warranty Expiry', value: '2027-01-31' },
          { label: 'Notes', value: 'Dock on desk' },
        ],
        hudu_synced_at: expect.any(String),
      },
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
// T264 — serial-conflict pre-check (tenant-wide, trimmed, case-insensitive)
// ============================================================================

describe('T264: serial_conflict single import', () => {
  it('a collision with another client\'s asset fails typed naming the existing asset; nothing created', async () => {
    serialConflictRows = [
      {
        asset_id: 'existing-asset-9',
        name: 'Other-Client-WS',
        client_id: '22222222-2222-2222-2222-222222222222',
        serial_number: ' sn-ec-1001 ', // different case + padding still collides
      },
    ];
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(result).toEqual({
      success: false,
      error: 'An asset with serial number "SN-EC-1001" already exists: "Other-Client-WS".',
      code: 'serial_conflict',
      existing_asset_id: 'existing-asset-9',
      existing_asset_name: 'Other-Client-WS',
      existing_client_id: '22222222-2222-2222-2222-222222222222',
    });
    expect(createAssetMock).not.toHaveBeenCalled();
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
    expect(deleteAssetMock).not.toHaveBeenCalled();
    expect(attributeUpdates).toHaveLength(0);
    // Tenant-wide lookup normalizes in SQL and binds the trimmed lowercased serial.
    expect(serialConflictQueries).toHaveLength(1);
    expect(serialConflictQueries[0].sql).toContain('lower(trim(serial_number))');
    expect(serialConflictQueries[0].bindings).toEqual(['sn-ec-1001']);
  });

  it('a conflict row without a client omits existing_client_id', async () => {
    serialConflictRows = [
      { asset_id: 'existing-asset-9', name: 'Orphan-WS', client_id: null, serial_number: 'SN-EC-1001' },
    ];
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(result).toMatchObject({
      success: false,
      code: 'serial_conflict',
      existing_asset_id: 'existing-asset-9',
      existing_asset_name: 'Orphan-WS',
    });
    expect(result).not.toHaveProperty('existing_client_id');
    expect(createAssetMock).not.toHaveBeenCalled();
  });

  it('blank or missing serials never run the conflict check and import normally', async () => {
    serialConflictRows = [
      { asset_id: 'existing-asset-9', name: 'Blank-Serial-WS', client_id: null, serial_number: '' },
    ];
    const { importHuduAsset } = await importActions();

    expect(await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 2 })).toMatchObject({ success: true }); // null serial
    expect(await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 3 })).toMatchObject({ success: true }); // blank serial
    expect(serialConflictQueries).toHaveLength(0);
    expect(createAssetMock).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// T265 — bulk mixed excluded / serial-conflict / success
// ============================================================================

describe('T265: bulk mixed excluded / conflict / success', () => {
  it('skips the excluded layout, records the conflict per-row with its code + existing name, creates the rest', async () => {
    // Asset 3 (Printers, layout 12) excluded; asset 1's serial collides; asset 2 imports.
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'workstation', '12': 'excluded' });
    serialConflictRows = [
      {
        asset_id: 'existing-asset-9',
        name: 'Other-Client-WS',
        client_id: '22222222-2222-2222-2222-222222222222',
        serial_number: 'sn-ec-1001',
      },
    ];
    const { importAllUnmatchedHuduAssets } = await importActions();

    const result = await importAllUnmatchedHuduAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      success: true,
      data: {
        created: 1,
        skipped: 1,
        failed: [
          {
            huduAssetId: 1,
            error: 'An asset with serial number "SN-EC-1001" already exists: "Other-Client-WS".',
            code: 'serial_conflict',
            existing_asset_name: 'Other-Client-WS',
          },
        ],
      },
    });
    // The conflict never aborted the batch: EC-SRV-01 was still created and mapped.
    expect(createAssetMock).toHaveBeenCalledTimes(1);
    expect(createAssetMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'EC-SRV-01' }));
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledTimes(1);
    expect(setHuduAssetMappingRowMock).toHaveBeenCalledWith(
      knexCallableMock,
      TENANT,
      expect.objectContaining({ huduAssetId: 2 })
    );
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
// T252 — the Hudu attributes namespace rides createAsset's payload (F317)
// ============================================================================

describe('T252: import attributes payload', () => {
  it('passes position-ordered hudu_fields + hudu_synced_at through createAsset — no post-create write', async () => {
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });
    expect(result).toMatchObject({ success: true });

    expect(createAssetMock).toHaveBeenCalledTimes(1);
    const attributes = createAssetMock.mock.calls[0][0].attributes as Record<string, any>;
    expect(attributes.hudu_fields).toEqual([
      { label: 'Hostname', value: 'EC-WS-001' },
      { label: 'Warranty Expiry', value: '2027-01-31' },
      { label: 'Notes', value: 'Dock on desk' },
    ]);
    expect(new Date(attributes.hudu_synced_at).toISOString()).toBe(attributes.hudu_synced_at);
    // The Phase 2.1 jsonb-merge update is gone — createAsset is the only write.
    expect(attributeUpdates).toHaveLength(0);
  });

  it('an asset without Hudu fields still gets the namespace with an empty hudu_fields', async () => {
    const { importHuduAsset } = await importActions();

    await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 2 });

    const attributes = createAssetMock.mock.calls[0][0].attributes as Record<string, any>;
    expect(attributes.hudu_fields).toEqual([]);
    expect(typeof attributes.hudu_synced_at).toBe('string');
    expect(attributeUpdates).toHaveLength(0);
  });

  it('a createAsset failure is typed create_failed with nothing left to clean up', async () => {
    createAssetMock.mockRejectedValue(new Error('attributes payload boom'));
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(result).toEqual({ success: false, error: 'attributes payload boom', code: 'create_failed' });
    expect(deleteAssetMock).not.toHaveBeenCalled();
    expect(setHuduAssetMappingRowMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T320 — custom-target import projects schema keys alongside hudu_fields
// ============================================================================

describe('T320: custom-target import projection (F315/F317)', () => {
  const CUSTOM_TYPE = {
    slug: 'rack_mounted_ups',
    name: 'Rack Mounted UPS',
    is_builtin: false,
    fields_schema: [
      { key: 'hostname', label: 'Hostname', kind: 'text' },
      { key: 'warranty_expiry', label: 'Warranty Expiry', kind: 'date' },
      { key: 'port_count', label: 'Port Count', kind: 'number' },
      { key: 'monitored', label: 'Monitored?', kind: 'boolean' },
      { key: 'environment', label: 'Environment', kind: 'select', options: ['Prod', 'Dev'] },
    ],
  };

  beforeEach(() => {
    listAssetTypesMock.mockResolvedValue([...BUILTIN_REGISTRY, CUSTOM_TYPE]);
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'rack_mounted_ups' });
  });

  function withAssetFields(fields: Array<Record<string, unknown>>) {
    const result = okAssetsResult();
    (result.items[0] as { fields: unknown }).fields = fields;
    getHuduCompanyAssetsMock.mockResolvedValue(result);
  }

  it('projects schema-keyed values + hudu_fields in ONE createAsset payload and resolves the custom slug', async () => {
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    expect(createAssetMock).toHaveBeenCalledTimes(1);
    const payload = createAssetMock.mock.calls[0][0];
    expect(payload.asset_type).toBe('rack_mounted_ups');
    expect(payload.attributes).toEqual({
      hostname: 'EC-WS-001',
      warranty_expiry: '2027-01-31',
      hudu_fields: [
        { label: 'Hostname', value: 'EC-WS-001' },
        { label: 'Warranty Expiry', value: '2027-01-31' },
        { label: 'Notes', value: 'Dock on desk' },
      ],
      hudu_synced_at: expect.any(String),
    });
    expect(attributeUpdates).toHaveLength(0);
    expect(result).toMatchObject({ success: true, data: { asset_type: 'rack_mounted_ups' } });
    expect(result).not.toHaveProperty('data.projection_skipped');
  });

  it('matches by normalized label so generated types round-trip 1:1 (messy labels, coerced kinds)', async () => {
    withAssetFields([
      { label: ' Warranty—Expiry?? ', value: '2027-01-31', position: 2 },
      { label: 'PORT  COUNT', value: '42', position: 3 },
      { label: 'Monitored?', value: 'Yes', position: 4 },
      { label: 'Environment', value: 'Prod', position: 5 },
      { label: 'Hostname', value: 'EC-WS-001', position: 1 },
    ]);
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    const attributes = createAssetMock.mock.calls[0][0].attributes as Record<string, unknown>;
    expect(attributes).toMatchObject({
      hostname: 'EC-WS-001',
      warranty_expiry: '2027-01-31',
      port_count: 42, // numeric string parsed for the number kind
      monitored: true, // boolean-ish string coerced for the boolean kind
      environment: 'Prod', // select value kept as-is
    });
    expect(result).toMatchObject({ success: true });
  });

  it('a value that fails its kind is skipped (reported, still visible in hudu_fields) — import succeeds', async () => {
    withAssetFields([
      { label: 'Hostname', value: 'EC-WS-001', position: 1 },
      { label: 'Port Count', value: 'twenty', position: 2 },
      { label: 'Environment', value: 'Sandbox', position: 3 },
    ]);
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    const attributes = createAssetMock.mock.calls[0][0].attributes as Record<string, unknown>;
    expect(attributes.hostname).toBe('EC-WS-001');
    expect(attributes).not.toHaveProperty('port_count');
    expect(attributes).not.toHaveProperty('environment'); // not in the select's options
    // The raw values stay visible in the namespace copy.
    expect(attributes.hudu_fields).toEqual([
      { label: 'Hostname', value: 'EC-WS-001' },
      { label: 'Port Count', value: 'twenty' },
      { label: 'Environment', value: 'Sandbox' },
    ]);
    expect(result).toMatchObject({
      success: true,
      data: { projection_skipped: ['port_count', 'environment'] },
    });
  });

  it("a configured slug that is no longer in the registry resolves to 'unknown' (no projection)", async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'ghost_type' });
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    const payload = createAssetMock.mock.calls[0][0];
    expect(payload.asset_type).toBe('unknown');
    expect(Object.keys(payload.attributes).sort()).toEqual(['hudu_fields', 'hudu_synced_at']);
    expect(result).toMatchObject({ success: true, data: { asset_type: 'unknown' } });
  });

  it('builtin-target imports are unaffected: no projected keys, just the Hudu namespace', async () => {
    getHuduAssetLayoutTypeMapMock.mockResolvedValue({ '7': 'workstation' });
    const { importHuduAsset } = await importActions();

    const result = await importHuduAsset({ clientId: CLIENT_1, huduAssetId: 1 });

    const payload = createAssetMock.mock.calls[0][0];
    expect(payload.asset_type).toBe('workstation');
    expect(Object.keys(payload.attributes).sort()).toEqual(['hudu_fields', 'hudu_synced_at']);
    expect(result).toMatchObject({ success: true, data: { asset_type: 'workstation' } });
    expect(result).not.toHaveProperty('data.projection_skipped');
  });
});
