import { describe, expect, it, vi } from 'vitest';

import { touchDattoDeviceLiveness } from '@ee/lib/integrations/datto/deviceLiveness';

function fakeKnex() {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const knex = {
    raw: vi.fn(async (sql: string, bindings: unknown[]) => {
      calls.push({ sql, bindings });
    }),
  };
  return { knex: knex as any, calls };
}

describe('touchDattoDeviceLiveness', () => {
  it('writes nothing for an empty batch', async () => {
    const { knex, calls } = fakeKnex();
    await touchDattoDeviceLiveness(knex, 'tenant-1', []);
    expect(calls).toHaveLength(0);
  });

  it('updates last_seen_at in one statement and uptime per extension table, tenant-scoped', async () => {
    const { knex, calls } = fakeKnex();
    await touchDattoDeviceLiveness(knex, 'tenant-1', [
      { assetId: 'a-ws', assetType: 'workstation', lastSeenAt: '2026-10-20T10:00:00.000Z', uptimeSeconds: 60 },
      { assetId: 'a-srv', assetType: 'server', lastSeenAt: 'not-a-date', uptimeSeconds: null },
      { assetId: 'a-net', assetType: 'network_device', lastSeenAt: null },
    ]);

    expect(calls).toHaveLength(3);

    const [assets, ...extensions] = calls;
    expect(assets.sql).toContain('UPDATE assets AS a');
    expect(assets.sql).toContain('a.tenant = ?::uuid');
    expect(assets.bindings).toEqual([
      'a-ws', new Date('2026-10-20T10:00:00.000Z'),
      'a-srv', null,
      'a-net', null,
      'tenant-1',
    ]);

    // Network devices have no extension table, so only two uptime updates.
    const byTable = Object.fromEntries(
      extensions.map((call) => [call.sql.match(/UPDATE (\w+) AS e/)![1], call.bindings])
    );
    expect(byTable).toEqual({
      workstation_assets: ['a-ws', 60, 'tenant-1'],
      server_assets: ['a-srv', null, 'tenant-1'],
    });
  });
});
