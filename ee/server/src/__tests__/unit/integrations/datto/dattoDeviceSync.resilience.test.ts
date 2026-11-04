import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, createFakeDattoClient, seedDattoTables, TENANT } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let fakeClient: any;
const ingestCalls: Array<{ snapshot: any; resolvedClientId: any }> = [];
const softwareListCalls: string[] = [];

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db.knex })),
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn.__table(t) }),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined) }));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => db.tables.rmm_integrations[0]),
  buildDattoClientForTenant: vi.fn(async () => fakeClient),
}));

vi.mock('@ee/lib/integrations/datto/softwareInventory', () => ({
  syncAssetSoftwareList: vi.fn(async (_knex: any, _tenant: string, _assetId: string, list: any[]) => ({
    installed: list.length,
    uninstalled: 0,
    catalogCreated: list.length,
  })),
}));

// Mirrors the real service where it matters here: the mapping's metadata is
// replaced wholesale by the snapshot's, and location is written as given
// (blank when absent).
vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: vi.fn(async ({ snapshot, resolvedClientId }: any) => {
    ingestCalls.push({ snapshot, resolvedClientId });
    const mappings = db.tables.tenant_external_entity_mappings;
    const existing = mappings.find((m) => m.external_entity_id === snapshot.externalDeviceId);
    if (existing) {
      existing.metadata = snapshot.metadata ?? {};
      const asset = db.tables.assets.find((a) => a.asset_id === existing.alga_entity_id);
      if (asset) Object.assign(asset, { location: snapshot.location ?? '', agent_status: snapshot.agentStatus });
      return { externalDeviceId: snapshot.externalDeviceId, assetId: existing.alga_entity_id, action: 'updated' };
    }
    const assetId = `asset-${snapshot.externalDeviceId}`;
    db.tables.assets.push({
      asset_id: assetId,
      serial_number: snapshot.serialNumber ?? '',
      location: snapshot.location ?? '',
      agent_status: snapshot.agentStatus,
    });
    mappings.push({
      id: `map-${snapshot.externalDeviceId}`,
      integration_type: snapshot.provider,
      alga_entity_type: 'asset',
      alga_entity_id: assetId,
      external_entity_id: snapshot.externalDeviceId,
      external_realm_id: snapshot.externalScopeId,
      metadata: snapshot.metadata ?? {},
    });
    return { externalDeviceId: snapshot.externalDeviceId, assetId, action: 'created' };
  }),
}));

import { runDattoRmmDeviceSync } from '@ee/lib/integrations/datto/deviceSync';
import { runDattoRmmSoftwareIngest } from '@ee/lib/integrations/datto/softwareIngest';
import { DattoRmmAuthError } from '@ee/lib/integrations/datto/dattoApiClient';

const device = (uid: string, siteUid = 'site-a', overrides: Record<string, unknown> = {}) => ({
  id: 1,
  uid,
  siteUid,
  siteName: 'Acme HQ',
  hostname: uid.toUpperCase(),
  deviceClass: 'device',
  deviceType: { category: 'Desktop' },
  online: true,
  lastSeen: Date.parse('2026-10-19T11:00:00.000Z'),
  lastAuditDate: Date.parse('2026-10-18T00:00:00.000Z'),
  ...overrides,
});

function withSoftware(client: any) {
  client.listDeviceSoftware = vi.fn(async (uid: string) => {
    softwareListCalls.push(uid);
    return [{ name: 'App', version: '1.0' }];
  });
  return client;
}

const httpError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status} for https://secret.example/token-abc`), {
    isAxiosError: true,
    response: { status },
  });

describe('device sync keeps the software ingest marker', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    softwareListCalls.length = 0;
    db = createFakeDb(seedDattoTables());
  });

  it('survives a device sync, so the following software ingest skips the unchanged device', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('dev-1')]] });
    fakeClient = withSoftware(client);

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    await runDattoRmmSoftwareIngest({ tenant: TENANT });
    expect(softwareListCalls).toEqual(['dev-1']);
    const mapping = db.tables.tenant_external_entity_mappings[0];
    expect(mapping.metadata.softwareIngestedAuditDate).toBe('2026-10-18T00:00:00.000Z');

    // The service replaces metadata with the snapshot's; the marker must ride along.
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(ingestCalls.at(-1)!.snapshot.metadata.softwareIngestedAuditDate).toBe('2026-10-18T00:00:00.000Z');
    expect(mapping.metadata.softwareIngestedAuditDate).toBe('2026-10-18T00:00:00.000Z');

    softwareListCalls.length = 0;
    await runDattoRmmSoftwareIngest({ tenant: TENANT });
    expect(softwareListCalls).toEqual([]);
  });

  it('still re-ingests once Datto re-audits the device', async () => {
    const pages: Record<string, any[][]> = { 'site-a': [[device('dev-1')]] };
    const { client } = createFakeDattoClient(pages);
    fakeClient = withSoftware(client);

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    await runDattoRmmSoftwareIngest({ tenant: TENANT });

    pages['site-a'] = [[device('dev-1', 'site-a', { lastAuditDate: Date.parse('2026-10-19T06:00:00.000Z') })]];
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    softwareListCalls.length = 0;
    await runDattoRmmSoftwareIngest({ tenant: TENANT });

    expect(softwareListCalls).toEqual(['dev-1']);
  });

  it('does not invent the marker for a device that never had software ingested', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('dev-1')]] });
    fakeClient = client;
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect('softwareIngestedAuditDate' in ingestCalls[0].snapshot.metadata).toBe(false);
  });
});

describe('device sync location', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    db = createFakeDb(seedDattoTables());
  });

  it('writes the site name as the asset location on create and on every update', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device('dev-1')]] });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(db.tables.assets[0].location).toBe('Acme HQ');

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(db.tables.assets[0].location).toBe('Acme HQ');
  });

  it('falls back to the mapped site name when the device carries none', async () => {
    db.tables.rmm_organization_mappings[0].external_organization_name = 'Mapped Site';
    const { client } = createFakeDattoClient({ 'site-a': [[device('dev-1', 'site-a', { siteName: undefined })]] });
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(db.tables.assets[0].location).toBe('Mapped Site');
  });
});

describe('device sync per-site isolation', () => {
  beforeEach(() => {
    ingestCalls.length = 0;
    db = createFakeDb(
      seedDattoTables({
        rmm_organization_mappings: [
          { integration_id: 'integration_1', external_organization_id: 'site-a', external_organization_name: 'Alpha', client_id: 'client-a', auto_sync_assets: true },
          { integration_id: 'integration_1', external_organization_id: 'site-gone', external_organization_name: 'Gone Co', client_id: 'client-g', auto_sync_assets: true },
          { integration_id: 'integration_1', external_organization_id: 'site-z', external_organization_name: 'Zulu', client_id: 'client-z', auto_sync_assets: true },
        ],
      })
    );
  });

  function clientWithSiteFailure(failing: Record<string, unknown>) {
    const { client, pageCalls } = createFakeDattoClient({
      'site-a': [[device('dev-1', 'site-a')]],
      'site-z': [[device('dev-2', 'site-z')]],
    });
    const original = client.pageSiteDevices;
    client.pageSiteDevices = (siteUid: string) => {
      if (siteUid in failing) {
        pageCalls.push(siteUid);
        return (async function* () {
          throw failing[siteUid];
        })();
      }
      return original(siteUid);
    };
    return { client, pageCalls };
  }

  it('records a 404 site as a failure and keeps syncing the others', async () => {
    const { client, pageCalls } = clientWithSiteFailure({ 'site-gone': httpError(404) });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(result).toMatchObject({ success: true, items_processed: 2, items_created: 2, items_failed: 1 });
    expect(pageCalls).toEqual(['site-a', 'site-gone', 'site-z']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toContain('Gone Co');
    expect(result.errors?.[0]).toContain('site-gone');
    expect(JSON.stringify(result.errors)).not.toContain('token-abc');
    expect(db.tables.rmm_integrations[0].sync_status).toBe('completed');
  });

  it('keeps going past a site that answers 403', async () => {
    const { client } = clientWithSiteFailure({ 'site-gone': httpError(403) });
    fakeClient = client;
    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(result).toMatchObject({ success: true, items_created: 2, items_failed: 1 });
  });

  it('fails the run when every site failed', async () => {
    const { client } = clientWithSiteFailure({ 'site-a': httpError(500), 'site-gone': httpError(404), 'site-z': httpError(503) });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/every datto rmm site failed/i);
    expect(result.items_failed).toBe(3);
    expect(result.errors).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain('token-abc');
    expect(db.tables.rmm_integrations[0].sync_status).toBe('error');
  });

  it('treats a credential failure as fatal instead of trying every other site', async () => {
    const { client, pageCalls } = clientWithSiteFailure({
      'site-a': new DattoRmmAuthError('Datto RMM rejected the API credentials.', { status: 401, path: '/v2/site/x/devices' }),
    });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('rejected the API credentials');
    expect(pageCalls).toEqual(['site-a']);
    expect(ingestCalls).toHaveLength(0);
  });
});
