import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  trx: {},
  tables: {} as Record<string, Row[]>,
  rules: [] as Row[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal', roles: ['role-1'] }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, work: (trx: any) => Promise<unknown>) => work(h.trx)),
  tenantDb: (_trx: unknown, tenant: string) => ({
    table(name: string) {
      let rows = (h.tables[name] ?? []).filter((row) => row.tenant === tenant).map((row) => ({ ...row }));
      const ordering: Array<{ key: string; direction: 'asc' | 'desc' }> = [];
      const orderedRows = () => [...rows].sort((left, right) => {
        for (const { key, direction } of ordering) {
          const a = left[key];
          const b = right[key];
          if (a === b) continue;
          const comparison = a == null ? 1 : b == null ? -1 : a < b ? -1 : 1;
          return direction === 'asc' ? comparison : -comparison;
        }
        return 0;
      });
      const query: any = {
        where(criteria: Row) {
          rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
          return query;
        },
        whereIn(key: string, values: string[]) {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        orderBy(key: string, direction: 'asc' | 'desc' = 'asc') {
          ordering.push({ key, direction });
          return query;
        },
        select() { return Promise.resolve(orderedRows()); },
        first() { return Promise.resolve(orderedRows()[0]); },
        pluck(key: string) { return Promise.resolve(orderedRows().map((row) => row[key])); },
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => h.rules),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/assetGroups', () => ({
  isAssetGroupError: () => false,
  listGroupsForClient: vi.fn(async () => [
    { group_id: 'in-team', name: 'Visible group', description: 'Visible description', member_count: 1 },
    { group_id: 'out-team', name: 'Restricted group', description: 'Restricted description', member_count: 1 },
    { group_id: 'mixed', name: 'Mixed group', description: 'Mixed description', member_count: 2 },
  ]),
}));
vi.mock('@alga-psa/shared/models/assetTicketContactModel', () => ({ resolveAssetTicketContactOptions: vi.fn() }));
vi.mock('../../lib/assetChangeEvents', () => ({ publishAssetChanged: vi.fn() }));

import { listAssetGroups } from '../assetGroupActions';

describe('listAssetGroups with same_team asset read restrictions', () => {
  beforeEach(() => {
    h.rules = [{ id: 'same-team-read', resource: 'asset', action: 'read', templateKey: 'same_team' }];
    h.tables = {
      clients: [{ tenant: 'tenant-1', client_id: 'client-1' }],
      asset_groups: [
        { tenant: 'tenant-1', group_id: 'in-team', client_id: 'client-1' },
        { tenant: 'tenant-1', group_id: 'out-team', client_id: 'client-1' },
        { tenant: 'tenant-1', group_id: 'mixed', client_id: 'client-1' },
      ],
      asset_group_members: [
        { tenant: 'tenant-1', group_id: 'in-team', asset_id: 'asset-in' },
        { tenant: 'tenant-1', group_id: 'out-team', asset_id: 'asset-out' },
        { tenant: 'tenant-1', group_id: 'mixed', asset_id: 'asset-in' },
        { tenant: 'tenant-1', group_id: 'mixed', asset_id: 'asset-out' },
      ],
      assets: [
        { tenant: 'tenant-1', asset_id: 'asset-in', client_id: 'client-1' },
        { tenant: 'tenant-1', asset_id: 'asset-out', client_id: 'client-1' },
      ],
      team_members: [{ tenant: 'tenant-1', user_id: 'user-1', team_id: 'team-1' }],
      users: [],
      asset_associations: [
        { tenant: 'tenant-1', asset_id: 'asset-in', entity_type: 'team', entity_id: 'team-1' },
        { tenant: 'tenant-1', asset_id: 'asset-out', entity_type: 'team', entity_id: 'team-2' },
      ],
    };
  });

  it('returns only wholly in-team groups and omits all denied metadata', async () => {
    const result = await listAssetGroups('client-1');

    expect(result).toEqual([
      { group_id: 'in-team', name: 'Visible group', description: 'Visible description', member_count: 1 },
    ]);
    const serialized = JSON.stringify(result);
    for (const privateValue of ['out-team', 'Restricted group', 'Restricted description', 'mixed', 'Mixed group', 'Mixed description']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('removes a previously readable group after team membership is revoked', async () => {
    expect(await listAssetGroups('client-1')).toEqual([
      { group_id: 'in-team', name: 'Visible group', description: 'Visible description', member_count: 1 },
    ]);

    h.tables.team_members = [];

    expect(await listAssetGroups('client-1')).toEqual([]);
  });
});
