import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, createFakeDattoClient, seedDattoTables, TENANT } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let fakeClient: any;
const ingestCalls: Array<{ snapshot: any; resolvedClientId: any }> = [];
const buildClientCalls: any[][] = [];
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
  buildDattoClientForTenant: vi.fn(async (...args: any[]) => {
    buildClientCalls.push(args);
    return fakeClient;
  }),
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

import { syncDattoSingleDeviceForTenant } from '@ee/lib/integrations/datto/syncSingleDevice';

const rawDevice = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  uid: 'dev-9',
  siteUid: 'site-a',
  hostname: 'HOST9',
  deviceClass: 'device',
  deviceType: { category: 'Laptop' },
  online: true,
  lastSeen: Date.parse('2026-10-19T11:00:00.000Z'),
  lastAuditDate: Date.parse('2026-10-18T00:00:00.000Z'),
  ...overrides,
});

function singleDeviceClient(device: any, audit: any = { bios: { serialNumber: 'SN-9' } }) {
  const client: any = {
    requestCount: 0,
    getDevice: vi.fn(async () => device),
    getDeviceAudit: vi.fn(async () => audit),
    getPrinterAudit: vi.fn(async () => audit),
    getEsxiHostAudit: vi.fn(async () => audit),
  };
  return client;
}

describe('syncDattoSingleDeviceForTenant', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    buildClientCalls.length = 0;
    db = createFakeDb(seedDattoTables());
  });

  it('always fetches the audit and ingests with the site mapping client', async () => {
    fakeClient = singleDeviceClient(rawDevice());

    const result = await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });

    expect(result).toEqual({ updated: true, assetId: 'asset-dev-9' });
    expect(fakeClient.getDeviceAudit).toHaveBeenCalledWith('dev-9');
    expect(ingestCalls[0].resolvedClientId).toBe('client-a');
    expect(ingestCalls[0].snapshot.serialNumber).toBe('SN-9');

    // A second refresh fetches the audit again even though lastAuditDate is unchanged.
    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });
    expect(fakeClient.getDeviceAudit).toHaveBeenCalledTimes(2);
  });

  it('returns updated:false for a device whose site is not mapped to a client', async () => {
    fakeClient = singleDeviceClient(rawDevice({ siteUid: 'site-c' }));
    expect(await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' })).toEqual({ updated: false });

    fakeClient = singleDeviceClient(rawDevice({ siteUid: 'unknown-site' }));
    expect(await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' })).toEqual({ updated: false });
    expect(ingestCalls).toHaveLength(0);
  });

  it('still refreshes the device when the API user may not read audits', async () => {
    const { DattoRmmPermissionError } = await import('@ee/lib/integrations/datto/dattoApiClient');
    fakeClient = singleDeviceClient(rawDevice());
    fakeClient.getDeviceAudit = vi.fn(async () => {
      throw new DattoRmmPermissionError('denied', { status: 403, path: '/v2/audit/device/dev-9' });
    });

    const result = await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });
    expect(result.updated).toBe(true);
    expect('ramGb' in ingestCalls[0].snapshot.extension).toBe(false);
  });

  it('creates a new asset only when the site is mapped to a client and has auto-sync on', async () => {
    fakeClient = singleDeviceClient(rawDevice());
    expect(await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' })).toEqual({ updated: true, assetId: 'asset-dev-9' });
    expect(db.tables.assets).toHaveLength(1);
  });

  it('does not create an asset for a site with auto-sync off, nor fetch its audit', async () => {
    // site-b is mapped to client-b but auto_sync_assets is false.
    fakeClient = singleDeviceClient(rawDevice({ siteUid: 'site-b' }));

    expect(await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' })).toEqual({ updated: false });

    expect(ingestCalls).toHaveLength(0);
    expect(db.tables.assets).toHaveLength(0);
    expect(fakeClient.getDeviceAudit).not.toHaveBeenCalled();
  });

  it('still refreshes an existing asset after auto-sync was turned off for its site', async () => {
    fakeClient = singleDeviceClient(rawDevice());
    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });
    db.tables.rmm_organization_mappings.find((m) => m.external_organization_id === 'site-a')!.auto_sync_assets = false;

    const result = await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });

    expect(result).toEqual({ updated: true, assetId: 'asset-dev-9' });
    expect(ingestCalls).toHaveLength(2);
    expect(db.tables.assets).toHaveLength(1);
  });

  it('leaves an existing asset alone once its site no longer maps to a client', async () => {
    fakeClient = singleDeviceClient(rawDevice());
    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });
    db.tables.rmm_organization_mappings.find((m) => m.external_organization_id === 'site-a')!.client_id = null;

    expect(await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' })).toEqual({ updated: false });
    expect(ingestCalls).toHaveLength(1);
  });

  it('carries the software ingest marker across a refresh and sends the site name as location', async () => {
    fakeClient = singleDeviceClient(rawDevice());
    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });
    db.tables.tenant_external_entity_mappings[0].metadata.softwareIngestedAuditDate = '2026-10-18T00:00:00.000Z';

    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });

    expect(ingestCalls[1].snapshot.metadata.softwareIngestedAuditDate).toBe('2026-10-18T00:00:00.000Z');
    expect(db.tables.tenant_external_entity_mappings[0].metadata.softwareIngestedAuditDate).toBe('2026-10-18T00:00:00.000Z');
  });

  it('keeps the prior audit marker when the audit may not be read, so a bulk sync retries it', async () => {
    const { DattoRmmPermissionError } = await import('@ee/lib/integrations/datto/dattoApiClient');
    fakeClient = singleDeviceClient(rawDevice({ lastAuditDate: Date.parse('2026-10-17T00:00:00.000Z') }));
    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });
    expect(db.tables.tenant_external_entity_mappings[0].metadata.lastAuditDate).toBe('2026-10-17T00:00:00.000Z');

    fakeClient = singleDeviceClient(rawDevice({ lastAuditDate: Date.parse('2026-10-18T00:00:00.000Z') }));
    fakeClient.getDeviceAudit = vi.fn(async () => {
      throw new DattoRmmPermissionError('denied', { status: 403, path: '/v2/audit/device/dev-9' });
    });
    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });

    expect(db.tables.tenant_external_entity_mappings[0].metadata.lastAuditDate).toBe('2026-10-17T00:00:00.000Z');
  });

  it('stamps the same sync hash the bulk sync would, so its next incremental run skips the device', async () => {
    const { dattoSnapshotSyncHash } = await import('@ee/lib/integrations/datto/deviceSync');
    db.tables.rmm_organization_mappings.find((m) => m.external_organization_id === 'site-a')!.contact_assignment_mode = 'site';
    fakeClient = singleDeviceClient(rawDevice());

    await syncDattoSingleDeviceForTenant({ tenant: TENANT, deviceUid: 'dev-9' });

    const { snapshot, resolvedClientId } = ingestCalls[0];
    expect(resolvedClientId).toBe('client-a');
    expect(snapshot.metadata.syncHash).toBe(
      dattoSnapshotSyncHash(snapshot, { clientId: 'client-a', assignmentMode: 'site' })
    );
  });

  it('passes the caller retry budget to the client alongside allowInactive', async () => {
    fakeClient = singleDeviceClient(rawDevice());

    await syncDattoSingleDeviceForTenant({
      tenant: TENANT,
      deviceUid: 'dev-9',
      clientOptions: { maxRetries: 1, maxRetryAfterMs: 5000 },
    });

    expect(buildClientCalls[0]).toEqual([TENANT, { allowInactive: true, maxRetries: 1, maxRetryAfterMs: 5000 }]);
  });

  it('shows the reconnect-required message as written in sync errors', async () => {
    const { dattoErrorMessage } = await import('@ee/lib/integrations/datto/deviceSync');
    const { DattoRmmReconnectRequiredError } = await import('@ee/lib/integrations/datto/dattoApiClient');
    expect(dattoErrorMessage(new DattoRmmReconnectRequiredError('rejected.'))).toBe(
      'Datto RMM needs to be reconnected: rejected.'
    );
  });
});
