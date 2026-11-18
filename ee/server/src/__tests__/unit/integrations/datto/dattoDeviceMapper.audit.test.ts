import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, createFakeDattoClient, seedDattoTables, TENANT, INTEGRATION_ID } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let fakeClient: any;
const ingestCalls: any[] = [];

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

// Persists the external mapping the way the real service does, so the next run
// sees the lastAuditDate this one recorded.
vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: vi.fn(async ({ snapshot }: any) => {
    ingestCalls.push(snapshot);
    const mappings = db.tables.tenant_external_entity_mappings;
    const existing = mappings.find((m) => m.external_entity_id === snapshot.externalDeviceId);
    if (existing) {
      existing.metadata = snapshot.metadata;
      return { externalDeviceId: snapshot.externalDeviceId, assetId: existing.alga_entity_id, action: 'updated' };
    }
    const assetId = `asset-${snapshot.externalDeviceId}`;
    db.tables.assets.push({ asset_id: assetId, serial_number: snapshot.serialNumber ?? '' });
    mappings.push({
      integration_type: 'datto',
      alga_entity_type: 'asset',
      alga_entity_id: assetId,
      external_entity_id: snapshot.externalDeviceId,
      external_realm_id: snapshot.externalScopeId,
      metadata: snapshot.metadata,
    });
    return { externalDeviceId: snapshot.externalDeviceId, assetId, action: 'created' };
  }),
}));

import {
  mapDattoAuditToHardware,
  mapDattoEsxiAuditToHardware,
  mapDattoPrinterAuditToHardware,
  mapDattoDeviceToSnapshot,
} from '@ee/lib/integrations/datto/mappers';
import { runDattoRmmDeviceSync } from '@ee/lib/integrations/datto/deviceSync';

const GB = 1024 ** 3;

const audit = {
  bios: { serialNumber: 'SN-12345' },
  systemInfo: { manufacturer: 'Dell Inc.', model: 'PowerEdge R740', totalCpuCores: 16 },
  processors: [{ name: 'Intel(R) Xeon(R) Silver 4210' }, { name: 'Intel(R) Xeon(R) Silver 4210' }],
  physicalMemory: [{ size: 16 * GB }, { size: 16 * GB }],
  logicalDisks: [
    { diskIdentifier: 'C:', size: 500 * GB, freespace: 125 * GB },
    { diskIdentifier: 'D:', description: 'Data', size: 1000 * GB, freespace: 1000 * GB },
    { diskIdentifier: 'Z:', size: 0, freespace: 0 },
  ],
};

describe('mapDattoAuditToHardware', () => {
  it('extracts serial, make/model, CPU, RAM and disks', () => {
    expect(mapDattoAuditToHardware(audit as any)).toEqual({
      serialNumber: 'SN-12345',
      manufacturer: 'Dell Inc.',
      model: 'PowerEdge R740',
      cpuModel: 'Intel(R) Xeon(R) Silver 4210',
      cpuCores: 16,
      ramGb: 32,
      diskUsage: [
        { name: 'C:', total_gb: 500, free_gb: 125, utilization_percent: 75 },
        { name: 'D:', total_gb: 1000, free_gb: 1000, utilization_percent: 0 },
      ],
    });
  });

  it('falls back to the base board serial and tolerates an empty audit', () => {
    expect(mapDattoAuditToHardware({ baseBoard: { serialNumber: 'BB-1' } } as any).serialNumber).toBe('BB-1');
    expect(mapDattoAuditToHardware({} as any)).toEqual({
      serialNumber: null,
      manufacturer: null,
      model: null,
      cpuModel: null,
      cpuCores: null,
      ramGb: null,
      diskUsage: null,
    });
    expect(mapDattoAuditToHardware(null).ramGb).toBeNull();
  });

  it('puts hardware into the snapshot extension and serial', () => {
    const hardware = mapDattoAuditToHardware(audit as any);
    const snapshot = mapDattoDeviceToSnapshot({ uid: 'd1', siteUid: 's1', online: true } as any, {
      integrationId: 'i1',
      hardware,
    });
    expect(snapshot.serialNumber).toBe('SN-12345');
    expect(snapshot.extension).toMatchObject({ manufacturer: 'Dell Inc.', model: 'PowerEdge R740', ramGb: 32, cpuCores: 16 });
  });
});

describe('printer and ESXi audit variants', () => {
  it('reads printer make/model/serial loosely', () => {
    expect(
      mapDattoPrinterAuditToHardware({ systemInfo: { manufacturer: 'HP', model: 'LaserJet' }, snmpInfo: { snmpSerial: 'P-1' } } as any)
    ).toMatchObject({ manufacturer: 'HP', model: 'LaserJet', serialNumber: 'P-1', ramGb: null });
  });

  it('reads ESXi host identity, cores and memory', () => {
    expect(
      mapDattoEsxiAuditToHardware({
        systemInfo: { manufacturer: 'HPE', model: 'DL380', serviceTag: 'TAG-9' },
        processors: [{ name: 'Xeon', numberOfCores: 8 }, { name: 'Xeon', numberOfCores: 8 }],
        physicalMemory: [{ size: 64 * GB }],
      } as any)
    ).toMatchObject({ serialNumber: 'TAG-9', manufacturer: 'HPE', model: 'DL380', cpuCores: 16, ramGb: 64 });
  });
});

describe('device sync audit enrichment', () => {
  const device = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    uid: 'dev-1',
    siteUid: 'site-a',
    hostname: 'HOST1',
    deviceClass: 'device',
    deviceType: { category: 'Server' },
    online: true,
    lastSeen: Date.parse('2026-10-19T11:00:00.000Z'),
    lastAuditDate: Date.parse('2026-10-18T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    ingestCalls.length = 0;
    db = createFakeDb(seedDattoTables());
  });

  it('skips the audit call when lastAuditDate is unchanged and keeps the stored serial', async () => {
    const { client } = createFakeDattoClient({ 'site-a': [[device()]] }, { 'dev-1': audit });
    client.getDeviceAudit = vi.fn(client.getDeviceAudit);
    fakeClient = client;

    // First run: no asset yet, so the audit is fetched and hardware ingested.
    const first = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(first.success).toBe(true);
    expect(client.getDeviceAudit).toHaveBeenCalledTimes(1);
    expect(ingestCalls[0].serialNumber).toBe('SN-12345');
    expect(ingestCalls[0].extension.ramGb).toBe(32);
    expect(db.tables.tenant_external_entity_mappings[0].metadata.lastAuditDate).toBe('2026-10-18T00:00:00.000Z');

    // Second run: same lastAuditDate, so no audit; hardware is not re-sent and
    // the existing serial rides along so ingestion does not blank it.
    const second = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(second.success).toBe(true);
    expect(client.getDeviceAudit).toHaveBeenCalledTimes(1);
    expect(ingestCalls[1].serialNumber).toBe('SN-12345');
    expect('ramGb' in ingestCalls[1].extension).toBe(false);
  });

  it('re-fetches the audit when Datto reports a newer lastAuditDate', async () => {
    const pages: Record<string, any[][]> = { 'site-a': [[device()]] };
    const { client } = createFakeDattoClient(pages, { 'dev-1': audit });
    client.getDeviceAudit = vi.fn(client.getDeviceAudit);
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    pages['site-a'] = [[device({ lastAuditDate: Date.parse('2026-10-19T06:00:00.000Z') })]];
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(client.getDeviceAudit).toHaveBeenCalledTimes(2);
    expect(db.tables.tenant_external_entity_mappings[0].metadata.lastAuditDate).toBe('2026-10-19T06:00:00.000Z');
  });

  it('does not re-audit a 404 device on every run (the audit ran, there was just nothing to read)', async () => {
    const notFound = Object.assign(new Error('not found'), { isAxiosError: true, response: { status: 404 } });
    const { client } = createFakeDattoClient({ 'site-a': [[device()]] }, { 'dev-1': notFound });
    client.getDeviceAudit = vi.fn(client.getDeviceAudit);
    fakeClient = client;
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(client.getDeviceAudit).toHaveBeenCalledTimes(1);
  });

  it('chooses the audit endpoint by deviceClass', async () => {
    const { client } = createFakeDattoClient({
      'site-a': [[
        device({ uid: 'p1', deviceClass: 'printer' }),
        device({ uid: 'e1', deviceClass: 'esxihost' }),
        device({ uid: 'n1', deviceClass: 'rmmnetworkdevice' }),
      ]],
    });
    client.getDeviceAudit = vi.fn(client.getDeviceAudit);
    client.getPrinterAudit = vi.fn(client.getPrinterAudit);
    client.getEsxiHostAudit = vi.fn(client.getEsxiHostAudit);
    fakeClient = client;

    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    expect(client.getPrinterAudit).toHaveBeenCalledWith('p1');
    expect(client.getEsxiHostAudit).toHaveBeenCalledWith('e1');
    expect(client.getDeviceAudit).not.toHaveBeenCalled();
  });

  it('tolerates a 404 audit and still ingests the device', async () => {
    const notFound = Object.assign(new Error('not found'), { isAxiosError: true, response: { status: 404 } });
    const { client } = createFakeDattoClient({ 'site-a': [[device()]] }, { 'dev-1': notFound });
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(result).toMatchObject({ success: true, items_created: 1, items_failed: 0 });
    expect(ingestCalls).toHaveLength(1);
  });

  it('ingests a device whose audit failed, without hardware, and reports a warning rather than a failure', async () => {
    const boom = Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 500 } });
    const { client } = createFakeDattoClient(
      { 'site-a': [[device({ uid: 'bad' }), device({ uid: 'good' })]] },
      { bad: boom, good: audit }
    );
    fakeClient = client;

    const result = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(result.success).toBe(true);
    expect(result.items_failed).toBe(0);
    expect(result.items_created).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0]).toContain('bad');
    expect(result.errors?.[0]).toMatch(/audit failed/i);
    expect(JSON.stringify(result.errors)).not.toContain('boom');
    expect(db.tables.rmm_integrations[0].integration_id).toBe(INTEGRATION_ID);

    const bad = ingestCalls.find((s) => s.externalDeviceId === 'bad');
    expect('ramGb' in bad.extension).toBe(false);
    // The marker is not advanced, so the next run audits it again.
    const mapping = db.tables.tenant_external_entity_mappings.find((m) => m.external_entity_id === 'bad');
    expect(mapping?.metadata.lastAuditDate).toBeNull();
    expect(db.tables.tenant_external_entity_mappings.find((m) => m.external_entity_id === 'good')?.metadata.lastAuditDate).toBe(
      '2026-10-18T00:00:00.000Z'
    );
  });

  it('retries a failed audit on the next run and keeps the previously stored marker meanwhile', async () => {
    const pages: Record<string, any[][]> = { 'site-a': [[device()]] };
    const { client } = createFakeDattoClient(pages, { 'dev-1': audit });
    client.getDeviceAudit = vi.fn(client.getDeviceAudit);
    fakeClient = client;
    await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });

    // Datto re-audits, but the audit endpoint is down (429 after retries).
    pages['site-a'] = [[device({ lastAuditDate: Date.parse('2026-10-19T06:00:00.000Z') })]];
    const rateLimited = Object.assign(new Error('slow down'), { isAxiosError: true, response: { status: 429 } });
    client.getDeviceAudit.mockRejectedValueOnce(rateLimited);
    const second = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(second).toMatchObject({ success: true, items_failed: 0, items_updated: 1 });
    expect(second.errors).toHaveLength(1);
    expect(db.tables.tenant_external_entity_mappings[0].metadata.lastAuditDate).toBe('2026-10-18T00:00:00.000Z');

    const third = await runDattoRmmDeviceSync({ tenant: TENANT }, { syncType: 'full' });
    expect(third.errors).toBeUndefined();
    expect(client.getDeviceAudit).toHaveBeenCalledTimes(3);
    expect(db.tables.tenant_external_entity_mappings[0].metadata.lastAuditDate).toBe('2026-10-19T06:00:00.000Z');
  });
});
