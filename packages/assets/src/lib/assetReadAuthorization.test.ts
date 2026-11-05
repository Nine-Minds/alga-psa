import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = { user_roles: [], team_members: [], users: [], assets: [], asset_associations: [] };
  const bundleRules: any[] = [];

  const tableQuery = (table: string) => {
    const filters: Array<Record<string, unknown>> = [];
    const inFilters: Array<{ column: string; values: unknown[] }> = [];
    let columns: string[] = [];
    const rows = () => (dbState[table] ?? []).filter((row) =>
      filters.every((where) => Object.entries(where).every(([key, value]) => row[key] === value)) &&
      inFilters.every(({ column, values }) => values.includes(row[column]))
    );
    const project = (row: Row) => columns.length ? Object.fromEntries(columns.map((column) => [column, row[column]])) : row;
    const query = {
      where(where: Record<string, unknown>) {
        filters.push(where);
        return query;
      },
      whereIn(column: string, values: unknown[]) {
        inFilters.push({ column, values });
        return query;
      },
      select(...selected: string[]) {
        columns = selected;
        return query;
      },
      first() { const row = rows()[0]; return Promise.resolve(row ? project(row) : undefined); },
      then(resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(rows().map(project)).then(resolve, reject);
      },
      catch(reject: (reason: unknown) => unknown) {
        return Promise.resolve(rows().map(project)).catch(reject);
      },
    };
    return query;
  };

  return { dbState, bundleRules, tableQuery };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: (table: string) => h.tableQuery(table) }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => h.bundleRules),
}));

import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '@alga-psa/authorization/kernel';
import { isAssetActionAllowed, isAssetReadAllowed, loadReadableAssetById, resolveAuthorizationSubjectForUser } from './assetReadAuthorization';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

function sessionUser(overrides: Partial<IUserWithRoles>): IUserWithRoles {
  return {
    user_id: 'user-1',
    username: 'user-1',
    email: 'user-1@example.com',
    is_inactive: false,
    tenant: 'tenant-a',
    user_type: 'internal',
    roles: [],
    ...overrides,
  } as IUserWithRoles;
}

describe('resolveAuthorizationSubjectForUser', () => {
  beforeEach(() => {
    h.dbState.user_roles = [];
    h.dbState.team_members = [];
    h.dbState.users = [];
  });

  it('keeps a service principal as a service subject instead of narrowing it to internal or client', async () => {
    h.dbState.user_roles = [{ user_id: 'svc-1', role_id: 'role-msp-automation' }];
    h.dbState.team_members = [{ user_id: 'svc-1', team_id: 'team-ops' }];

    // Typed as the session user the label providers receive, so the shared asset auth input must
    // accept every users.user_type value, including 'service'.
    const user = sessionUser({ user_id: 'svc-1', user_type: 'service' });

    const subject = await resolveAuthorizationSubjectForUser({} as any, 'tenant-a', user);

    expect(subject).toEqual({
      tenant: 'tenant-a',
      userId: 'svc-1',
      userType: 'service',
      roleIds: ['role-msp-automation'],
      teamIds: ['team-ops'],
      managedUserIds: [],
      clientId: null,
      portfolioClientIds: [],
    });
  });

  it('scopes a client portal user to their own client', async () => {
    const user = { ...sessionUser({ user_id: 'portal-1', user_type: 'client' }), clientId: 'client-9' };

    const subject = await resolveAuthorizationSubjectForUser({} as any, 'tenant-a', user);

    expect(subject.userType).toBe('client');
    expect(subject.clientId).toBe('client-9');
    expect(subject.portfolioClientIds).toEqual(['client-9']);
  });
});

describe('isAssetActionAllowed', () => {
  // Restricted Asset Operator as shipped: read = selected clients, update = same team.
  const rules = [
    { id: 'r1', resource: 'asset', action: 'read', templateKey: 'selected_clients' as const, selectedClientIds: ['client-a'] },
    { id: 'r2', resource: 'asset', action: 'update', templateKey: 'same_team' as const },
  ];
  const context = () => ({
    subject: {
      tenant: 'tenant-a', userId: 'user-1', userType: 'internal' as const, roleIds: [], teamIds: ['team-ops'],
      managedUserIds: [], clientId: null, portfolioClientIds: [],
    },
    authorizationKernel: createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: async () => rules }),
      rbacEvaluator: async () => true,
    }),
    requestCache: new RequestLocalAuthorizationCache(),
  });

  it('evaluates the bundle rule for the requested action: readable but not updatable outside the team', async () => {
    h.dbState.asset_associations = [];
    const ctx = context();
    const asset = { asset_id: 'asset-1', client_id: 'client-a' };

    expect(await isAssetActionAllowed({} as any, 'tenant-a', ctx, asset, 'read')).toBe(true);
    expect(await isAssetActionAllowed({} as any, 'tenant-a', ctx, asset, 'update')).toBe(false);
    expect(await isAssetReadAllowed({} as any, 'tenant-a', ctx, asset)).toBe(true);
  });

  it('allows update once the asset belongs to the subject\'s team', async () => {
    h.dbState.asset_associations = [{ asset_id: 'asset-2', entity_type: 'team', entity_id: 'team-ops' }];
    const asset = { asset_id: 'asset-2', client_id: 'client-a' };

    expect(await isAssetActionAllowed({} as any, 'tenant-a', context(), asset, 'update')).toBe(true);
  });

  it('does not narrow an action the bundle has no rule for', async () => {
    h.dbState.asset_associations = [];
    expect(await isAssetActionAllowed({} as any, 'tenant-a', context(), { asset_id: 'asset-3', client_id: 'client-z' }, 'delete')).toBe(true);
  });
});

describe('loadReadableAssetById', () => {
  const user = sessionUser({ user_id: 'user-1', user_type: 'internal' });
  const readRule = {
    id: 'read-scope', resource: 'asset', action: 'read', templateKey: 'selected_clients' as const,
    selectedClientIds: ['client-a'],
  };

  beforeEach(() => {
    h.dbState.assets = [];
    h.dbState.asset_associations = [];
    h.bundleRules.splice(0, h.bundleRules.length, readRule);
  });

  it('loads the asset and applies the record-level read decision in the supplied transaction', async () => {
    h.dbState.assets.push({ asset_id: 'asset-a', client_id: 'client-a' }, { asset_id: 'asset-b', client_id: 'client-b' });

    expect(await loadReadableAssetById({} as any, 'tenant-a', user, 'asset-a')).toEqual({ asset_id: 'asset-a', client_id: 'client-a' });
    expect(await loadReadableAssetById({} as any, 'tenant-a', user, 'asset-b')).toBeNull();
    expect(await loadReadableAssetById({} as any, 'tenant-a', user, 'asset-missing')).toBeNull();
    expect(resolveBundleNarrowingRulesForEvaluation).toHaveBeenCalled();
  });
});
