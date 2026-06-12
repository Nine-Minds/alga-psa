/**
 * T224–T229 — Hudu manual pull-sync (syncHuduClientAssets) + sync helpers.
 * T253/T254 — hudu_fields refresh on mapped live assets; stale untouched.
 *
 * Helper persistence (stale metadata merge, last_synced_at stamping, and the
 * assets.attributes jsonb merge) runs against the REAL local dev DB exactly
 * like huduAssetMappingActions.test.ts (shared advisory lock, importActual).
 * The action layer is unit-mocked like the sibling: auth, flag, tiers, knex,
 * huduDataActions, updateAsset and the mapping-row functions are fakes; the
 * attributes helpers (assetAttributes) stay REAL.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

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
const isEnabledMock = vi.fn();
const assertTierAccessMock = vi.fn();
const assertAddOnAccessMock = vi.fn();

const createTenantKnexMock = vi.fn();
let assetsRows: Array<{
  asset_id: string;
  name: string;
  serial_number: string | null;
  attributes?: Record<string, unknown> | null;
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
  qb.where = vi.fn((arg?: Record<string, unknown>) => {
    if (arg && typeof arg === 'object') {
      whereArg = arg;
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
  updateAsset: updateAssetMock,
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
  isEnabledMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  assertAddOnAccessMock.mockResolvedValue(undefined);

  createTenantKnexMock.mockResolvedValue({ knex: knexCallableMock, tenant: TENANT });

  getHuduCompanyAssetsMock.mockResolvedValue(okFetch([]));
  getHuduAssetMappingRowsMock.mockResolvedValue([]);
  setHuduAssetMappingStaleMock.mockResolvedValue(1);
  touchHuduAssetMappingsSyncedMock.mockResolvedValue(1);
  clearHuduAssetMappingRowMock.mockResolvedValue(1);
  updateAssetMock.mockResolvedValue({ asset_id: ASSET_1 });
});

// ============================================================================
// Sync helpers — persistence against the real DB (advisory-lock serialized)
// ============================================================================

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..', '..');

function readPostgresPassword(): string {
  try {
    return fs.readFileSync(path.join(repoRoot, 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

describe('hudu asset sync helpers — DB persistence (T226/T227/T228 row layer)', () => {
  const HOOK_TIMEOUT = 60_000;

  let db: Knex;
  let tenantId: string;
  let assetMappingDb: typeof import('../../lib/integrations/hudu/assetMapping');

  beforeAll(async () => {
    assetMappingDb = await vi.importActual('@ee/lib/integrations/hudu/assetMapping');

    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER_ADMIN || 'postgres',
        password: readPostgresPassword(),
        database: process.env.HUDU_TEST_DB_NAME || 'server',
      },
      // Single connection so the advisory lock below is held for the whole file.
      pool: { min: 1, max: 1 },
    });

    await db.raw('select 1');
    // Serialize against the other hudu DB tests (shared lock key, see
    // hudu-company-mappings.integration.test.ts).
    await db.raw("select pg_advisory_lock(hashtext('hudu-db-integration-tests'))");

    if (!(await db.schema.hasTable(HUDU_MAPPING_TABLE))) {
      const migration = require(
        path.resolve(repoRoot, 'server', 'migrations', '20250502173321_create_tenant_external_entity_mappings.cjs')
      );
      await migration.up(db);
      if (await db.schema.hasColumn(HUDU_MAPPING_TABLE, 'tenant_id')) {
        await db.raw(`ALTER TABLE ${HUDU_MAPPING_TABLE} RENAME COLUMN tenant_id TO tenant`);
      }
    }

    tenantId = randomUUID();
    await db('tenants').insert({
      tenant: tenantId,
      client_name: 'Hudu Asset Sync Test Tenant',
      email: `hudu-asset-sync-${tenantId}@example.test`,
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db && tenantId) {
      await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del().catch(() => undefined);
      await db('tenants').where({ tenant: tenantId }).del().catch(() => undefined);
    }
    await db?.raw('select pg_advisory_unlock_all()').catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId }).del();
  });

  it('T226: setHuduAssetMappingStale merges stale both ways, preserving every other metadata key', async () => {
    const created = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: randomUUID(),
      huduAssetId: 601,
      huduCompanyId: 101,
      metadata: {
        hudu_asset_name: 'EC-WS-001',
        asset_layout_id: 7,
        asset_layout_name: 'Computer Assets',
        primary_serial: 'SN-EC-1001',
        url: 'https://hudu.example.com/a/601',
      },
    });
    const mappingId = (created as { mapping: { id: string } }).mapping.id;

    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { huduAssetId: 601 }, true)).toBe(1);
    let [row] = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId });
    expect(row.metadata).toEqual({
      hudu_asset_name: 'EC-WS-001',
      hudu_company_id: '101',
      asset_layout_id: 7,
      asset_layout_name: 'Computer Assets',
      primary_serial: 'SN-EC-1001',
      url: 'https://hudu.example.com/a/601',
      stale: true,
    });

    // Reappearance clears the flag by mapping id; siblings still intact.
    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { mappingId }, false)).toBe(1);
    [row] = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId });
    expect(row.metadata).toMatchObject({ stale: false, hudu_asset_name: 'EC-WS-001', primary_serial: 'SN-EC-1001' });

    // Null metadata coalesces to an object instead of erroring.
    await db(HUDU_MAPPING_TABLE).insert({
      tenant: tenantId,
      integration_type: 'hudu',
      alga_entity_type: 'asset',
      alga_entity_id: randomUUID(),
      external_entity_id: '602',
      external_realm_id: '101',
      sync_status: 'manual_link',
      metadata: null,
    });
    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { huduAssetId: 602 }, true)).toBe(1);
    const bare = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId, external_entity_id: '602' }).first();
    expect(bare.metadata).toEqual({ stale: true });

    // Misses report 0; missing ref throws; nothing was ever deleted (T227).
    expect(await assetMappingDb.setHuduAssetMappingStale(db, tenantId, { huduAssetId: 999 }, true)).toBe(0);
    expect(await assetMappingDb.setHuduAssetMappingStale(db, randomUUID(), { huduAssetId: 601 }, true)).toBe(0);
    await expect(assetMappingDb.setHuduAssetMappingStale(db, tenantId, {}, true)).rejects.toThrow(
      /requires mappingId or huduAssetId/
    );
    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(2);
  });

  it('T252/T253 row layer: writeHuduAssetAttributes jsonb-merges the Hudu namespace, preserving sibling keys', async () => {
    const clientId = randomUUID();
    await db('clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Hudu Attr Client' });
    try {
      const [asset] = await db('assets')
        .insert({
          tenant: tenantId,
          client_id: clientId,
          asset_type: 'workstation',
          asset_tag: `hudu-attr-${clientId.slice(0, 8)}`,
          name: 'EC-WS-001',
          status: 'active',
          attributes: JSON.stringify({
            acme_namespace: { keep: true },
            hudu_fields: [{ label: 'Old', value: 'x' }],
            hudu_synced_at: '2026-06-10T00:00:00.000Z',
          }),
        })
        .returning('asset_id');

      const at = '2026-06-12T10:00:00.000Z';
      expect(
        await writeHuduAssetAttributes(db, tenantId, asset.asset_id, [{ label: 'Hostname', value: 'EC-WS-001' }], at)
      ).toBe(1);
      let row = await db('assets').where({ tenant: tenantId, asset_id: asset.asset_id }).first();
      // Sibling namespace survives; hudu_fields is replaced wholesale.
      expect(row.attributes).toEqual({
        acme_namespace: { keep: true },
        hudu_fields: [{ label: 'Hostname', value: 'EC-WS-001' }],
        hudu_synced_at: at,
      });

      // Null attributes coalesce to an object instead of erroring.
      await db('assets').where({ tenant: tenantId, asset_id: asset.asset_id }).update({ attributes: null });
      const later = '2026-06-12T11:00:00.000Z';
      expect(await writeHuduAssetAttributes(db, tenantId, asset.asset_id, [], later)).toBe(1);
      row = await db('assets').where({ tenant: tenantId, asset_id: asset.asset_id }).first();
      expect(row.attributes).toEqual({ hudu_fields: [], hudu_synced_at: later });

      // Tenant scoping holds.
      expect(await writeHuduAssetAttributes(db, randomUUID(), asset.asset_id, [], later)).toBe(0);
    } finally {
      await db('assets').where({ tenant: tenantId }).del().catch(() => undefined);
      await db('clients').where({ tenant: tenantId }).del().catch(() => undefined);
    }
  });

  it('T228: touchHuduAssetMappingsSynced stamps last_synced_at on the given rows only', async () => {
    const first = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: randomUUID(),
      huduAssetId: 601,
      huduCompanyId: 101,
    });
    const second = await assetMappingDb.setHuduAssetMappingRow(db, tenantId, {
      assetId: randomUUID(),
      huduAssetId: 602,
      huduCompanyId: 101,
    });
    const firstId = (first as { mapping: { id: string } }).mapping.id;
    const secondId = (second as { mapping: { id: string } }).mapping.id;

    const at = '2026-06-11T12:00:00.000Z';
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, tenantId, [firstId], at)).toBe(1);

    const stamped = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId, id: firstId }).first();
    expect(new Date(stamped.last_synced_at).toISOString()).toBe(at);
    const untouched = await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId, id: secondId }).first();
    expect(untouched.last_synced_at).toBeNull();

    // Empty input is a no-op; tenant scoping holds; rows survive (T227).
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, tenantId, [], at)).toBe(0);
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, randomUUID(), [firstId, secondId], at)).toBe(0);
    expect(await assetMappingDb.touchHuduAssetMappingsSynced(db, tenantId, [firstId, secondId])).toBe(2);
    expect(await db(HUDU_MAPPING_TABLE).where({ tenant: tenantId })).toHaveLength(2);
  });
});

// ============================================================================
// T224/T225 — synced-field updates (unit-mocked)
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
    expect(getHuduCompanyAssetsMock).toHaveBeenCalledWith(CLIENT_1, { refresh: true });
    expect(getHuduAssetMappingRowsMock).toHaveBeenCalledWith(knexCallableMock, TENANT, {
      huduCompanyId: HUDU_COMPANY_ID,
    });

    expect(updateAssetMock).toHaveBeenCalledTimes(1);
    expect(updateAssetMock).toHaveBeenCalledWith(ASSET_1, {
      name: 'EC-WS-001-RENAMED',
      serial_number: 'SN-NEW-1',
    });
    expect(Object.keys(updateAssetMock.mock.calls[0][1]).sort()).toEqual(['name', 'serial_number']);

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 0, stale: 0, syncedAt: expect.any(String) });
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

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 1, stale: 0, syncedAt: expect.any(String) });
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

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 0, stale: 1, syncedAt: expect.any(String) });
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

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 1, stale: 0, syncedAt: expect.any(String) });
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

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 1, stale: 1, syncedAt: expect.any(String) });

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

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 0, stale: 0, syncedAt: expect.any(String) });
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

    expect(result).toEqual({ state: 'ok', updated: 0, unchanged: 1, stale: 0, syncedAt: expect.any(String) });
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

    expect(result).toEqual({ state: 'ok', updated: 1, unchanged: 0, stale: 0, syncedAt: expect.any(String) });
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

  it('rejects when the hudu-integration flag is off (404 semantics)', async () => {
    isEnabledMock.mockResolvedValue(false);
    const { syncHuduClientAssets } = await importActions();

    await expect(syncHuduClientAssets({ clientId: CLIENT_1 })).rejects.toThrow(/disabled for this tenant/);
    expect(getHuduCompanyAssetsMock).not.toHaveBeenCalled();
  });
});
