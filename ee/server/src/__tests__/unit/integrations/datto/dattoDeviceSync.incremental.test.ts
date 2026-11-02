import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, createFakeDattoClient, seedDattoTables, TENANT } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let fakeClient: any;
const ingestCalls: Array<{ snapshot: any; resolvedClientId: any }> = [];
const publishEvent = vi.fn(async () => undefined);
const softwareIngest = vi.fn(async (_args: any) => ({ success: true, items_processed: 0, items_created: 0, items_updated: 0, items_failed: 0 }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db.knex })),
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn.__table(t) }),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => (publishEvent as any)(...args),
}));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => db.tables.rmm_integrations[0]),
  buildDattoClientForTenant: vi.fn(async () => fakeClient),
}));

// Persists the external mapping the way the real service does.
vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: vi.fn(async ({ snapshot, resolvedClientId }: any) => {
    ingestCalls.push({ snapshot, resolvedClientId });
    const mappings = db.tables.tenant_external_entity_mappings;
    const existing = mappings.find((m) => m.external_entity_id === snapshot.externalDeviceId);
    if (existing) {
      existing.metadata = snapshot.metadata;
      const asset = db.tables.assets.find((a) => a.asset_id === existing.alga_entity_id);
      if (asset) asset.agent_status = snapshot.agentStatus;
      return { externalDeviceId: snapshot.externalDeviceId, assetId: existing.alga_entity_id, action: 'updated' };
    }
    const assetId = `asset-${snapshot.externalDeviceId}`;
    db.tables.assets.push({ asset_id: assetId, serial_number: snapshot.serialNumber ?? '', agent_status: snapshot.agentStatus });
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

vi.mock('@ee/lib/integrations/datto/softwareIngest', () => ({
  runDattoRmmSoftwareIngest: (args: any) => softwareIngest(args),
}));

import {
  dattoDeviceChangedSince,
  dattoDeviceNeedsSync,
  runDattoRmmDeviceSync,
} from '@ee/lib/integrations/datto/deviceSync';
import { dattoRmmDeviceSyncStrategy } from '@ee/lib/integrations/datto/deviceSyncStrategy';

const SINCE = new Date('2026-10-19T10:00:00.000Z');
const ms = (iso: string) => Date.parse(iso);

/** An asset + mapping a previous sync left behind for `uid`, with the given connectivity. */
function seedSyncedDevice(uid: string, agentStatus: 'online' | 'offline' = 'online') {
  db.tables.assets.push({ asset_id: `asset-${uid}`, serial_number: '', agent_status: agentStatus });
  db.tables.tenant_external_entity_mappings.push({
    integration_type: 'datto',
    alga_entity_type: 'asset',
    alga_entity_id: `asset-${uid}`,
    external_entity_id: uid,
    external_realm_id: 'site-a',
    metadata: {},
  });
}

const device = (uid: string, overrides: Record<string, unknown> = {}) => ({
  id: 1,
  uid,
  siteUid: 'site-a',
  hostname: uid.toUpperCase(),
  deviceClass: 'device',
  deviceType: { category: 'Desktop' },
  online: true,
  lastSeen: ms('2026-10-19T09:00:00.000Z'),
  lastAuditDate: ms('2026-10-01T00:00:00.000Z'),
  ...overrides,
});

describe('dattoDeviceChangedSince', () => {
  it('passes everything when there is no cursor', () => {
    expect(dattoDeviceChangedSince(device('d') as any)).toBe(true);
  });

  it('includes a device seen at or after the cursor, inclusive at the boundary', () => {
    expect(dattoDeviceChangedSince(device('d', { lastSeen: SINCE.getTime() }) as any, SINCE)).toBe(true);
    expect(dattoDeviceChangedSince(device('d', { lastSeen: SINCE.getTime() + 1 }) as any, SINCE)).toBe(true);
    expect(dattoDeviceChangedSince(device('d', { lastSeen: SINCE.getTime() - 1 }) as any, SINCE)).toBe(false);
  });

  it('includes a device re-audited at or after the cursor even if it was last seen earlier', () => {
    const d = device('d', { lastSeen: ms('2026-10-19T08:00:00.000Z'), lastAuditDate: ms('2026-10-19T10:30:00.000Z') });
    expect(dattoDeviceChangedSince(d as any, SINCE)).toBe(true);
  });

  it('always considers a device with neither timestamp', () => {
    expect(dattoDeviceChangedSince({ uid: 'd', lastSeen: null, lastAuditDate: null } as any, SINCE)).toBe(true);
    expect(dattoDeviceChangedSince({ uid: 'd', lastSeen: 'garbage' } as any, SINCE)).toBe(true);
  });

  it('accepts ISO and numeric-string timestamps', () => {
    expect(dattoDeviceChangedSince({ uid: 'd', lastSeen: '2026-10-19T11:00:00Z' } as any, SINCE)).toBe(true);
    expect(dattoDeviceChangedSince({ uid: 'd', lastSeen: String(SINCE.getTime() - 5) } as any, SINCE)).toBe(false);
  });
});

describe('dattoDeviceNeedsSync', () => {
  const state = (agentStatus: string | null) => ({
    assetId: 'a1',
    storedLastAuditDate: null,
    serialNumber: null,
    agentStatus,
    assetType: null,
    syncHash: null,
    carriedMetadata: {},
  });

  it('is true inside the window regardless of state', () => {
    expect(dattoDeviceNeedsSync(device('d', { lastSeen: SINCE.getTime() }) as any, state('online'), SINCE)).toBe(true);
  });

  it('compares connectivity for a stale device with an asset', () => {
    expect(dattoDeviceNeedsSync(device('d') as any, state('online'), SINCE)).toBe(false);
    expect(dattoDeviceNeedsSync(device('d', { online: false }) as any, state('online'), SINCE)).toBe(true);
    expect(dattoDeviceNeedsSync(device('d') as any, state(null), SINCE)).toBe(true);
    // A deleted device is retired as offline, so offline already agrees.
    expect(dattoDeviceNeedsSync(device('d', { deleted: true, online: true }) as any, state('offline'), SINCE)).toBe(false);
  });

  it('is true for a stale device with no asset, unless it is deleted', () => {
    expect(dattoDeviceNeedsSync(device('d') as any, undefined, SINCE)).toBe(true);
    expect(dattoDeviceNeedsSync(device('d', { deleted: true }) as any, undefined, SINCE)).toBe(false);
  });
});

describe('runDattoRmmDeviceSync (incremental)', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    softwareIngest.mockClear();
    publishEvent.mockClear();
    db = createFakeDb(seedDattoTables());
  });

  it('ingests only devices seen or audited since the cursor', async () => {
    seedSyncedDevice('stale');
    const { client } = createFakeDattoClient({
      'site-a': [[
        device('stale'),
        device('seen', { lastSeen: ms('2026-10-19T11:00:00.000Z') }),
        device('audited', { lastAuditDate: ms('2026-10-19T10:15:00.000Z') }),
        { uid: 'no-timestamps', siteUid: 'site-a' },
      ]],
    });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental', since: SINCE });

    expect(result).toMatchObject({ success: true, items_processed: 3 });
    expect(ingestCalls.map((c) => c.snapshot.externalDeviceId).sort()).toEqual(['audited', 'no-timestamps', 'seen']);
  });

  it('also ingests a stale device whose connectivity no longer matches the asset', async () => {
    // lastSeen froze when it went offline, so only the status comparison can see it.
    seedSyncedDevice('went-offline', 'online');
    seedSyncedDevice('still-offline', 'offline');
    const { client } = createFakeDattoClient({
      'site-a': [[
        device('went-offline', { online: false }),
        device('still-offline', { online: false }),
      ]],
    });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental', since: SINCE });

    expect(ingestCalls.map((c) => c.snapshot.externalDeviceId)).toEqual(['went-offline']);
    expect(ingestCalls[0].snapshot.agentStatus).toBe('offline');
    expect(db.tables.assets.find((a) => a.asset_id === 'asset-went-offline')?.agent_status).toBe('offline');

    // The asset now agrees with Datto, so the next incremental run leaves it alone.
    ingestCalls.length = 0;
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental', since: SINCE });
    expect(ingestCalls).toHaveLength(0);
  });

  it('also ingests a stale device that has no asset yet, but not a deleted one', async () => {
    const { client } = createFakeDattoClient({
      'site-a': [[device('brand-new'), device('gone', { deleted: true })]],
    });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental', since: SINCE });

    expect(ingestCalls.map((c) => c.snapshot.externalDeviceId)).toEqual(['brand-new']);
  });

  it('does not touch the full-sync marker', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('seen', { lastSeen: ms('2026-10-19T11:00:00.000Z') })]] });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental', since: SINCE });

    expect(db.tables.rmm_integrations[0].last_full_sync_at).toBeUndefined();
    expect(db.tables.rmm_integrations[0].last_sync_at).toBeInstanceOf(Date);
  });
});

describe('software ingest after sync', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    softwareIngest.mockClear();
  });

  const run = async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('d1', { lastSeen: ms('2026-10-19T11:00:00.000Z') })]] });
    fakeClient = client;
    return runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'incremental', since: SINCE });
  };

  it('is skipped unless softwareIngestOnSync is enabled', async () => {
    db = createFakeDb(seedDattoTables());
    await run();
    expect(softwareIngest).not.toHaveBeenCalled();
  });

  it('runs for the processed devices when enabled', async () => {
    db = createFakeDb(seedDattoTables());
    db.tables.rmm_integrations[0].settings = { softwareIngestOnSync: true };
    await run();
    expect(softwareIngest).toHaveBeenCalledWith({ tenant: TENANT, deviceUids: ['d1'] });
  });

  it('never fails the device sync when the ingest throws', async () => {
    db = createFakeDb(seedDattoTables());
    db.tables.rmm_integrations[0].settings = JSON.stringify({ softwareIngestOnSync: true });
    softwareIngest.mockRejectedValueOnce(new Error('software audit exploded'));
    const result = await run();
    expect(result.success).toBe(true);
    expect(softwareIngest).toHaveBeenCalledTimes(1);
  });
});

describe('dattoRmmDeviceSyncStrategy', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    db = createFakeDb(seedDattoTables());
  });

  it('returns the processed count on success', async () => {
    seedSyncedDevice('stale');
    const { client } = createFakeDattoClient({
      'site-a': [[device('seen', { lastSeen: ms('2026-10-19T11:00:00.000Z') }), device('stale')]],
    });
    fakeClient = client;

    await expect(
      dattoRmmDeviceSyncStrategy.syncDevicesIncremental({ tenantId: TENANT, integrationId: 'integration_1', since: SINCE })
    ).resolves.toEqual({ devicesProcessed: 1 });
  });

  it('throws when the run reports success=false, so the job cursor does not advance', async () => {
    fakeClient = null; // no credentials -> the engine returns success: false

    await expect(
      dattoRmmDeviceSyncStrategy.syncDevicesIncremental({ tenantId: TENANT, integrationId: 'integration_1', since: SINCE })
    ).rejects.toThrow(/Datto RMM incremental device sync failed: .*credentials are not configured/i);
  });
});
