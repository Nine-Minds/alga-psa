import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runLevelIoFullSync } from '../../lib/integrations/levelio/sync/syncEngine';

/**
 * Level.io incremental device sync.
 *
 * Level.io has no server-side delta — /v2/devices takes only group filters and
 * `starting_after` is a pagination cursor by item id — so "incremental" is the
 * same page walk with the result filtered on last_seen_at. These tests pin the
 * filter, because getting it wrong is silent: too strict and devices stop
 * updating, too loose and the sync is no cheaper than a full one.
 */

function device(id: string, lastSeenAt: string | null) {
  return {
    id,
    group_id: 'group-1',
    hostname: `host-${id}`,
    last_seen_at: lastSeenAt,
    online: true,
    network_interfaces: [],
    operating_system: {},
    security: {},
  };
}

function buildDeps(devices: unknown[]) {
  const ingest = vi.fn().mockResolvedValue({ action: 'updated' });
  const knex = {
    fn: { now: () => new Date() },
  } as never;

  return {
    ingest,
    deps: {
      knex,
      client: {
        listGroups: vi.fn().mockResolvedValue([{ id: 'group-1', parent_id: null }]),
        listDevices: vi.fn().mockResolvedValue(devices),
        listUpdates: vi.fn().mockResolvedValue([]),
      },
      ingest,
      publishEvent: vi.fn().mockResolvedValue(undefined),
    } as never,
  };
}

// The sync engine walks tenantDb for org mappings and for status updates.
// A permissive chainable stub keeps the test about the filter, not the query
// builder: every builder method returns the chain, and terminal calls resolve.
vi.mock('@alga-psa/db', () => {
  const mappings = [{ external_organization_id: 'group-1', client_id: 'client-1' }];
  const chain: Record<string, unknown> = {};
  for (const method of ['table', 'where', 'whereNotNull', 'andWhere', 'whereIn', 'first']) {
    chain[method] = () => chain;
  }
  chain.select = async () => mappings;
  chain.update = async () => 1;
  chain.then = undefined;
  return {
    tenantDb: () => chain,
    createTenantKnex: async () => ({ knex: {} }),
  };
});

const args = { tenant: 'tenant-1', integrationId: 'integration-1' };

describe('Level.io incremental device sync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ingests only devices seen at or after the cursor', async () => {
    const { deps, ingest } = buildDeps([
      device('fresh', '2026-08-13T10:00:00.000Z'),
      device('stale', '2026-08-01T10:00:00.000Z'),
    ]);

    await runLevelIoFullSync(args, deps, {
      syncType: 'incremental',
      since: new Date('2026-08-13T09:00:00.000Z'),
    });

    const ingested = ingest.mock.calls.map(
      ([arg]: [{ snapshot: { externalDeviceId: string } }]) => arg.snapshot.externalDeviceId,
    );
    expect(ingested).toEqual(['fresh']);
  });

  it('treats a device seen exactly at the cursor as changed', async () => {
    // Inclusive on purpose: an exclusive bound drops a device that changed in
    // the same instant the previous run recorded as its cursor.
    const at = '2026-08-13T09:00:00.000Z';
    const { deps, ingest } = buildDeps([device('boundary', at)]);

    await runLevelIoFullSync(args, deps, { syncType: 'incremental', since: new Date(at) });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('always considers a device with no last_seen_at', async () => {
    // Absent data must not exclude a device from every incremental run forever.
    const { deps, ingest } = buildDeps([device('never-seen', null)]);

    await runLevelIoFullSync(args, deps, {
      syncType: 'incremental',
      since: new Date('2026-08-13T09:00:00.000Z'),
    });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('always considers a device whose last_seen_at is unparseable', async () => {
    const { deps, ingest } = buildDeps([device('bad-date', 'not a date')]);

    await runLevelIoFullSync(args, deps, {
      syncType: 'incremental',
      since: new Date('2026-08-13T09:00:00.000Z'),
    });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it('ingests every device when no cursor is given (full sync unchanged)', async () => {
    const { deps, ingest } = buildDeps([
      device('a', '2026-08-13T10:00:00.000Z'),
      device('b', '2020-01-01T00:00:00.000Z'),
    ]);

    await runLevelIoFullSync(args, deps);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it('reports the run as incremental rather than full', async () => {
    const { deps } = buildDeps([device('a', '2026-08-13T10:00:00.000Z')]);

    const result = await runLevelIoFullSync(args, deps, {
      syncType: 'incremental',
      since: new Date('2026-08-13T09:00:00.000Z'),
    });
    expect(result.sync_type).toBe('incremental');
  });
});
