import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb, TENANT, INTEGRATION_ID } from './dattoFakeDb';

let db: ReturnType<typeof createFakeDb>;
const publishWorkflowEvent = vi.fn(async (_event: any) => undefined);
const billingProfile = vi.fn(async (..._args: any[]) => undefined);
const defaultContract = vi.fn(async (..._args: any[]) => undefined);
const taxSettings = vi.fn(async (..._args: any[]) => undefined);
const moveAssets = vi.fn(async (..._args: any[]) => undefined);

/** Snapshots the tables so a throwing callback rolls back like a transaction. */
async function fakeTransaction(knex: any, fn: (trx: any) => Promise<unknown>) {
  const snapshot = JSON.stringify(db.tables);
  try {
    return await fn(knex);
  } catch (err) {
    const restored = JSON.parse(snapshot);
    for (const key of Object.keys(db.tables)) delete db.tables[key];
    Object.assign(db.tables, restored);
    throw err;
  }
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db.knex })),
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn.__table(t) }),
  withTransaction: (knex: any, fn: any) => fakeTransaction(knex, fn),
}));

// The shared client-creation seam imports tenantDb from this subpath (not the
// barrel above) to dodge a turbopack shim, so it needs its own mock too.
vi.mock('@alga-psa/db/tenantDb', () => ({
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn.__table(t) }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: (event: any) => publishWorkflowEvent(event),
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildClientCreatedPayload: (payload: any) => payload,
}));

vi.mock('@alga-psa/shared/billingClients/billingProfiles', () => ({
  ensureClientDefaultBillingProfile: (...args: any[]) => billingProfile(...args),
}));
vi.mock('@alga-psa/shared/billingClients/defaultContract', () => ({
  ensureDefaultContractForClientIfBillingConfigured: (...args: any[]) => defaultContract(...args),
}));
// Reached through the shared client-creation seam, which owns tax init.
vi.mock('@alga-psa/shared/billingClients/defaultTaxRate', () => ({
  initializeClientDefaultTax: (...args: any[]) => taxSettings(...args),
}));
vi.mock('@alga-psa/shared/rmm/moveRmmOrganizationAssets', () => ({
  moveRmmOrganizationAssets: (...args: any[]) => moveAssets(...args),
}));
vi.mock('@alga-psa/shared/rmm/sharedAssetIngestionService', () => ({
  ingestNormalizedRmmDeviceSnapshot: vi.fn(),
}));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  getDattoIntegrationRow: vi.fn(async () => db.tables.rmm_integrations[0]),
  buildDattoClientForTenant: vi.fn(async () => null),
}));

import {
  clientNameForDattoSite,
  provisionClientsForDattoSites,
  provisionClientsForNewDattoSitesIfEnabled,
} from '@ee/lib/integrations/datto/siteClientProvisioning';

const site = (uid: string, overrides: Record<string, unknown> = {}) => ({
  tenant: TENANT,
  mapping_id: `map-${uid}`,
  integration_id: INTEGRATION_ID,
  external_organization_id: uid,
  external_organization_name: uid.replace('site-', 'Site ').toUpperCase(),
  client_id: null,
  metadata: {},
  ...overrides,
});
const mappingFor = (uid: string) => db.tables.rmm_organization_mappings.find((m) => m.external_organization_id === uid);

describe('clientNameForDattoSite', () => {
  it('uses the site name, then the Autotask company name, never the uid', () => {
    expect(clientNameForDattoSite({ external_organization_id: 'u1', external_organization_name: ' Acme ' })).toBe('Acme');
    expect(clientNameForDattoSite({
      external_organization_id: 'u1',
      external_organization_name: 'u1',
      metadata: { autotask_company_name: 'Acme Corp' },
    })).toBe('Acme Corp');
    expect(clientNameForDattoSite({ external_organization_id: 'u1', external_organization_name: 'u1' })).toBeNull();
  });
});

describe('provisionClientsForDattoSites', () => {
  beforeEach(() => {
    for (const fn of [publishWorkflowEvent, billingProfile, defaultContract, taxSettings, moveAssets]) fn.mockClear();
    db = createFakeDb({
      rmm_integrations: [{ integration_id: INTEGRATION_ID, provider: 'datto', is_active: true, settings: {} }],
      rmm_organization_mappings: [
        site('site-new', { external_organization_name: 'Initech' }),
        site('site-existing', { external_organization_name: 'acme corp' }),
        site('site-mapped', { external_organization_name: 'Globex', client_id: 'client-globex' }),
        site('site-ondemand', { external_organization_name: 'OnDemand', metadata: { on_demand: true } }),
        site('site-gone', { external_organization_name: 'Gone Ltd', metadata: { missing_in_datto: true } }),
      ],
      clients: [
        { client_id: 'client-acme', client_name: 'Acme Corp' },
        { client_id: 'client-globex', client_name: 'Globex' },
      ],
      default_billing_settings: [{ default_currency_code: 'EUR' }],
      tenants: [{ product_code: 'psa' }],
    });
  });

  it('creates a client for a new site and links a site whose name already exists', async () => {
    const result = await provisionClientsForDattoSites({ tenant: TENANT, actorUserId: 'user-1' });

    expect(result).toMatchObject({ success: true, created: 1, linked: 1, skipped: 0, failed: 0 });
    const created = db.tables.clients.find((c) => c.client_name === 'Initech');
    expect(created).toMatchObject({ tenant: TENANT, client_type: 'company', is_inactive: false, default_currency_code: 'EUR' });
    expect(mappingFor('site-new')?.client_id).toBe(created!.client_id);
    // Case-insensitive name match links rather than duplicating.
    expect(mappingFor('site-existing')?.client_id).toBe('client-acme');
    expect(db.tables.clients.filter((c) => c.client_name.toLowerCase() === 'acme corp')).toHaveLength(1);
  });

  it('provisions a created client the way the client actions do, and publishes CLIENT_CREATED once', async () => {
    await provisionClientsForDattoSites({ tenant: TENANT, actorUserId: 'user-1' });

    const created = db.tables.clients.find((c) => c.client_name === 'Initech')!;
    expect(billingProfile).toHaveBeenCalledTimes(1);
    expect(defaultContract).toHaveBeenCalledTimes(1);
    expect(taxSettings).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEvent).toHaveBeenCalledTimes(1);
    expect(publishWorkflowEvent.mock.calls[0]![0]).toMatchObject({
      eventType: 'CLIENT_CREATED',
      idempotencyKey: `client_created:${created.client_id}`,
      ctx: { tenantId: TENANT, actor: { actorType: 'USER', actorUserId: 'user-1' } },
    });
    // Linked and created sites both carry their assets over.
    expect(moveAssets).toHaveBeenCalledTimes(2);
  });

  it('leaves mapped, on-demand and vanished sites alone in a bulk run', async () => {
    const result = await provisionClientsForDattoSites({ tenant: TENANT });

    expect(result.results.map((r) => r.siteUid).sort()).toEqual(['site-existing', 'site-new']);
    expect(mappingFor('site-ondemand')?.client_id).toBeNull();
    expect(mappingFor('site-gone')?.client_id).toBeNull();
    expect(mappingFor('site-mapped')?.client_id).toBe('client-globex');
  });

  it('acts on an explicitly named on-demand site, and reports an already-mapped one as skipped', async () => {
    const result = await provisionClientsForDattoSites({ tenant: TENANT, mappingIds: ['map-site-ondemand', 'map-site-mapped'] });

    expect(result).toMatchObject({ created: 1, skipped: 1 });
    expect(mappingFor('site-ondemand')?.client_id).toBeTruthy();
    expect(result.results.find((r) => r.siteUid === 'site-mapped')).toMatchObject({ outcome: 'skipped' });
  });

  it('refuses to guess between two clients with the same name', async () => {
    db.tables.clients.push({ client_id: 'client-acme-2', client_name: 'ACME CORP' });

    const result = await provisionClientsForDattoSites({ tenant: TENANT, siteUids: ['site-existing'] });

    expect(result.results).toEqual([expect.objectContaining({ outcome: 'failed', siteUid: 'site-existing' })]);
    expect(mappingFor('site-existing')?.client_id).toBeNull();
  });

  it('rolls back the new client when the site was mapped in the meantime', async () => {
    // The claim is conditional on client_id still being null; simulate an admin winning the race.
    billingProfile.mockImplementationOnce(async () => {
      mappingFor('site-new')!.client_id = 'client-chosen-by-admin';
    });

    const result = await provisionClientsForDattoSites({ tenant: TENANT, siteUids: ['site-new'] });

    expect(result.results).toEqual([expect.objectContaining({ outcome: 'skipped', siteUid: 'site-new' })]);
    expect(db.tables.clients.find((c) => c.client_name === 'Initech')).toBeUndefined();
    expect(publishWorkflowEvent).not.toHaveBeenCalled();
  });

  it('skips tax settings on AlgaDesk', async () => {
    db.tables.tenants = [{ product_code: 'algadesk' }];

    await provisionClientsForDattoSites({ tenant: TENANT, siteUids: ['site-new'] });

    expect(taxSettings).not.toHaveBeenCalled();
    expect(billingProfile).toHaveBeenCalledTimes(1);
  });

  it('attributes a scheduled run to the system', async () => {
    await provisionClientsForDattoSites({ tenant: TENANT, siteUids: ['site-new'] });
    expect(publishWorkflowEvent.mock.calls[0]![0].ctx.actor).toEqual({ actorType: 'SYSTEM' });
  });

  it('keeps the on-demand and vanished filters on the automatic siteUids path', async () => {
    const result = await provisionClientsForDattoSites({ tenant: TENANT, siteUids: ['site-new', 'site-ondemand', 'site-gone'] });

    expect(result.results.map((r) => r.siteUid)).toEqual(['site-new']);
    expect(mappingFor('site-ondemand')?.client_id).toBeNull();
    expect(mappingFor('site-gone')?.client_id).toBeNull();
  });

  it('will not link a site to an inactive client', async () => {
    db.tables.clients.find((c) => c.client_id === 'client-acme')!.is_inactive = true;

    const result = await provisionClientsForDattoSites({ tenant: TENANT, siteUids: ['site-existing'] });

    expect(result.results).toEqual([expect.objectContaining({ outcome: 'failed', siteUid: 'site-existing' })]);
    expect(result.results[0]!.reason).toMatch(/inactive/);
    expect(mappingFor('site-existing')?.client_id).toBeNull();
  });
});

describe('provisionClientsForNewDattoSitesIfEnabled', () => {
  beforeEach(() => {
    db = createFakeDb({
      rmm_integrations: [{ integration_id: INTEGRATION_ID, provider: 'datto', is_active: true, settings: {} }],
      rmm_organization_mappings: [site('site-new', { external_organization_name: 'Initech' })],
      clients: [],
      default_billing_settings: [],
      tenants: [{ product_code: 'psa' }],
    });
  });

  it('does nothing unless the tenant opted in', async () => {
    expect(await provisionClientsForNewDattoSitesIfEnabled({ tenant: TENANT, newSiteUids: ['site-new'] })).toBeNull();
    expect(mappingFor('site-new')?.client_id).toBeNull();
  });

  it('provisions the new sites when opted in', async () => {
    db.tables.rmm_integrations[0]!.settings = { autoCreateClientsForNewSites: true };
    const result = await provisionClientsForNewDattoSitesIfEnabled({ tenant: TENANT, newSiteUids: ['site-new'] });
    expect(result).toMatchObject({ created: 1 });
    expect(mappingFor('site-new')?.client_id).toBeTruthy();
  });

  it('does nothing without new sites', async () => {
    db.tables.rmm_integrations[0]!.settings = { autoCreateClientsForNewSites: true };
    expect(await provisionClientsForNewDattoSitesIfEnabled({ tenant: TENANT, newSiteUids: [] })).toBeNull();
  });
});
