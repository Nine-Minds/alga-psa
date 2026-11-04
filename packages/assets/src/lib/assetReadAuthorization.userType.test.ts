/**
 * Asset read authorization accepts every `users.user_type`, including the non-interactive
 * 'service' principal. The label providers pass the session user (IUserWithRoles) straight
 * through, so the subject must carry the real user type to the kernel rather than requiring
 * callers to narrow it to internal | client.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

const TENANT = 'a0000000-0000-4000-8000-00000000000a';

const h = vi.hoisted(() => {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const tenantDb = vi.fn((_knex: unknown, _tenant: string) => ({
    table: (name: string) => {
      let filter: Record<string, unknown> = {};
      const builder = {
        where(criteria: Record<string, unknown>) {
          filter = criteria;
          return builder;
        },
        select: async () =>
          (tables[name] ?? []).filter((row) =>
            Object.entries(filter).every(([key, value]) => row[key] === value)
          ),
      };
      return builder;
    },
  }));
  return { tables, tenantDb };
});

vi.mock('@alga-psa/db', () => ({ tenantDb: h.tenantDb }));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

import { resolveAuthorizationSubjectForUser } from './assetReadAuthorization';

function sessionUser(overrides: Partial<IUserWithRoles>): IUserWithRoles {
  return {
    user_id: 'u0000000-0000-4000-8000-000000000001',
    username: 'svc-integration',
    email: 'svc@example.com',
    is_inactive: false,
    tenant: TENANT,
    user_type: 'internal',
    roles: [],
    ...overrides,
  };
}

describe('resolveAuthorizationSubjectForUser user types', () => {
  beforeEach(() => {
    for (const key of Object.keys(h.tables)) delete h.tables[key];
  });

  it('carries a service principal through as userType service with MSP scope', async () => {
    const user = sessionUser({
      user_type: 'service',
      roles: [{ role_id: 'r-service', role_name: 'Integration', description: '', tenant: TENANT } as any],
    });
    h.tables.team_members = [{ user_id: user.user_id, team_id: 'team-1' }];

    const subject = await resolveAuthorizationSubjectForUser({} as any, TENANT, user);

    expect(subject).toEqual({
      tenant: TENANT,
      userId: user.user_id,
      userType: 'service',
      roleIds: ['r-service'],
      teamIds: ['team-1'],
      managedUserIds: [],
      clientId: null,
      portfolioClientIds: [],
    });
  });

  it('keeps a client user scoped to their client', async () => {
    const user = sessionUser({ user_type: 'client', clientId: 'client-1', roles: [] });
    h.tables.user_roles = [{ user_id: user.user_id, role_id: 'r-client' }];

    const subject = await resolveAuthorizationSubjectForUser({} as any, TENANT, user);

    expect(subject.userType).toBe('client');
    expect(subject.roleIds).toEqual(['r-client']);
    expect(subject.clientId).toBe('client-1');
    expect(subject.portfolioClientIds).toEqual(['client-1']);
  });
});
