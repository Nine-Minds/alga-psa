import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleNarrowingRule } from '@alga-psa/authorization/kernel/providers/bundleProvider';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  permission: true,
  rules: [] as BundleNarrowingRule[],
  resolverFails: false,
  tables: {} as Record<string, Row[]>,
  permissionCalls: [] as unknown[][],
  resolverCalls: 0,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (...args: unknown[]) => { h.permissionCalls.push(args); return h.permission; }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: (table: string) => {
    let rows = [...(h.tables[table] ?? [])];
    let columns: string[] = [];
    const query: any = {
      where(criteria: Record<string, unknown>) {
        rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
        return query;
      },
      whereIn(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      // These fixtures have at most one association per asset, so ordering cannot change ownership.
      orderBy(_column: string, _direction?: 'asc' | 'desc') { return query; },
      select(...selected: string[]) { columns = selected; return query; },
      first() { return Promise.resolve(project(rows[0])); },
      then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(rows.map(project).filter((row): row is Row => row !== undefined)).then(resolve, reject);
      },
      catch(reject: (error: unknown) => unknown) { return Promise.resolve(rows.map(project).filter((row): row is Row => row !== undefined)).catch(reject); },
    };
    function project(row?: Row): Row | undefined {
      if (!row || columns.length === 0) return row;
      return Object.fromEntries(columns.map((column) => [column, row[column]]));
    }
    return query;
  } }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => {
    h.resolverCalls += 1;
    if (h.resolverFails) throw new Error('policy unavailable');
    return h.rules;
  }),
}));

import { assertAssetAccess } from './assetReadAuthorization';

const user = { user_id: 'user-1', user_type: 'internal' as const };
function selectedClients(action: 'read' | 'update' | 'delete', clientIds = ['client-1']) {
  return [{ id: `rule-${action}`, resource: 'asset', action, templateKey: 'selected_clients' as const, selectedClientIds: clientIds }];
}

function seed() {
  h.permission = true;
  h.rules = selectedClients('read');
  h.resolverFails = false;
  h.resolverCalls = 0;
  h.permissionCalls = [];
  h.tables = {
    assets: [{ asset_id: 'asset-1', client_id: 'client-1' }],
    asset_associations: [],
    user_roles: [],
    team_members: [],
    users: [],
  };
}

describe('assertAssetAccess with the authorization kernel', () => {
  beforeEach(seed);

  it.each(['read', 'update', 'delete'] as const)('requires the matching permission and selected-client policy for %s', async (action) => {
    h.rules = selectedClients(action);
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', action))
      .resolves.toEqual({ asset_id: 'asset-1', client_id: 'client-1' });
    expect(h.permissionCalls[0]).toEqual([user, 'asset', action, {}]);
    expect(h.resolverCalls).toBe(1);
  });

  it('denies an out-of-scope selected_clients asset using the same resolved rules', async () => {
    h.tables.assets[0].client_id = 'client-outside-policy';
    h.rules = selectedClients('read', ['client-allowed']);
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', 'read'))
      .rejects.toThrow('Asset not found');
    expect(h.resolverCalls).toBe(1);
  });

  it('allows team-scoped note access only when the requested asset belongs to the user\'s team', async () => {
    h.rules = [{ id: 'team-read', resource: 'asset', action: 'read', templateKey: 'same_team' }];
    h.tables.team_members = [{ user_id: user.user_id, team_id: 'team-1' }];
    h.tables.asset_associations = [
      { asset_id: 'asset-1', entity_type: 'team', entity_id: 'team-1' },
    ];

    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', 'read'))
      .resolves.toEqual({ asset_id: 'asset-1', client_id: 'client-1' });

    // A team association on a different asset must not grant access to this asset's notes.
    h.tables.asset_associations[0].asset_id = 'other-asset';
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', 'read'))
      .rejects.toThrow('Asset not found');
  });

  it.each(['read', 'update', 'delete'] as const)('allows an RBAC-authorized %s without bundle narrowing', async (action) => {
    h.rules = [];
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', action))
      .resolves.toEqual({ asset_id: 'asset-1', client_id: 'client-1' });
    expect(h.permissionCalls[0]).toEqual([user, 'asset', action, {}]);
    expect(h.resolverCalls).toBe(1);
  });

  it.each(['update', 'delete'] as const)('denies %s when the asset is outside the read policy', async (action) => {
    h.rules = selectedClients('read', ['client-outside-policy']);
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', action))
      .rejects.toThrow('Asset not found');
    expect(h.resolverCalls).toBe(1);
  });

  it('enforces client portal scope even without bundle narrowing', async () => {
    h.rules = [];
    const clientUser = { user_id: 'portal-1', user_type: 'client' as const, clientId: 'client-1' };
    await expect(assertAssetAccess({} as any, 'tenant-1', clientUser, 'asset-1', 'read'))
      .resolves.toEqual({ asset_id: 'asset-1', client_id: 'client-1' });
    await expect(assertAssetAccess({} as any, 'tenant-1', { ...clientUser, clientId: 'other-client' }, 'asset-1', 'read'))
      .rejects.toThrow('Asset not found');
  });

  it('fails closed when policy resolution throws', async () => {
    h.resolverFails = true;
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', 'read'))
      .rejects.toThrow('Asset not found');
    expect(h.resolverCalls).toBe(1);
  });

  it.each(['read', 'update', 'delete'] as const)('denies %s when the coarse asset permission is missing', async (action) => {
    h.permission = false;
    h.rules = [];
    await expect(assertAssetAccess({} as any, 'tenant-1', user, 'asset-1', action))
      .rejects.toThrow('Asset not found');
    expect(h.resolverCalls).toBe(0);
  });
});
