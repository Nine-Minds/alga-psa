import { beforeEach, describe, expect, it, vi } from 'vitest';

let client: { listOpenAlerts: ReturnType<typeof vi.fn> } | null;
let mappingRows: Array<Record<string, any>>;
const mappingQuery = {
  where: vi.fn(),
  whereNotNull: vi.fn(),
  select: vi.fn(),
};

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: () => ({ table: () => mappingQuery }),
}));

vi.mock('@ee/lib/integrations/datto/buildClient', () => ({
  buildDattoClientForTenant: vi.fn(async () => client),
}));

const registerRmmAlertFetcher = vi.fn();
vi.mock('@alga-psa/shared/rmm/alerts', async () => {
  const actual: any = await vi.importActual('@alga-psa/shared/rmm/alerts');
  return { ...actual, registerRmmAlertFetcher };
});

const alert = (uid: string, siteUid: string | null, extra: Record<string, unknown> = {}) => ({
  alertUid: uid,
  priority: 'High',
  diagnostics: `diag ${uid}`,
  timestamp: 1_776_073_284_000,
  alertContext: { '@class': 'online_offline_status_ctx' },
  alertSourceInfo: { deviceUid: `dev-${uid}`, deviceName: `host-${uid}`, siteUid },
  ...extra,
});

describe('dattoRmmAlertFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mappingRows = [{ external_organization_id: 'site-1' }, { external_organization_id: 'site-2' }];
    mappingQuery.where.mockReturnValue(mappingQuery);
    mappingQuery.whereNotNull.mockReturnValue(mappingQuery);
    mappingQuery.select.mockImplementation(async () => mappingRows);
    client = {
      listOpenAlerts: vi.fn(async () => [
        alert('a1', 'site-1'),
        alert('a2', 'site-unmapped'),
        alert('a3', 'site-2', { resolved: true }),
        alert('a4', 'site-2'),
        alert('a5', null),
      ]),
    };
  });

  it('T041: keeps only open alerts for mapped sites and maps them as triggered events', async () => {
    const { dattoRmmAlertFetcher } = await import('@ee/lib/integrations/datto/alertFetcher');

    const events = await dattoRmmAlertFetcher.fetchActiveAlerts({ tenantId: 'tenant_1', integrationId: 'int_1' });

    expect(events.map((e) => e.externalAlertId)).toEqual(['a1', 'a4']);
    expect(events[0]).toEqual(
      expect.objectContaining({
        provider: 'datto',
        kind: 'triggered',
        tenantId: 'tenant_1',
        integrationId: 'int_1',
        externalOrganizationId: 'site-1',
        severity: 'major',
      })
    );
    expect(mappingQuery.where).toHaveBeenCalledWith({ integration_id: 'int_1' });
    expect(mappingQuery.whereNotNull).toHaveBeenCalledWith('client_id');
  });

  it('drops muted alerts but keeps ones where muted is false or absent', async () => {
    client = {
      listOpenAlerts: vi.fn(async () => [
        alert('m1', 'site-1', { muted: true }),
        alert('m2', 'site-1', { muted: false }),
        alert('m3', 'site-1'),
      ]),
    };
    const { dattoRmmAlertFetcher } = await import('@ee/lib/integrations/datto/alertFetcher');
    const events = await dattoRmmAlertFetcher.fetchActiveAlerts({ tenantId: 'tenant_1', integrationId: 'int_1' });
    expect(events.map((e) => e.externalAlertId)).toEqual(['m2', 'm3']);
  });

  it('loadMappedDattoSiteUids returns the site uids that have a client for the integration', async () => {
    mappingRows = [{ external_organization_id: 'site-1' }, { external_organization_id: '' }, { external_organization_id: null }, { external_organization_id: 'site-9' }];
    const { loadMappedDattoSiteUids } = await import('@ee/lib/integrations/datto/alertFetcher');
    const uids = await loadMappedDattoSiteUids({} as any, 'tenant_1', 'int_1');
    expect([...uids].sort()).toEqual(['site-1', 'site-9']);
    expect(mappingQuery.where).toHaveBeenCalledWith({ integration_id: 'int_1' });
    expect(mappingQuery.whereNotNull).toHaveBeenCalledWith('client_id');
  });

  it('ingests nothing when no site is mapped but holds every open alert so none look cleared', async () => {
    mappingRows = [];
    const { dattoRmmAlertFetcher } = await import('@ee/lib/integrations/datto/alertFetcher');
    const snapshot = await dattoRmmAlertFetcher.fetchActiveAlertSnapshot!({ tenantId: 't', integrationId: 'i' });
    expect(snapshot.events).toEqual([]);
    // a3 is resolved in Datto, so it is genuinely cleared and not held.
    expect(snapshot.heldExternalAlertIds).toEqual(['a1', 'a2', 'a4', 'a5']);
  });

  it('holds muted and unmapped-site alerts instead of dropping them', async () => {
    client = {
      listOpenAlerts: vi.fn(async () => [
        alert('m1', 'site-1', { muted: true }),
        alert('u1', 'site-unmapped'),
        alert('ok', 'site-1'),
        alert('r1', 'site-unmapped', { resolved: true }),
      ]),
    };
    const { dattoRmmAlertFetcher } = await import('@ee/lib/integrations/datto/alertFetcher');
    const snapshot = await dattoRmmAlertFetcher.fetchActiveAlertSnapshot!({ tenantId: 't', integrationId: 'i' });
    expect(snapshot.events.map((e) => e.externalAlertId)).toEqual(['ok']);
    expect(snapshot.heldExternalAlertIds).toEqual(['m1', 'u1']);
  });

  it('throws rather than reporting "all clear" when the tenant has no usable Datto client', async () => {
    client = null;
    const { dattoRmmAlertFetcher } = await import('@ee/lib/integrations/datto/alertFetcher');
    await expect(dattoRmmAlertFetcher.fetchActiveAlerts({ tenantId: 't', integrationId: 'i' })).rejects.toThrow(
      'Datto RMM integration is not connected'
    );
  });

  it('returns an authoritative empty list when sites are mapped but nothing is open', async () => {
    client = { listOpenAlerts: vi.fn(async () => []) };
    const { dattoRmmAlertFetcher } = await import('@ee/lib/integrations/datto/alertFetcher');
    expect(await dattoRmmAlertFetcher.fetchActiveAlerts({ tenantId: 't', integrationId: 'i' })).toEqual([]);
  });

  it('isDattoSiteMapped looks up one site with a client in a single query', async () => {
    const first = vi.fn(async () => ({ external_organization_id: 'site-1' }));
    mappingQuery.where.mockReturnValue({ whereNotNull: () => ({ first }) });
    const { isDattoSiteMapped } = await import('@ee/lib/integrations/datto/alertFetcher');
    expect(await isDattoSiteMapped({} as any, 'tenant_1', 'int_1', 'site-1')).toBe(true);
    expect(mappingQuery.where).toHaveBeenCalledWith({ integration_id: 'int_1', external_organization_id: 'site-1' });

    first.mockResolvedValueOnce(undefined as any);
    expect(await isDattoSiteMapped({} as any, 'tenant_1', 'int_1', 'site-x')).toBe(false);
  });

  it('registers itself under the datto provider as a module side effect', async () => {
    vi.resetModules();
    const mod = await import('@ee/lib/integrations/datto/alertFetcher');
    expect(registerRmmAlertFetcher).toHaveBeenCalledWith('datto', mod.dattoRmmAlertFetcher);
  });
});
