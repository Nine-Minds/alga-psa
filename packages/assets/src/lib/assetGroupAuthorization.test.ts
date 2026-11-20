import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  allowedClients: new Set<string>(['c1']),
  deniedAssets: new Set<string>(),
  deniedUpdateAssets: new Set<string>(),
  tables: {} as Record<string, Row[]>,
  seen: [] as Array<{ asset_id: string; client_id: string | null; action: string }>,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, tenant: string) => ({
    table(name: string) {
      let rows = (h.tables[name] ?? []).filter((row) => row.tenant === tenant).map((row) => ({ ...row }));
      const query: any = {
        where(criteria: Row) { rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value)); return query; },
        whereIn(key: string, values: string[]) { rows = rows.filter((row) => values.includes(row[key])); return query; },
        select() { return Promise.resolve(rows); },
        first() { return Promise.resolve(rows[0]); },
        pluck(key: string) { return Promise.resolve(rows.map((row) => row[key])); },
      };
      return query;
    },
  }),
}));
vi.mock('./assetReadAuthorization', () => ({
  isAssetReadAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, asset: { asset_id: string; client_id?: string | null }) => {
    h.seen.push({ asset_id: asset.asset_id, client_id: asset.client_id ?? null, action: 'read' });
    return h.allowedClients.has(asset.client_id ?? '') && !h.deniedAssets.has(asset.asset_id);
  }),
  createAssetReadContext: vi.fn(async () => ({})),
  isAssetClientActionAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, clientId: string) => h.allowedClients.has(clientId)),
  isAssetActionAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, asset: { asset_id: string; client_id?: string | null }, action: string) => {
    h.seen.push({ asset_id: asset.asset_id, client_id: asset.client_id ?? null, action });
    return h.allowedClients.has(asset.client_id ?? '')
      && !h.deniedAssets.has(asset.asset_id)
      && !(action === 'update' && h.deniedUpdateAssets.has(asset.asset_id));
  }),
}));

import { isAssetGroupOperationAllowed } from './assetGroupAuthorization';

describe('asset group authorization boundary', () => {
  beforeEach(() => {
    h.allowedClients = new Set(['c1']);
    h.deniedAssets = new Set();
    h.deniedUpdateAssets = new Set();
    h.seen = [];
    h.tables = {
      clients: [{ tenant: 't1', client_id: 'c1' }, { tenant: 't1', client_id: 'c2' }, { tenant: 't2', client_id: 'c2' }],
      asset_groups: [
        { tenant: 't1', group_id: 'g1', client_id: 'c1' },
        { tenant: 't1', group_id: 'mixed', client_id: 'c1' },
        { tenant: 't2', group_id: 'g2', client_id: 'c2' },
      ],
      asset_group_members: [
        { tenant: 't1', group_id: 'g1', asset_id: 'a1' },
        { tenant: 't1', group_id: 'mixed', asset_id: 'a1' },
        { tenant: 't1', group_id: 'mixed', asset_id: 'a2' },
        { tenant: 't2', group_id: 'g2', asset_id: 'a2' },
      ],
      assets: [
        { tenant: 't1', asset_id: 'a1', client_id: 'c1' },
        { tenant: 't1', asset_id: 'a2', client_id: 'c1' },
        { tenant: 't1', asset_id: 'a3', client_id: 'c2' },
        { tenant: 't2', asset_id: 'a2', client_id: 'c2' },
      ],
    };
  });

  it('allows an in-scope group only after authorizing its client and every member', async () => {
    await expect(isAssetGroupOperationAllowed({} as any, 't1', { user_id: 'u1' } as any, { action: 'read', groupId: 'g1' })).resolves.toBe(true);
    expect(h.seen.map((item) => item.client_id)).toEqual(['c1']);
  });

  it('denies a mixed-member group as a whole', async () => {
    h.deniedAssets.add('a2');
    await expect(isAssetGroupOperationAllowed({} as any, 't1', { user_id: 'u1' } as any, { action: 'read', groupId: 'mixed' })).resolves.toBe(false);
    expect(h.seen.some((item) => item.asset_id === 'a2')).toBe(true);
  });

  it('requires update scope on each affected member as well as read scope', async () => {
    h.deniedUpdateAssets.add('a1');
    await expect(isAssetGroupOperationAllowed({} as any, 't1', { user_id: 'u1' } as any, { action: 'update', groupId: 'g1' })).resolves.toBe(false);
    expect(h.seen.map((item) => item.action)).toEqual(['read', 'update']);
  });

  it('rejects foreign-tenant group and client identifiers', async () => {
    await expect(isAssetGroupOperationAllowed({} as any, 't1', { user_id: 'u1' } as any, { action: 'read', groupId: 'g2' })).resolves.toBe(false);
    await expect(isAssetGroupOperationAllowed({} as any, 't1', { user_id: 'u1' } as any, { action: 'read', clientId: 'foreign-client' })).resolves.toBe(false);
  });

  it('rejects a supplied cross-client or missing asset before authorization can permit a write', async () => {
    await expect(isAssetGroupOperationAllowed({} as any, 't1', { user_id: 'u1' } as any, { action: 'update', clientId: 'c1', assetIds: ['a3'] })).resolves.toBe(false);
    await expect(isAssetGroupOperationAllowed({} as any, 't1', { user_id: 'u1' } as any, { action: 'update', clientId: 'c1', assetIds: ['missing'] })).resolves.toBe(false);
    expect(h.seen).toHaveLength(0);
  });
});
