/**
 * Hudu asset action unit tests. Persistence behavior runs separately in
 * huduAssetSyncActions.db.test.ts against the migrated, isolated workspace database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HUDU_MAPPING_TABLE } from '../../lib/integrations/hudu/contracts';
import { writeHuduAssetAttributes } from '../../lib/integrations/hudu/assetAttributes';

const TENANT = 'tenant-hudu-sync-1';
const CLIENT_1 = '11111111-1111-1111-1111-111111111111';
const ASSET_1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ASSET_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const ASSET_3 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
const HUDU_COMPANY_ID = '55';

const internalUser = { user_id: 'user-1', tenant: TENANT, user_type: 'internal' };

const hasPermissionMock = vi.fn();
const assertTierAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
let assetsRows: Array<{
  asset_id: string;
  name: string;
  serial_number: string | null;
  attributes?: Record<string, unknown> | null;
  rmm_provider?: string | null;
}> = [];
const delMock = vi.fn();
let attributeUpdates: Array<{
  table: string;
  where: Record<string, unknown> | undefined;
  payload: Record<string, any>;
}> = [];
const knexCallableMock = vi.fn((_table: string) => {
  let whereArg: Record<string, unknown> | undefined;
  const qb: Record<string, unknown> = {};
  qb.where = vi.fn((arg?: Record<string, unknown> | string, value?: unknown) => {
    if (typeof arg === 'string') {
      whereArg = { ...whereArg, [arg.split('.').at(-1)!]: value };
    } else if (arg) {
      whereArg = { ...whereArg, ...arg };
    }
    return qb;
  });
  qb.whereIn = vi.fn(() => qb);
  qb.select = vi.fn(async () => assetsRows);
  qb.del = delMock;
  qb.delete = delMock;
  // writeHuduAssetAttributes: where({ tenant, asset_id }).update({ attributes: raw })
  qb.update = vi.fn(async (payload: Record<string, any>) => {
    attributeUpdates.push({ table: _table, where: whereArg, payload });
    return 1;
  });
  return qb;
});
(knexCallableMock as any).raw = vi.fn((sql: string, bindings?: unknown) => ({ sql, bindings }));

const getHuduCompanyAssetsMock = vi.fn();
const updateAssetMock = vi.fn();

const getHuduAssetMappingRowsMock = vi.fn();
const setHuduAssetMappingStaleMock = vi.fn();
const touchHuduAssetMappingsSyncedMock = vi.fn();
const clearHuduAssetMappingRowMock = vi.fn();

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

// The sync core fetches via the session-free huduDataCore now.
vi.mock('@ee/lib/integrations/hudu/huduDataCore', () => ({
  fetchHuduCompanyAssets: getHuduCompanyAssetsMock,
}));

// The core writes through the actor-injectable updateAssetRecord (knex, tenant,
// actor, assetId, changes, opts). Forward (assetId, changes) to the existing
// fake so the payload assertions stay as-is.
vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  updateAssetRecord: (_knex: unknown, _tenant: unknown, _actor: unknown, assetId: unknown, changes: unknown) =>
    updateAssetMock(assetId, changes),
}));

// Keep the REAL module (the DB block reaches it via importActual); fake only
// the knex-level row access for the action layer.
vi.mock('@ee/lib/integrations/hudu/assetMapping', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getHuduAssetMappingRows: getHuduAssetMappingRowsMock,
  setHuduAssetMappingStale: setHuduAssetMappingStaleMock,
  touchHuduAssetMappingsSynced: touchHuduAssetMappingsSyncedMock,
  clearHuduAssetMappingRow: clearHuduAssetMappingRowMock,
}));

async function importActions() {
  return import('@ee/lib/actions/integrations/huduAssetSyncActions');
}

function okFetch(items: Array<Record<string, unknown>>) {
  return {
    state: 'ok',
    items,
    count: items.length,
    huduCompanyId: HUDU_COMPANY_ID,
    companyUrl: 'https://hudu.example.com/c/55',
    fetchedAt: '2026-06-11T10:00:00.000Z',
    fromCache: false,
  };
}

function mappingRow(id: string, assetId: string, huduAssetId: number, metadata: Record<string, unknown> = {}) {
  return {
    id,
    tenant: TENANT,
    integration_type: 'hudu',
    alga_entity_type: 'asset',
    alga_entity_id: assetId,
    external_entity_id: String(huduAssetId),
    external_realm_id: HUDU_COMPANY_ID,
    sync_status: 'manual_link',
    last_synced_at: null,
    metadata: { stale: false, ...metadata },
    asset_name: null,
  };
}

function expectNoSyncWritesBeyond(expected: { updateCalls?: number; staleCalls?: number }) {
  expect(updateAssetMock).toHaveBeenCalledTimes(expected.updateCalls ?? 0);
  expect(setHuduAssetMappingStaleMock).toHaveBeenCalledTimes(expected.staleCalls ?? 0);
  expect(delMock).not.toHaveBeenCalled();
  expect(clearHuduAssetMappingRowMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  assetsRows = [];
  attributeUpdates = [];

  hasPermissionMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduCompanyAssetsMock.mockResolvedValue(okFetch([]));
  getHuduAssetMappingRowsMock.mockResolvedValue([]);
  setHuduAssetMappingStaleMock.mockResolvedValue(1);
  touchHuduAssetMappingsSyncedMock.mockResolvedValue(1);
  clearHuduAssetMappingRowMock.mockResolvedValue(1);
  updateAssetMock.mockResolvedValue({ asset_id: ASSET_1 });
});

// ============================================================================
// Helper persistence lives in huduAssetSyncActions.db.test.ts.
// ============================================================================

describe('T224/T225: syncHuduClientAssets synced fields', () => {
  it('T224: updates exactly {name, serial_number} on the mapped asset when Hudu changed both', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001-RENAMED', primary_serial: 'SN-NEW-1', archived: false }])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [{ asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001' }];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    // The sync sees current data: cache bypassed via refresh.
    expect(getHuduCompanyAssetsMock).toHaveBeenCalledWith(TENANT, CLIENT_1, { refresh: true });
    expect(getHuduAssetMappingRowsMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      huduCompanyId: HUDU_COMPANY_ID,
    });

    expect(updateAssetMock).toHaveBeenCalledTimes(1);
    expect(updateAssetMock).toHaveBeenCalledWith(ASSET_1, {
      name: 'EC-WS-001-RENAMED',
      serial_number: 'SN-NEW-1',
    });
    expect(Object.keys(updateAssetMock.mock.calls[0][1]).sort()).toEqual(['name', 'serial_number']);

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 0, stale: 0, rmmSkipped: 0, syncedAt: expect.any(String) });
  });

  it('T224: a name-only change sends a name-only payload', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001-RENAMED', primary_serial: 'SN-EC-1001', archived: false }])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [{ asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001' }];
    const { syncHuduClientAssets } = await importActions();

    await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(updateAssetMock).toHaveBeenCalledWith(ASSET_1, { name: 'EC-WS-001-RENAMED' });
    expect(Object.keys(updateAssetMock.mock.calls[0][1])).toEqual(['name']);
  });

  it('T225: an unchanged pair (even with non-synced fields differing) is never touched', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        // Non-synced differences only: layout name, url, model.
        {
          id: 1,
          name: 'EC-WS-001',
          primary_serial: 'SN-EC-1001',
          asset_type: 'Totally New Layout',
          primary_model: 'XPS 9999',
          url: '/a/1-moved',
          archived: false,
        },
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [{ asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001' }];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 1, stale: 0, rmmSkipped: 0, syncedAt: expect.any(String) });
    expectNoSyncWritesBeyond({ updateCalls: 0, staleCalls: 0 });
  });

  it('T225: asset_type never appears in any updateAsset payload (F220)', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        { id: 1, name: 'Renamed-1', primary_serial: 'SN-1', asset_type: 'Servers', archived: false },
        { id: 2, name: 'Renamed-2', primary_serial: 'SN-2', asset_type: 'Printers', archived: false },
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([
      mappingRow('am-1', ASSET_1, 1),
      mappingRow('am-2', ASSET_2, 2),
    ]);
    assetsRows = [
      { asset_id: ASSET_1, name: 'Old-1', serial_number: null },
      { asset_id: ASSET_2, name: 'Old-2', serial_number: 'SN-OLD' },
    ];
    const { syncHuduClientAssets } = await importActions();

    await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(updateAssetMock).toHaveBeenCalledTimes(2);
    for (const [, payload] of updateAssetMock.mock.calls) {
      expect(payload).not.toHaveProperty('asset_type');
      expect(Object.keys(payload).every((key) => key === 'name' || key === 'serial_number')).toBe(true);
    }
  });
});

// ============================================================================
// T226/T227 — stale flagging, never destructive (unit-mocked)
// ============================================================================

describe('T226/T227: stale flagging and the no-delete guarantee', () => {
  it('T226: archived Hudu asset flags the mapping stale without touching the Alga asset', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001', primary_serial: 'SN-EC-1001', archived: true }])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [{ asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001' }];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 0, stale: 1, rmmSkipped: 0, syncedAt: expect.any(String) });
    expect(setHuduAssetMappingStaleMock).toHaveBeenCalledTimes(1);
    expect(setHuduAssetMappingStaleMock).toHaveBeenCalledWith(knexCallableMock, TENANT, { mappingId: 'am-1' }, true);
    expect(updateAssetMock).not.toHaveBeenCalled();
  });

  it('T226: an already-stale mapping that is still missing is counted without a redundant write', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(okFetch([]));
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1, { stale: true })]);
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toMatchObject({ state: 'ok', stale: 1 });
    expect(setHuduAssetMappingStaleMock).not.toHaveBeenCalled();
  });

  it('T226: reappearance clears the stale flag', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001', primary_serial: 'SN-EC-1001', archived: false }])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1, { stale: true })]);
    assetsRows = [{ asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001' }];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 1, stale: 0, rmmSkipped: 0, syncedAt: expect.any(String) });
    expect(setHuduAssetMappingStaleMock).toHaveBeenCalledTimes(1);
    expect(setHuduAssetMappingStaleMock).toHaveBeenCalledWith(knexCallableMock, TENANT, { mappingId: 'am-1' }, false);
  });

  it('T227: archived and missing paths never delete or update anything', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001', archived: true }]) // id 2 absent entirely
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([
      mappingRow('am-1', ASSET_1, 1),
      mappingRow('am-2', ASSET_2, 2),
    ]);
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toMatchObject({ state: 'ok', stale: 2 });
    expectNoSyncWritesBeyond({ updateCalls: 0, staleCalls: 2 });
    // Rows are only flagged + stamped, never removed.
    expect(touchHuduAssetMappingsSyncedMock).toHaveBeenCalledWith(
      knexCallableMock,
      TENANT,
      ['am-1', 'am-2'],
      expect.any(String)
    );
  });

  it('T227: a Hudu fetch failure (incl. rate_limited) returns the typed envelope with nothing applied', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      state: 'error',
      error: 'Hudu rate limit exceeded (429).',
      errorKind: 'rate_limited',
    });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(touchHuduAssetMappingsSyncedMock).not.toHaveBeenCalled();
    expectNoSyncWritesBeyond({ updateCalls: 0, staleCalls: 0 });
  });

  it('unmapped clients short-circuit to the typed state without touching the DB', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue({ state: 'unmapped' });
    const { syncHuduClientAssets } = await importActions();

    expect(await syncHuduClientAssets({ clientId: CLIENT_1 })).toEqual({ state: 'unmapped' });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});

// ============================================================================
// T228 — last_synced_at + summary counts across a mixed batch (unit-mocked)
// ============================================================================

describe('T228: summary + last_synced_at stamping', () => {
  it('counts a mixed batch (1 updated, 1 unchanged, 1 stale) and stamps every processed row', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        { id: 1, name: 'EC-WS-001-RENAMED', primary_serial: 'SN-EC-1001', archived: false },
        { id: 2, name: 'EC-SRV-01', primary_serial: 'SN-EC-2001', archived: false },
        // id 3 disappeared from Hudu.
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([
      mappingRow('am-1', ASSET_1, 1),
      mappingRow('am-2', ASSET_2, 2),
      mappingRow('am-3', ASSET_3, 3),
    ]);
    assetsRows = [
      { asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001' },
      { asset_id: ASSET_2, name: 'EC-SRV-01', serial_number: 'SN-EC-2001' },
      { asset_id: ASSET_3, name: 'Printer Closet B', serial_number: null },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 1, stale: 1, rmmSkipped: 0, syncedAt: expect.any(String) });

    expect(updateAssetMock).toHaveBeenCalledTimes(1);
    expect(updateAssetMock).toHaveBeenCalledWith(ASSET_1, { name: 'EC-WS-001-RENAMED' });
    for (const [, payload] of updateAssetMock.mock.calls) {
      expect(payload).not.toHaveProperty('asset_type');
    }

    expect(touchHuduAssetMappingsSyncedMock).toHaveBeenCalledTimes(1);
    expect(touchHuduAssetMappingsSyncedMock).toHaveBeenCalledWith(
      knexCallableMock,
      TENANT,
      ['am-1', 'am-2', 'am-3'],
      (result as { syncedAt: string }).syncedAt
    );
  });
});

// ============================================================================
// T253 — hudu_fields refresh on mapped live assets (unit-mocked)
// ============================================================================

describe('T253: hudu_fields refresh', () => {
  const HUDU_FIELDS_LIVE = [
    // Deliberately out of position order — sync must sort.
    { id: 13, label: 'Notes', value: 'Re-imaged 2026-06', position: 3 },
    { id: 11, label: 'Hostname', value: 'EC-WS-001', position: 1 },
    { id: 12, label: 'Warranty Expiry', value: '2027-01-31', position: 2 },
  ];

  it('a changed hudu_fields jsonb-merges the namespace and counts the row updated even with name/serial unchanged', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        { id: 1, name: 'EC-WS-001', primary_serial: 'SN-EC-1001', archived: false, fields: HUDU_FIELDS_LIVE },
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [
      {
        asset_id: ASSET_1,
        name: 'EC-WS-001',
        serial_number: 'SN-EC-1001',
        attributes: {
          acme_namespace: { keep: true },
          hudu_fields: [{ label: 'Hostname', value: 'EC-WS-001' }],
          hudu_synced_at: '2026-06-10T00:00:00.000Z',
        },
      },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 0, stale: 0, rmmSkipped: 0, syncedAt: expect.any(String) });
    expect(updateAssetMock).not.toHaveBeenCalled();

    expect(attributeUpdates).toHaveLength(1);
    expect(attributeUpdates[0].table).toBe('assets');
    expect(attributeUpdates[0].where).toEqual({ tenant: TENANT, asset_id: ASSET_1 });
    const raw = attributeUpdates[0].payload.attributes as { sql: string; bindings: string };
    // The merge preserves sibling attributes keys (acme_namespace above) —
    // proven against the real DB in the persistence block below.
    expect(raw.sql).toContain(`coalesce(attributes, '{}'::jsonb) ||`);
    expect(JSON.parse(raw.bindings)).toEqual({
      hudu_fields: [
        { label: 'Hostname', value: 'EC-WS-001' },
        { label: 'Warranty Expiry', value: '2027-01-31' },
        { label: 'Notes', value: 'Re-imaged 2026-06' },
      ],
      hudu_synced_at: (result as { syncedAt: string }).syncedAt,
    });
  });

  it('unchanged hudu_fields still refresh hudu_synced_at but count the row unchanged', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        { id: 1, name: 'EC-WS-001', primary_serial: 'SN-EC-1001', archived: false, fields: HUDU_FIELDS_LIVE },
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [
      {
        asset_id: ASSET_1,
        name: 'EC-WS-001',
        serial_number: 'SN-EC-1001',
        attributes: {
          hudu_fields: [
            { label: 'Hostname', value: 'EC-WS-001' },
            { label: 'Warranty Expiry', value: '2027-01-31' },
            { label: 'Notes', value: 'Re-imaged 2026-06' },
          ],
          hudu_synced_at: '2026-06-10T00:00:00.000Z',
        },
      },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 1, stale: 0, rmmSkipped: 0, syncedAt: expect.any(String) });
    expect(attributeUpdates).toHaveLength(1);
    const merged = JSON.parse((attributeUpdates[0].payload.attributes as { bindings: string }).bindings);
    expect(merged.hudu_synced_at).toBe((result as { syncedAt: string }).syncedAt);
  });

  it('name/serial AND field changes count the row once', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        { id: 1, name: 'EC-WS-001-RENAMED', primary_serial: 'SN-EC-1001', archived: false, fields: HUDU_FIELDS_LIVE },
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [{ asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001', attributes: null }];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 0, stale: 0, rmmSkipped: 0, syncedAt: expect.any(String) });
    expect(updateAssetMock).toHaveBeenCalledWith(ASSET_1, { name: 'EC-WS-001-RENAMED' });
    expect(attributeUpdates).toHaveLength(1);
  });
});

// ============================================================================
// T254 — stale/missing Hudu assets leave attributes untouched
// ============================================================================

describe('T254: stale/missing assets keep attributes untouched', () => {
  it('archived and missing Hudu assets trigger no attributes write', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001', archived: true }]) // id 2 absent entirely
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([
      mappingRow('am-1', ASSET_1, 1),
      mappingRow('am-2', ASSET_2, 2),
    ]);
    assetsRows = [
      { asset_id: ASSET_1, name: 'EC-WS-001', serial_number: null, attributes: { hudu_fields: [{ label: 'Old', value: 'x' }] } },
      { asset_id: ASSET_2, name: 'EC-SRV-01', serial_number: null, attributes: { hudu_fields: [{ label: 'Old', value: 'y' }] } },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toMatchObject({ state: 'ok', stale: 2 });
    expect(attributeUpdates).toHaveLength(0);
    expectNoSyncWritesBeyond({ updateCalls: 0, staleCalls: 2 });
  });
});

// ============================================================================
// T262/T263 — rmm_provider guard (F260)
// ============================================================================

describe('T262/T263: rmm_provider guard', () => {
  const RMM_HUDU_FIELDS = [{ id: 11, label: 'Hostname', value: 'EC-WS-001', position: 1 }];

  it('T262: suppresses name/serial writes on an RMM-owned asset; hudu_fields still refresh; rmmSkipped + updated', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        // Both synced fields differ from the Alga row — and must NOT be written.
        { id: 1, name: 'EC-WS-001-HUDU', primary_serial: 'SN-HUDU-9', archived: false, fields: RMM_HUDU_FIELDS },
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [
      {
        asset_id: ASSET_1,
        name: 'NINJA-WS-01',
        serial_number: 'SN-RMM-1',
        rmm_provider: 'ninjaone',
        attributes: { hudu_fields: [{ label: 'Old', value: 'x' }] },
      },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(updateAssetMock).not.toHaveBeenCalled();
    // The Hudu namespace is still Hudu-won: refreshed, and its change counts the row updated.
    expect(attributeUpdates).toHaveLength(1);
    expect(attributeUpdates[0].where).toEqual({ tenant: TENANT, asset_id: ASSET_1 });
    expect(
      JSON.parse((attributeUpdates[0].payload.attributes as { bindings: string }).bindings).hudu_fields
    ).toEqual([{ label: 'Hostname', value: 'EC-WS-001' }]);
    expect(result).toEqual({
      state: 'ok',
      updated: 1,
      unchanged: 0,
      stale: 0,
      rmmSkipped: 1,
      syncedAt: expect.any(String),
    });
  });

  it('T262: suppressed diffs with unchanged hudu_fields count the row unchanged + rmmSkipped; stale clears normally', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([
        { id: 1, name: 'EC-WS-001-HUDU', primary_serial: 'SN-HUDU-9', archived: false, fields: RMM_HUDU_FIELDS },
      ])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1, { stale: true })]);
    assetsRows = [
      {
        asset_id: ASSET_1,
        name: 'NINJA-WS-01',
        serial_number: 'SN-RMM-1',
        rmm_provider: 'ninjaone',
        attributes: { hudu_fields: [{ label: 'Hostname', value: 'EC-WS-001' }] },
      },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      state: 'ok',
      updated: 0,
      unchanged: 1,
      stale: 0,
      rmmSkipped: 1,
      syncedAt: expect.any(String),
    });
    expect(updateAssetMock).not.toHaveBeenCalled();
    // hudu_synced_at still refreshes, and reappearance clears the stale flag as usual.
    expect(attributeUpdates).toHaveLength(1);
    expect(setHuduAssetMappingStaleMock).toHaveBeenCalledWith(knexCallableMock, TENANT, { mappingId: 'am-1' }, false);
  });

  it('T262: an RMM-owned asset with no name/serial diff is plain unchanged — rmmSkipped stays 0', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001', primary_serial: 'SN-EC-1001', archived: false }])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [
      { asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001', rmm_provider: 'ninjaone' },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      state: 'ok',
      updated: 0,
      unchanged: 1,
      stale: 0,
      rmmSkipped: 0,
      syncedAt: expect.any(String),
    });
    expect(updateAssetMock).not.toHaveBeenCalled();
  });

  it('T262: an archived Hudu asset mapped to an RMM-owned Alga asset goes stale normally', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001-HUDU', primary_serial: 'SN-HUDU-9', archived: true }])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [
      { asset_id: ASSET_1, name: 'NINJA-WS-01', serial_number: 'SN-RMM-1', rmm_provider: 'ninjaone' },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(result).toEqual({
      state: 'ok',
      updated: 0,
      unchanged: 0,
      stale: 1,
      rmmSkipped: 0,
      syncedAt: expect.any(String),
    });
    expect(setHuduAssetMappingStaleMock).toHaveBeenCalledWith(knexCallableMock, TENANT, { mappingId: 'am-1' }, true);
    expect(attributeUpdates).toHaveLength(0);
  });

  it('T263: rmm_provider null keeps the pull-update path exactly as before (regression)', async () => {
    getHuduCompanyAssetsMock.mockResolvedValue(
      okFetch([{ id: 1, name: 'EC-WS-001-RENAMED', primary_serial: 'SN-NEW-1', archived: false }])
    );
    getHuduAssetMappingRowsMock.mockResolvedValue([mappingRow('am-1', ASSET_1, 1)]);
    assetsRows = [
      { asset_id: ASSET_1, name: 'EC-WS-001', serial_number: 'SN-EC-1001', rmm_provider: null },
    ];
    const { syncHuduClientAssets } = await importActions();

    const result = await syncHuduClientAssets({ clientId: CLIENT_1 });

    expect(updateAssetMock).toHaveBeenCalledTimes(1);
    expect(updateAssetMock).toHaveBeenCalledWith(ASSET_1, {
      name: 'EC-WS-001-RENAMED',
      serial_number: 'SN-NEW-1',
    });
    expect(result).toEqual({
      state: 'ok',
      updated: 1,
      unchanged: 0,
      stale: 0,
      rmmSkipped: 0,
      syncedAt: expect.any(String),
    });
  });
});

// ============================================================================
// T229 — guard chain
// ============================================================================

describe('T229: guard chain', () => {
  it('rejects without asset update permission (403 semantics)', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { syncHuduClientAssets } = await importActions();

    await expect(syncHuduClientAssets({ clientId: CLIENT_1 })).rejects.toThrow(
      /insufficient permissions \(update\)/
    );
    expect(hasPermissionMock).toHaveBeenCalledWith(internalUser, 'asset', 'update');
    expect(getHuduCompanyAssetsMock).not.toHaveBeenCalled();
    expect(updateAssetMock).not.toHaveBeenCalled();
  });
});
