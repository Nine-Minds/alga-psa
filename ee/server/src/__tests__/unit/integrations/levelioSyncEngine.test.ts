import { describe, expect, it, vi } from 'vitest';
import {
  runLevelIoAlertsBackfill,
  runLevelIoFullSync,
} from '../../../lib/integrations/levelio/sync/syncEngine';
import type { LevelIoApiClient } from '../../../lib/integrations/levelio/levelApiClient';

type RowsByTable = Record<string, any[]>;

function createKnexStub(rowsByTable: RowsByTable) {
  const inserted: Record<string, any[]> = {};
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
      insert: async (row: any) => {
        inserted[table] = inserted[table] ?? [];
        inserted[table].push(row);
        return [1];
      },
    };
    return builder;
  };
  knex.fn = { now: () => new Date() };
  knex._inserted = inserted;
  return knex;
}

const GROUPS = [
  { id: 'g-root', parent_id: null, name: 'Acme Corp' },
  { id: 'g-site', parent_id: 'g-root', name: 'Branch Office' },
];

describe('runLevelIoFullSync', () => {
  it('assigns devices to the deepest mapped ancestor, attaches patch counts, skips unmapped devices', async () => {
    const knex = createKnexStub({
      rmm_organization_mappings: [{ external_organization_id: 'g-root', client_id: 'client-1' }],
    });

    const client = {
      listGroups: vi.fn(async () => GROUPS),
      listDevices: vi.fn(async () => [
        { id: 'dev-1', hostname: 'WS-01', online: true, group_id: 'g-site' },
        { id: 'dev-2', hostname: 'WS-02', online: true, group_id: null },
      ]),
      listUpdates: vi.fn(async () => [
        { id: 'u-1', device_id: 'dev-1', device_hostname: 'WS-01', name: 'KB1', category: 'Security Updates', is_available: true },
        { id: 'u-2', device_id: 'dev-1', device_hostname: 'WS-01', name: 'KB2', category: 'Security Updates', is_available: true },
      ]),
    } as unknown as LevelIoApiClient;

    const ingest = vi.fn(async () => ({ externalDeviceId: 'dev-1', action: 'created' as const, assetId: 'asset-1' }));
    const publishEvent = vi.fn(async () => undefined);

    const result = await runLevelIoFullSync(
      { tenant: 'tenant-1', integrationId: 'int-1' },
      { knex, client, ingest, publishEvent }
    );

    expect(ingest).toHaveBeenCalledTimes(1);
    const ingestInput = ingest.mock.calls[0][0] as any;
    expect(ingestInput.snapshot.externalDeviceId).toBe('dev-1');
    expect(ingestInput.snapshot.externalScopeId).toBe('g-root');
    expect(ingestInput.snapshot.extension.pendingOsPatches).toBe(2);
    expect(ingestInput.resolvedClientId).toBe('client-1');

    expect(result.success).toBe(true);
    expect(result.sync_type).toBe('full');
    expect(result.items_processed).toBe(1);
    expect(result.items_created).toBe(1);
    expect(result.items_failed).toBe(0);

    const eventNames = publishEvent.mock.calls.map((call) => (call[0] as any).event_name);
    expect(eventNames).toEqual(['RMM_SYNC_STARTED', 'RMM_SYNC_COMPLETED']);
  });

  it('counts per-device ingestion failures without aborting and emits a completed event', async () => {
    const knex = createKnexStub({
      rmm_organization_mappings: [{ external_organization_id: 'g-root', client_id: 'client-1' }],
    });
    const client = {
      listGroups: vi.fn(async () => GROUPS),
      listDevices: vi.fn(async () => [
        { id: 'dev-1', hostname: 'WS-01', online: true, group_id: 'g-root' },
        { id: 'dev-2', hostname: 'WS-02', online: true, group_id: 'g-root' },
      ]),
      listUpdates: vi.fn(async () => []),
    } as unknown as LevelIoApiClient;

    const ingest = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ externalDeviceId: 'dev-2', action: 'updated' });

    const result = await runLevelIoFullSync(
      { tenant: 'tenant-1', integrationId: 'int-1' },
      { knex, client, ingest, publishEvent: vi.fn(async () => undefined) }
    );

    expect(result.success).toBe(false);
    expect(result.items_processed).toBe(2);
    expect(result.items_updated).toBe(1);
    expect(result.items_failed).toBe(1);
    expect(result.errors?.[0]).toContain('dev-1');
  });
});

describe('runLevelIoAlertsBackfill', () => {
  it('upserts active and resolved alerts with mapped severities and asset linkage', async () => {
    const knex = createKnexStub({
      tenant_external_entity_mappings: [{ external_entity_id: 'dev-1', alga_entity_id: 'asset-1' }],
      rmm_alerts: [],
    });

    const client = {
      listAlerts: vi.fn(async (params: { status: string }) =>
        params.status === 'active'
          ? [{
              id: 'al-1', device_id: 'dev-1', device_hostname: 'WS-01', name: 'Low disk',
              description: 'Disk free < 5%', severity: 'emergency', is_resolved: false,
              started_at: '2026-01-01T00:00:00.000Z',
            }]
          : [{
              id: 'al-2', device_id: 'dev-9', device_hostname: 'WS-09', name: 'CPU',
              description: 'High CPU', severity: 'warning', is_resolved: true,
              started_at: '2026-01-01T00:00:00.000Z', resolved_at: '2026-01-01T01:00:00.000Z',
            }]
      ),
    } as unknown as LevelIoApiClient;

    const result = await runLevelIoAlertsBackfill(
      { tenant: 'tenant-1', integrationId: 'int-1' },
      { knex, client, publishEvent: vi.fn(async () => undefined) }
    );

    expect(result.success).toBe(true);
    expect(result.sync_type).toBe('alerts');
    expect(result.items_processed).toBe(2);
    expect(result.items_created).toBe(2);

    const insertedAlerts = knex._inserted.rmm_alerts;
    expect(insertedAlerts).toHaveLength(2);
    expect(insertedAlerts[0].severity).toBe('critical');
    expect(insertedAlerts[0].asset_id).toBe('asset-1');
    expect(insertedAlerts[0].status).toBe('active');
    expect(insertedAlerts[1].severity).toBe('moderate');
    expect(insertedAlerts[1].asset_id).toBeNull();
    expect(insertedAlerts[1].status).toBe('resolved');
  });
});
