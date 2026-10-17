import { describe, expect, it, vi } from 'vitest';
import { UniFiApiError } from '../../../lib/integrations/unifi/unifiApiClient';
import { runUniFiDeviceSync, runUniFiFullSync } from '../../../lib/integrations/unifi/sync/syncEngine';

type Rows = Record<string, any[]>;

function createKnexStub(rowsByTable: Rows) {
  const knex: any = (table: string) => {
    const rows = rowsByTable[table] ?? [];
    const builder: any = {
      where: () => builder,
      whereNotNull: () => builder,
      andWhere: () => builder,
      whereIn: () => builder,
      select: async () => rows,
      first: async () => rows[0],
      update: async () => 1,
      insert: async () => [1],
    };
    return builder;
  };
  knex.fn = { now: () => new Date() };
  return knex;
}

const SITE = { external_organization_id: 'host-1:site-1', external_organization_name: 'HQ', client_id: 'client-1' };
const SITE2 = { external_organization_id: 'host-1:site-2', external_organization_name: 'Branch', client_id: 'client-2' };

const sw = (over: Record<string, unknown> = {}) => ({
  id: 'sw-1', macAddress: 'aa:bb:cc:dd:ee:01', ipAddress: '10.0.0.2', name: 'Switch', model: 'USW-24',
  serialNumber: null, state: 'ONLINE', firmwareVersion: '1', firmwareUpdatable: false, features: ['switching'],
  uplinkDeviceId: null, stateChangedAt: null, raw: {}, ...over,
});

function baseDeps(client: any, rows: Rows) {
  return {
    knex: createKnexStub(rows),
    client,
    ingest: vi.fn(async (input: any) =>
      input.snapshot.lifecycleState === 'tombstoned'
        ? { externalDeviceId: input.snapshot.externalDeviceId, action: 'marked_deleted' as const }
        : { externalDeviceId: input.snapshot.externalDeviceId, action: 'created' as const, assetId: `asset-${input.snapshot.externalDeviceId}` }
    ),
    upsertFact: vi.fn(async () => undefined),
    publishEvent: vi.fn(async () => undefined),
  };
}

describe('runUniFiFullSync', () => {
  it('ingests devices for mapped sites with the mapped client and writes facts', async () => {
    const client = {
      listDevices: vi.fn(async () => [sw(), sw({ id: 'sw-2', state: 'PENDING_ADOPTION' })]),
      getDevice: vi.fn(async () => sw({ uplinkDeviceId: 'gw-1' })),
    };
    const deps = baseDeps(client, { rmm_organization_mappings: [SITE], tenant_external_entity_mappings: [] });
    const result = await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);

    expect(result.success).toBe(true);
    expect(result.items_created).toBe(1);
    const call = deps.ingest.mock.calls[0][0] as any;
    expect(call.resolvedClientId).toBe('client-1');
    expect(call.snapshot.extension.networkDevice.deviceType).toBe('switch');
    expect(deps.upsertFact.mock.calls.map((c: any[]) => c[1].factKey)).toEqual(['mac_address', 'model', 'uplink']);
  });

  it('does not list devices for sites with no mapping', async () => {
    const client = { listDevices: vi.fn(), getDevice: vi.fn() };
    const deps = baseDeps(client, { rmm_organization_mappings: [], tenant_external_entity_mappings: [] });
    const result = await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);
    expect(client.listDevices).not.toHaveBeenCalled();
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(result.items_processed).toBe(0);
  });

  it('tombstones mapped assets absent from a completed listing', async () => {
    const client = { listDevices: vi.fn(async () => [sw()]), getDevice: vi.fn(async () => sw()) };
    const deps = baseDeps(client, {
      rmm_organization_mappings: [SITE],
      tenant_external_entity_mappings: [
        { external_entity_id: 'sw-1', metadata: {} },
        { external_entity_id: 'gone-1', metadata: {} },
        { external_entity_id: 'gone-2', metadata: { deleted: true } },
      ],
    });
    await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);
    const tombstones = deps.ingest.mock.calls.map((c: any[]) => c[0].snapshot).filter((s: any) => s.lifecycleState === 'tombstoned');
    expect(tombstones.map((s: any) => s.externalDeviceId)).toEqual(['gone-1']);
  });

  it('fails closed: a failed listing tombstones nothing for that site, other sites still sync', async () => {
    const client = {
      listDevices: vi.fn(async (site: any) => {
        if (site.siteId === 'site-1') throw new UniFiApiError('boom', 'http', 500);
        return [sw({ id: 'sw-9' })];
      }),
      getDevice: vi.fn(async () => sw({ id: 'sw-9' })),
    };
    const deps = baseDeps(client, {
      rmm_organization_mappings: [SITE, SITE2],
      tenant_external_entity_mappings: [{ external_entity_id: 'old-device', metadata: {} }],
    });
    const result = await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('HQ');
    const snapshots = deps.ingest.mock.calls.map((c: any[]) => c[0].snapshot);
    // site-1 failed: nothing from it is tombstoned. site-2 completed, so its (stub) mapping is.
    expect(snapshots.some((s: any) => s.externalScopeId === 'host-1:site-1' && s.lifecycleState === 'tombstoned')).toBe(false);
    expect(snapshots.some((s: any) => s.externalDeviceId === 'sw-9')).toBe(true);
  });

  it('records a per-console 403 in errors[] without tombstoning that site or aborting', async () => {
    const client = {
      listDevices: vi.fn(async (site: any) => {
        if (site.siteId === 'site-1') throw new UniFiApiError('console denied', 'console_forbidden', 403);
        return [sw({ id: 'sw-9' })];
      }),
      getDevice: vi.fn(async () => sw({ id: 'sw-9' })),
    };
    const deps = baseDeps(client, {
      rmm_organization_mappings: [SITE, SITE2],
      tenant_external_entity_mappings: [{ external_entity_id: 'old-device', metadata: {} }],
    });
    const result = await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('HQ');
    const snapshots = deps.ingest.mock.calls.map((c: any[]) => c[0].snapshot);
    expect(snapshots.some((s: any) => s.externalScopeId === 'host-1:site-1' && s.lifecycleState === 'tombstoned')).toBe(false);
    expect(snapshots.some((s: any) => s.externalDeviceId === 'sw-9')).toBe(true);
  });

  it('does not tombstone when a site returns zero devices but has live mapped assets; warns instead', async () => {
    const client = { listDevices: vi.fn(async () => []), getDevice: vi.fn() };
    const deps = baseDeps(client, {
      rmm_organization_mappings: [SITE],
      tenant_external_entity_mappings: [
        { external_entity_id: 'a', metadata: {} },
        { external_entity_id: 'b', metadata: { deleted: true } },
      ],
    });
    const result = await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(result.errors?.some((e) => e.includes('site returned no devices; nothing removed'))).toBe(true);
  });

  it('an empty listing with only already-deleted mappings is quiet', async () => {
    const client = { listDevices: vi.fn(async () => []), getDevice: vi.fn() };
    const deps = baseDeps(client, {
      rmm_organization_mappings: [SITE],
      tenant_external_entity_mappings: [{ external_entity_id: 'b', metadata: { deleted: true } }],
    });
    const result = await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);
    expect(result.errors ?? []).toEqual([]);
  });

  it('aborts the whole run on an auth failure and reports a failed sync event', async () => {
    const client = {
      listDevices: vi.fn(async () => {
        throw new UniFiApiError('nope', 'auth', 401);
      }),
      getDevice: vi.fn(),
    };
    const deps = baseDeps(client, { rmm_organization_mappings: [SITE, SITE2], tenant_external_entity_mappings: [] });
    await expect(runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any)).rejects.toBeInstanceOf(UniFiApiError);
    expect(client.listDevices).toHaveBeenCalledTimes(1);
    expect(deps.ingest).not.toHaveBeenCalled();
    expect(deps.publishEvent.mock.calls.map((c: any[]) => c[0].event_name)).toContain('RMM_SYNC_FAILED');
  });

  it('keeps syncing when a detail fetch fails (uplink is best-effort)', async () => {
    const client = {
      listDevices: vi.fn(async () => [sw()]),
      getDevice: vi.fn(async () => {
        throw new UniFiApiError('x', 'http', 500);
      }),
    };
    const deps = baseDeps(client, { rmm_organization_mappings: [SITE], tenant_external_entity_mappings: [] });
    const result = await runUniFiFullSync({ tenant: 't', integrationId: 'int-1' }, deps as any);
    expect(result.success).toBe(true);
    expect(result.items_created).toBe(1);
  });
});

describe('runUniFiDeviceSync', () => {
  it('skips an unmapped site without calling the API', async () => {
    const client = { getDevice: vi.fn() };
    const deps = baseDeps(client, { rmm_organization_mappings: [] });
    const out = await runUniFiDeviceSync({ tenant: 't', integrationId: 'i', scopeKey: 'host-1:site-1', deviceId: 'sw-1' }, deps as any);
    expect(out.action).toBe('skipped');
    expect(client.getDevice).not.toHaveBeenCalled();
  });

  it('syncs one device for a mapped site', async () => {
    const client = { getDevice: vi.fn(async () => sw()) };
    const deps = baseDeps(client, { rmm_organization_mappings: [SITE] });
    const out = await runUniFiDeviceSync({ tenant: 't', integrationId: 'i', scopeKey: 'host-1:site-1', deviceId: 'sw-1' }, deps as any);
    expect(out.action).toBe('created');
    expect(deps.upsertFact).toHaveBeenCalled();
  });
});
