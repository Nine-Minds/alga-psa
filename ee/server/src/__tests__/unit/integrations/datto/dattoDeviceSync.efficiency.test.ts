import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, createFakeDattoClient, seedDattoTables, TENANT, INTEGRATION_ID } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let fakeClient: any;
const ingestCalls: Array<{ snapshot: any; resolvedClientId: any }> = [];
const touchCalls: any[][] = [];

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db.knex })),
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn.__table(t) }),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
}));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => db.tables.rmm_integrations[0]),
  buildDattoClientForTenant: vi.fn(async () => fakeClient),
}));

// Persists the external mapping (metadata included) the way the real service does.
vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: vi.fn(async ({ snapshot, resolvedClientId }: any) => {
    ingestCalls.push({ snapshot, resolvedClientId });
    const mappings = db.tables.tenant_external_entity_mappings;
    const existing = mappings.find((m) => m.external_entity_id === snapshot.externalDeviceId);
    if (existing) {
      existing.metadata = snapshot.metadata;
      return { externalDeviceId: snapshot.externalDeviceId, assetId: existing.alga_entity_id, action: 'updated' };
    }
    const assetId = `asset-${snapshot.externalDeviceId}`;
    db.tables.assets.push({
      asset_id: assetId,
      asset_type: snapshot.assetType,
      serial_number: snapshot.serialNumber ?? '',
      agent_status: snapshot.agentStatus,
    });
    mappings.push({
      integration_type: snapshot.provider,
      alga_entity_type: 'asset',
      alga_entity_id: assetId,
      external_entity_id: snapshot.externalDeviceId,
      external_realm_id: snapshot.externalScopeId,
      metadata: snapshot.metadata,
    });
    return { externalDeviceId: snapshot.externalDeviceId, assetId, action: 'created' };
  }),
}));

vi.mock('@ee/lib/integrations/datto/deviceLiveness', () => ({
  touchDattoDeviceLiveness: vi.fn(async (_knex: any, _tenant: string, rows: any[]) => {
    touchCalls.push(rows);
  }),
}));

import {
  chooseDattoDeviceListing,
  dattoSnapshotSyncHash,
  runDattoRmmDeviceSync,
} from '@ee/lib/integrations/datto/deviceSync';
import { mapDattoDeviceToSnapshot } from '@ee/lib/integrations/datto/mappers';

const device = (uid: string, siteUid: string, overrides: Record<string, unknown> = {}) => ({
  id: Number(uid.replace(/\D/g, '')) || 1,
  uid,
  siteUid,
  hostname: uid.toUpperCase(),
  deviceClass: 'device',
  deviceType: { category: 'Desktop' },
  online: true,
  lastSeen: Date.parse('2026-10-19T11:00:00.000Z'),
  lastReboot: Date.parse('2026-10-18T00:00:00.000Z'),
  lastAuditDate: Date.parse('2026-10-18T00:00:00.000Z'),
  ...overrides,
});

const ctx = { clientId: 'client-a', assignmentMode: 'suggest' };
const snap = (d: any, now = new Date('2026-10-19T12:00:00.000Z')) =>
  mapDattoDeviceToSnapshot(d, { integrationId: INTEGRATION_ID, siteUid: d.siteUid, now });

describe('dattoSnapshotSyncHash', () => {
  it('ignores the readings that move on every poll', () => {
    const a = snap(device('dev-1', 'site-a'));
    const b = snap(device('dev-1', 'site-a', { lastSeen: Date.parse('2026-10-19T11:55:00.000Z') }), new Date('2026-10-19T13:00:00.000Z'));
    expect(b.extension?.uptimeSeconds).not.toBe(a.extension?.uptimeSeconds);
    expect(dattoSnapshotSyncHash(b, ctx)).toBe(dattoSnapshotSyncHash(a, ctx));
  });

  it('ignores a syncHash already stamped on the metadata', () => {
    const a = snap(device('dev-1', 'site-a'));
    const b = snap(device('dev-1', 'site-a'));
    b.metadata!.syncHash = 'previous';
    expect(dattoSnapshotSyncHash(b, ctx)).toBe(dattoSnapshotSyncHash(a, ctx));
  });

  it('changes with the device content, the mapped client and the people mode', () => {
    const base = dattoSnapshotSyncHash(snap(device('dev-1', 'site-a')), ctx);
    expect(dattoSnapshotSyncHash(snap(device('dev-1', 'site-a', { lastLoggedInUser: 'bob' })), ctx)).not.toBe(base);
    expect(dattoSnapshotSyncHash(snap(device('dev-1', 'site-a')), { ...ctx, clientId: 'client-b' })).not.toBe(base);
    expect(dattoSnapshotSyncHash(snap(device('dev-1', 'site-a')), { ...ctx, assignmentMode: 'auto' })).not.toBe(base);
  });

  it('ignores audit-derived hardware, which only some runs carry', () => {
    const d = device('dev-1', 'site-a');
    const plain = mapDattoDeviceToSnapshot(d, { integrationId: INTEGRATION_ID, siteUid: 'site-a' });
    const audited = mapDattoDeviceToSnapshot(d, {
      integrationId: INTEGRATION_ID,
      siteUid: 'site-a',
      hardware: { serialNumber: 'SN1', manufacturer: 'Dell', model: 'X', cpuModel: 'i7', cpuCores: 8, ramGb: 16, diskUsage: null },
    });
    expect(dattoSnapshotSyncHash(audited, ctx)).toBe(dattoSnapshotSyncHash(plain, ctx));
  });

  it('is independent of key order', () => {
    const a = snap(device('dev-1', 'site-a', { udf: { udf1: 'x', udf2: 'y' } }));
    const b = snap(device('dev-1', 'site-a', { udf: { udf2: 'y', udf1: 'x' } }));
    expect(dattoSnapshotSyncHash(b, ctx)).toBe(dattoSnapshotSyncHash(a, ctx));
  });
});

describe('chooseDattoDeviceListing', () => {
  const counts = (...values: Array<number | null>) => values.map((deviceCount) => ({ deviceCount }));

  it('walks per site for a single synced site', () => {
    expect(chooseDattoDeviceListing(counts(10), counts(10, 10, 10))).toBe('site');
  });

  it('walks per site while any device count is unknown', () => {
    expect(chooseDattoDeviceListing(counts(10, 10, 10), counts(10, 10, null))).toBe('site');
  });

  it('uses the account listing when it takes fewer pages', () => {
    // 3 synced sites = 3 calls; 30 devices account-wide = 1 call.
    expect(chooseDattoDeviceListing(counts(10, 10, 10), counts(10, 10, 10))).toBe('account');
  });

  it('keeps the per-site walk when unsynced sites dominate the account', () => {
    // 2 synced sites = 2 calls; 2,020 devices account-wide = 9 calls.
    expect(chooseDattoDeviceListing(counts(10, 10), counts(10, 10, 2000))).toBe('site');
  });
});

describe('runDattoRmmDeviceSync efficiency', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    touchCalls.length = 0;
    db = createFakeDb(seedDattoTables());
  });

  it('skips unchanged devices on an incremental run and refreshes their liveness in bulk', async () => {
    ({ client: fakeClient } = createFakeDattoClient({ 'site-a': [[device('dev-1', 'site-a'), device('dev-2', 'site-a')]] }));
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental' });
    expect(ingestCalls).toHaveLength(2);
    expect(ingestCalls[0]!.snapshot.metadata.syncHash).toMatch(/^[0-9a-f]{32}$/);

    // dev-1 only checked in again; dev-2 has a new logged-in user.
    ingestCalls.length = 0;
    ({ client: fakeClient } = createFakeDattoClient({
      'site-a': [[
        device('dev-1', 'site-a', { lastSeen: Date.parse('2026-10-19T11:59:00.000Z') }),
        device('dev-2', 'site-a', { lastLoggedInUser: 'alice' }),
      ]],
    }));
    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental' });

    expect(result).toMatchObject({ success: true, items_processed: 2, items_updated: 1 });
    expect(ingestCalls.map((c) => c.snapshot.externalDeviceId)).toEqual(['dev-2']);
    expect(touchCalls).toEqual([[
      expect.objectContaining({ assetId: 'asset-dev-1', assetType: 'workstation', lastSeenAt: '2026-10-19T11:59:00.000Z' }),
    ]]);
  });

  it('re-ingests every device on a full run', async () => {
    ({ client: fakeClient } = createFakeDattoClient({ 'site-a': [[device('dev-1', 'site-a')]] }));
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental' });
    ingestCalls.length = 0;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(ingestCalls).toHaveLength(1);
    expect(touchCalls).toHaveLength(0);
  });

  it('does not walk a site Datto no longer lists', async () => {
    db.tables.rmm_organization_mappings.push({
      integration_id: INTEGRATION_ID,
      external_organization_id: 'site-gone',
      client_id: 'client-g',
      auto_sync_assets: true,
      metadata: { missing_in_datto: true },
    });
    const { client, pageCalls } = createFakeDattoClient({ 'site-a': [[device('dev-1', 'site-a')]] });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT });

    expect(pageCalls).toEqual(['site-a']);
    expect(result.success).toBe(true);
  });

  describe('account-wide listing', () => {
    beforeEach(() => {
      // Three synced sites with small, known device counts: one account page beats three site walks.
      db = createFakeDb(seedDattoTables({
        rmm_organization_mappings: [
          { integration_id: INTEGRATION_ID, external_organization_id: 'site-a', external_organization_name: 'A', client_id: 'client-a', auto_sync_assets: true, metadata: { device_count: 1 } },
          { integration_id: INTEGRATION_ID, external_organization_id: 'site-b', external_organization_name: 'B', client_id: 'client-b', auto_sync_assets: true, metadata: { device_count: 1 } },
          { integration_id: INTEGRATION_ID, external_organization_id: 'site-c', external_organization_name: 'C', client_id: 'client-c', auto_sync_assets: true, metadata: { device_count: 1 } },
          // Not synced: its devices come back in the account listing and must be ignored.
          { integration_id: INTEGRATION_ID, external_organization_id: 'site-x', client_id: null, auto_sync_assets: true, metadata: { device_count: 1 } },
        ],
      }));
    });

    it('reads all devices in one walk and ingests only those on synced sites, under their own site', async () => {
      const { client, pageCalls } = createFakeDattoClient({
        'site-a': [[device('dev-a', 'site-a')]],
        'site-b': [[device('dev-b', 'site-b')]],
        'site-c': [[device('dev-c', 'site-c')]],
        'site-x': [[device('dev-x', 'site-x')]],
      });
      client.accountPages = [[device('dev-a', 'site-a'), device('dev-b', 'site-b'), device('dev-c', 'site-c'), device('dev-x', 'site-x')]];
      fakeClient = client;

      const result = await runDattoRmmDeviceSync({ tenant: TENANT });

      expect(pageCalls).toEqual(['<account>']);
      expect(result).toMatchObject({ success: true, items_created: 3 });
      expect(ingestCalls.map((c) => [c.snapshot.externalDeviceId, c.resolvedClientId, c.snapshot.externalScopeId])).toEqual([
        ['dev-a', 'client-a', 'site-a'],
        ['dev-b', 'client-b', 'site-b'],
        ['dev-c', 'client-c', 'site-c'],
      ]);
    });

    it('falls back to the per-site walk when the account listing fails before its first page', async () => {
      const { client, pageCalls } = createFakeDattoClient({
        'site-a': [[device('dev-a', 'site-a')]],
        'site-b': [[device('dev-b', 'site-b')]],
        'site-c': [[device('dev-c', 'site-c')]],
      });
      client.accountListingError = Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403 } });
      fakeClient = client;

      const result = await runDattoRmmDeviceSync({ tenant: TENANT });

      expect(pageCalls).toEqual(['<account>', 'site-a', 'site-b', 'site-c']);
      expect(result).toMatchObject({ success: true, items_created: 3 });
    });

    it('walks per site when asked for specific sites', async () => {
      const { client, pageCalls } = createFakeDattoClient({
        'site-a': [[device('dev-a', 'site-a')]],
        'site-b': [[device('dev-b', 'site-b')]],
      });
      fakeClient = client;

      await runDattoRmmDeviceSync({ tenant: TENANT }, { siteUids: ['site-a', 'site-b'] });

      expect(pageCalls).toEqual(['site-a', 'site-b']);
    });
  });
});
