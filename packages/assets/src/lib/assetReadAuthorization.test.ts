import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = { user_roles: [], team_members: [], users: [] };

  const tableQuery = (table: string) => {
    const filters: Array<Record<string, unknown>> = [];
    const query = {
      where(where: Record<string, unknown>) {
        filters.push(where);
        return query;
      },
      whereIn(_column: string, _values: unknown[]) {
        return query;
      },
      select<T>(...columns: string[]): Promise<T> {
        const rows = (dbState[table] ?? []).filter((row) =>
          filters.every((where) => Object.entries(where).every(([key, value]) => row[key] === value))
        );
        return Promise.resolve(rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))) as T);
      },
    };
    return query;
  };

  return { dbState, tableQuery };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: (table: string) => h.tableQuery(table) }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
} from '@alga-psa/authorization/kernel';
import { isAssetActionAllowed, isAssetReadAllowed, resolveAuthorizationSubjectForUser } from './assetReadAuthorization';

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
