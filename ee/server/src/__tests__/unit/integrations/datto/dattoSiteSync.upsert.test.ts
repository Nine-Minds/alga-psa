import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, TENANT, INTEGRATION_ID } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
let sites: any[] = [];
let clientAvailable = true;
const publishEvent = vi.fn(async () => undefined);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db.knex })),
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn.__table(t) }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => (publishEvent as any)(...args),
}));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => db.tables.rmm_integrations[0]),
  buildDattoClientForTenant: vi.fn(async () => (clientAvailable ? { listSites: async () => sites } : null)),
}));

// The device engine module is imported for its shared helpers only.
vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: vi.fn(),
}));

import { runDattoRmmSiteSync } from '@ee/lib/integrations/datto/siteSync';

const mappings = () => db.tables.rmm_organization_mappings;
const mappingFor = (uid: string) => mappings().find((m) => m.external_organization_id === uid);

describe('runDattoRmmSiteSync upserts rmm_organization_mappings', () => {
  beforeEach(() => {
    clientAvailable = true;
    publishEvent.mockClear();
    db = createFakeDb({
      rmm_integrations: [{ integration_id: INTEGRATION_ID, provider: 'datto', is_active: true, settings: {} }],
      rmm_organization_mappings: [],
      clients: [],
    });
    sites = [
      { id: 11, uid: 'site-1', name: 'Acme HQ', autotaskCompanyId: '501', autotaskCompanyName: 'Acme Corp', portalUrl: 'https://x/site-1' },
      { id: 12, uid: 'site-2', name: 'Globex', onDemand: false },
      { id: 13, uid: 'OnDemand Devices', name: 'OnDemand Devices', onDemand: true },
    ];
  });

  it('creates one row per site keyed by uid, with the site metadata', async () => {
    const result = await runDattoRmmSiteSync({ tenant: TENANT, actorUserId: 'u1' });

    expect(result).toMatchObject({ success: true, items_processed: 3, items_created: 3, items_updated: 0, items_failed: 0 });
    expect(mappings()).toHaveLength(3);
    expect(mappingFor('site-1')).toMatchObject({
      tenant: TENANT,
      integration_id: INTEGRATION_ID,
      external_organization_name: 'Acme HQ',
      metadata: {
        datto_site_id: 11,
        autotask_company_id: '501',
        autotask_company_name: 'Acme Corp',
        on_demand: false,
        portal_url: 'https://x/site-1',
      },
    });
    expect(mappingFor('site-1')?.client_id).toBeUndefined();
  });

  it('defaults auto-sync off for on-demand sites only', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('OnDemand Devices')?.auto_sync_assets).toBe(false);
    expect(mappingFor('OnDemand Devices')?.metadata.on_demand).toBe(true);
    // Other sites keep the column default (omitted from the insert).
    expect('auto_sync_assets' in mappingFor('site-1')!).toBe(false);
  });

  it('is idempotent: a rerun updates rather than duplicates, and a rename updates the name', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT });
    sites[0] = { ...sites[0], name: 'Acme Headquarters' };

    const second = await runDattoRmmSiteSync({ tenant: TENANT });

    // Only the renamed site changed; the other two are left as they are.
    expect(second).toMatchObject({ success: true, items_created: 0, items_updated: 1 });
    expect(mappings()).toHaveLength(3);
    expect(mappingFor('site-1')?.external_organization_name).toBe('Acme Headquarters');
  });

  it('does not rewrite a site whose name and metadata are unchanged', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT });
    const writesAfterFirst = db.writes.filter((w) => w.table === 'rmm_organization_mappings').length;

    const second = await runDattoRmmSiteSync({ tenant: TENANT });

    expect(second).toMatchObject({ success: true, items_processed: 3, items_created: 0, items_updated: 0 });
    expect(db.writes.filter((w) => w.table === 'rmm_organization_mappings')).toHaveLength(writesAfterFirst);
  });

  it('does not flag every mapping missing when Datto returns no sites at all', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT });
    sites = [];

    const result = await runDattoRmmSiteSync({ tenant: TENANT });

    expect(result.errors?.[0]).toMatch(/returned no sites/);
    expect(mappings().every((m) => m.metadata.missing_in_datto === false)).toBe(true);
  });

  it('records the device count and reports the sites seen for the first time', async () => {
    sites[0] = { ...sites[0], devicesStatus: { numberOfDevices: 42 } };
    const first = await runDattoRmmSiteSync({ tenant: TENANT });
    expect(first.created_site_uids).toEqual(['site-1', 'site-2', 'OnDemand Devices']);
    expect(mappingFor('site-1')?.metadata.device_count).toBe(42);
    expect(mappingFor('site-2')?.metadata.device_count).toBeNull();

    sites.push({ id: 14, uid: 'site-4', name: 'Initech' });
    const second = await runDattoRmmSiteSync({ tenant: TENANT });
    expect(second.created_site_uids).toEqual(['site-4']);
  });

  it('never clobbers a client or auto-sync the admin set', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT });
    Object.assign(mappingFor('site-1')!, { client_id: 'client-9', auto_sync_assets: false, contact_assignment_mode: 'auto' });

    await runDattoRmmSiteSync({ tenant: TENANT });

    expect(mappingFor('site-1')).toMatchObject({ client_id: 'client-9', auto_sync_assets: false, contact_assignment_mode: 'auto' });
  });

  it('keeps unrelated metadata keys across a rerun', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT });
    mappingFor('site-2')!.metadata.admin_note = 'keep me';
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('site-2')?.metadata.admin_note).toBe('keep me');
  });

  it('records last sync and publishes organization sync events', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT, actorUserId: 'u1' });

    expect(db.tables.rmm_integrations[0].last_sync_at).toBeInstanceOf(Date);
    expect(db.tables.rmm_integrations[0].sync_error).toBeNull();
    expect(publishEvent.mock.calls.map((c: any) => [c[0].eventType, c[0].payload.syncType, c[0].payload.provider])).toEqual([
      ['RMM_SYNC_STARTED', 'organizations', 'datto'],
      ['RMM_SYNC_COMPLETED', 'organizations', 'datto'],
    ]);
  });

  it('collects a site without a uid as a failure and keeps going', async () => {
    sites = [{ name: 'No uid' }, { id: 1, uid: 'site-ok', name: 'OK' }];
    const result = await runDattoRmmSiteSync({ tenant: TENANT });
    expect(result).toMatchObject({ success: true, items_created: 1, items_failed: 1 });
    expect(mappings()).toHaveLength(1);
  });

  it('fails with a safe message when credentials are missing', async () => {
    clientAvailable = false;
    const result = await runDattoRmmSiteSync({ tenant: TENANT });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credentials are not configured/i);
    expect(publishEvent.mock.calls.map((c: any) => c[0].eventType)).toContain('RMM_SYNC_FAILED');
  });

  it('fails when Datto is not configured at all', async () => {
    db = createFakeDb({ rmm_integrations: [], rmm_organization_mappings: [], clients: [] });
    const result = await runDattoRmmSiteSync({ tenant: TENANT });
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/not configured/i);
  });

  it('flags a mapping whose site vanished from Datto, never deletes it, and clears the flag on return', async () => {
    await runDattoRmmSiteSync({ tenant: TENANT });
    Object.assign(mappingFor('site-2')!, { client_id: 'client-2', auto_sync_assets: true });
    const full = sites;

    sites = full.filter((s) => s.uid !== 'site-2');
    const second = await runDattoRmmSiteSync({ tenant: TENANT });

    expect(second).toMatchObject({ success: true, items_processed: 2, items_failed: 0 });
    expect(mappings()).toHaveLength(3);
    expect(mappingFor('site-2')?.metadata.missing_in_datto).toBe(true);
    expect(mappingFor('site-2')).toMatchObject({ client_id: 'client-2', auto_sync_assets: true });
    expect(mappingFor('site-1')?.metadata.missing_in_datto).toBe(false);

    sites = full;
    await runDattoRmmSiteSync({ tenant: TENANT });
    expect(mappingFor('site-2')?.metadata.missing_in_datto).toBe(false);
    expect(mappings()).toHaveLength(3);
  });
});
