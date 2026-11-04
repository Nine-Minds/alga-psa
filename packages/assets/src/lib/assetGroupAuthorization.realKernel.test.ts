import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rules: [] as Row[],
  associationIds: [] as string[][],
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_trx: unknown, tenant: string) => ({
    table(name: string) {
      let rows = (h.tables[name] ?? []).filter((row) => row.tenant === tenant).map((row) => ({ ...row }));
      const query: any = {
        where(criteria: Row) {
          rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
          return query;
        },
        whereIn(key: string, values: string[]) {
          if (name === 'asset_associations') {
            h.associationIds.push([...values]);
            if (values.some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))) {
              throw new Error('invalid input syntax for type uuid');
            }
          }
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        select() { return Promise.resolve(rows); },
        first() { return Promise.resolve(rows[0]); },
        pluck(key: string) { return Promise.resolve(rows.map((row) => row[key])); },
      };
      return query;
    },
  }),
}));

// Keep bundle assignment loading at the database boundary while exercising the
// production asset resolver, bundle provider, relationship templates, and kernel.
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => h.rules),
}));

import { isAssetGroupOperationAllowed } from './assetGroupAuthorization';

describe('asset group authorization with the production asset resolver and kernel', () => {
  beforeEach(() => {
    h.rules = [];
    h.associationIds = [];
    h.tables = {
      clients: [{ tenant: TENANT, client_id: CLIENT }],
      asset_groups: [{ tenant: TENANT, group_id: GROUP, client_id: CLIENT }],
      asset_group_members: [{ tenant: TENANT, group_id: GROUP, asset_id: ASSET }],
      assets: [{ tenant: TENANT, asset_id: ASSET, client_id: CLIENT }],
      asset_associations: [],
      team_members: [],
      users: [],
    };
  });

  it('allows unrestricted member access without resolving a fabricated client asset id', async () => {
    await expect(isAssetGroupOperationAllowed({} as any, TENANT, { user_id: 'u1', user_type: 'internal', roles: ['r1'] }, { action: 'read', groupId: GROUP })).resolves.toBe(true);
    expect(h.associationIds).toEqual([[ASSET]]);
  });

  it('denies a selected-client restriction before resolving member relationships', async () => {
    h.rules = [{
      id: 'selected-client-read',
      resource: 'asset',
      action: 'read',
      templateKey: 'selected_clients',
      selectedClientIds: ['44444444-4444-4444-8444-444444444444'],
    }];

    await expect(isAssetGroupOperationAllowed({} as any, TENANT, { user_id: 'u1', user_type: 'internal', roles: ['r1'] }, { action: 'read', groupId: GROUP })).resolves.toBe(false);
    expect(h.associationIds).toEqual([]);
  });

  it('allows a team-scoped mutation when each real member is assigned to the caller team', async () => {
    h.tables.team_members = [{ tenant: TENANT, user_id: 'u1', team_id: 'team-1' }];
    h.tables.asset_associations = [{ tenant: TENANT, asset_id: ASSET, entity_type: 'team', entity_id: 'team-1' }];
    h.rules = [{ id: 'same-team-update', resource: 'asset', action: 'update', templateKey: 'same_team' }];

    await expect(isAssetGroupOperationAllowed({} as any, TENANT, { user_id: 'u1', user_type: 'internal', roles: ['r1'] }, { action: 'update', groupId: GROUP })).resolves.toBe(true);
    expect(h.associationIds).toEqual([[ASSET], [ASSET]]);
  });
});
