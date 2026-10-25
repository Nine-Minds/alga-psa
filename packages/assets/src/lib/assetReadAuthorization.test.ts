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
      select<T>(column: string): Promise<T> {
        const rows = (dbState[table] ?? []).filter((row) =>
          filters.every((where) => Object.entries(where).every(([key, value]) => row[key] === value))
        );
        return Promise.resolve(rows.map((row) => ({ [column]: row[column] })) as T);
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

import { resolveAuthorizationSubjectForUser } from './assetReadAuthorization';

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
