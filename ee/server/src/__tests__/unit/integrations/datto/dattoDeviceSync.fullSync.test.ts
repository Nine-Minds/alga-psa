import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, createFakeDattoClient, seedDattoTables, TENANT } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let fakeClient: any;
const ingestCalls: Array<{ snapshot: any; resolvedClientId: any }> = [];
const publishEvent = vi.fn(async () => undefined);

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
      return { externalDeviceId: snapshot.externalDeviceId, assetId: existing.alga_entity_id, action: 'updated' };
    }
    const assetId = `asset-${snapshot.externalDeviceId}`;
    db.tables.assets.push({ asset_id: assetId, serial_number: snapshot.serialNumber ?? '' });
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

import { runDattoRmmDeviceSync } from '@ee/lib/integrations/datto/deviceSync';

const device = (uid: string, siteUid: string, overrides: Record<string, unknown> = {}) => ({
  id: Number(uid.replace(/\D/g, '')) || 1,
  uid,
  siteUid,
  hostname: uid.toUpperCase(),
  deviceClass: 'device',
  deviceType: { category: 'Desktop' },
  online: true,
  lastSeen: Date.parse('2026-10-19T11:00:00.000Z'),
  lastAuditDate: Date.parse('2026-10-18T00:00:00.000Z'),
  ...overrides,
});

describe('runDattoRmmDeviceSync (full)', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    publishEvent.mockClear();
    db = createFakeDb(seedDattoTables());
  });

  it('only walks auto-sync sites that have a mapped client', async () => {
    const { client, pageCalls } = createFakeDattoClient({
      'site-a': [[device('dev-1', 'site-a')]],
      'site-b': [[device('dev-2', 'site-b')]],
      'site-c': [[device('dev-3', 'site-c')]],
    });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(result).toMatchObject({ success: true, items_processed: 1, items_created: 1, items_updated: 0, items_failed: 0 });
    expect(pageCalls).toEqual(['site-a']);
    expect(ingestCalls).toHaveLength(1);
    expect(ingestCalls[0].resolvedClientId).toBe('client-a');
    expect(ingestCalls[0].snapshot.externalScopeId).toBe('site-a');
  });

  it('links each device in tenant_external_entity_mappings as datto with id and audit metadata', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('dev-1', 'site-a'), device('dev-7', 'site-a')]] });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    const mappings = db.tables.tenant_external_entity_mappings;
    expect(mappings.map((m) => m.external_entity_id).sort()).toEqual(['dev-1', 'dev-7']);
    expect(mappings.every((m) => m.integration_type === 'datto' && m.alga_entity_type === 'asset')).toBe(true);
    expect(mappings.find((m) => m.external_entity_id === 'dev-7')?.metadata).toMatchObject({
      datto_device_id: 7,
      lastAuditDate: '2026-10-18T00:00:00.000Z',
    });
  });

  it('streams ingestion across pages', async () => {
    const { client } = createFakeDattoClient({
      'site-a': [[device('dev-1', 'site-a')], [device('dev-2', 'site-a')], [device('dev-3', 'site-a')]],
    });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(result.items_processed).toBe(3);
    expect(ingestCalls).toHaveLength(3);
  });

  it('leaves assets whose device vanished from the listing untouched', async () => {
    const pages: Record<string, any[][]> = { 'site-a': [[device('dev-1', 'site-a'), device('dev-2', 'site-a')]] };
    const { client } = createFakeDattoClient(pages);
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(db.tables.assets).toHaveLength(2);

    pages['site-a'] = [[device('dev-1', 'site-a')]];
    ingestCalls.length = 0;
    const second = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(second).toMatchObject({ success: true, items_processed: 1, items_updated: 1 });
    expect(ingestCalls.map((c) => c.snapshot.externalDeviceId)).toEqual(['dev-1']);
    expect(db.tables.assets).toHaveLength(2);
    expect(db.tables.tenant_external_entity_mappings).toHaveLength(2);
    // Nothing deleted-state was written for the vanished device.
    expect(ingestCalls.some((c) => c.snapshot.lifecycleState === 'tombstoned')).toBe(false);
  });

  it('honours a siteUids filter, including a site with auto-sync off', async () => {
    const { client, pageCalls } = createFakeDattoClient({
      'site-a': [[device('dev-1', 'site-a')]],
      'site-b': [[device('dev-2', 'site-b')]],
      'site-c': [[device('dev-3', 'site-c')]],
    });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full', siteUids: ['site-b', 'site-c'] });

    // site-c has no client, so it is still skipped.
    expect(pageCalls).toEqual(['site-b']);
    expect(db.tables.rmm_integrations[0].last_full_sync_at).toBeUndefined();
  });

  it('collects per-device ingest failures without aborting the run', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('dev-1', 'site-a'), device('dev-2', 'site-a')]] });
    fakeClient = client;
    const { ingestNormalizedRmmDeviceSnapshot } = await import('@alga-psa/shared/rmm/sharedAssetIngestionService');
    (ingestNormalizedRmmDeviceSnapshot as any).mockImplementationOnce(async () => {
      throw new Error('constraint violation with secret-token-123');
    });

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(result.success).toBe(true);
    expect(result.items_failed).toBe(1);
    expect(result.items_created).toBe(1);
    expect(JSON.stringify(result.errors)).not.toContain('secret-token-123');
    expect(db.tables.rmm_integrations[0].sync_status).toBe('completed');
    expect(db.tables.rmm_integrations[0].sync_error).toContain('dev-1');
  });

  it('records sync status and publishes start and completion events', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('dev-1', 'site-a')]] });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT, actorUserId: 'user-1' }, { syncType: 'full' });

    const integration = db.tables.rmm_integrations[0];
    expect(integration.sync_status).toBe('completed');
    expect(integration.sync_error).toBeNull();
    expect(integration.last_sync_at).toBeInstanceOf(Date);
    expect(integration.last_full_sync_at).toBeInstanceOf(Date);
    const events = publishEvent.mock.calls.map((c: any) => [c[0].eventType, c[0].payload.syncType, c[0].payload.provider]);
    expect(events).toEqual([
      ['RMM_SYNC_STARTED', 'devices', 'datto'],
      ['RMM_SYNC_COMPLETED', 'devices', 'datto'],
    ]);
  });

  it('fails cleanly, with a safe message, when the integration has no credentials', async () => {
    fakeClient = null;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credentials are not configured/i);
    expect(db.tables.rmm_integrations[0].sync_status).toBe('error');
    expect(publishEvent.mock.calls.map((c: any) => c[0].eventType)).toContain('RMM_SYNC_FAILED');
  });

  it('reports a missing integration', async () => {
    db = createFakeDb({ ...seedDattoTables(), rmm_integrations: [] });
    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/not configured/i);
  });
});
