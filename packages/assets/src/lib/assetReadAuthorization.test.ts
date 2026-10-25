import { describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

const rowsByTable: Record<string, unknown[]> = {
  user_roles: [{ role_id: 'role-from-db' }],
  team_members: [{ team_id: 'team-1' }],
  users: [{ user_id: 'report-1' }],
};

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      const query = {
        where: () => query,
        select: () => Promise.resolve(rowsByTable[name] ?? []),
      };
      return query;
    },
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

import { resolveAuthorizationSubjectForUser } from './assetReadAuthorization';

describe('resolveAuthorizationSubjectForUser', () => {
  it('accepts a service-principal session user and carries its user_type into the kernel subject', async () => {
    // Typed as the session user the label providers hand over, so a narrower AssetAuthUser.user_type
    // fails typecheck here as well as at the call sites.
    const serviceUser: IUserWithRoles = {
      user_id: 'svc-1',
      username: 'svc',
      email: 'svc@example.test',
      is_inactive: false,
      tenant: 'tenant-1',
      user_type: 'service',
      roles: [],
    };

    const subject = await resolveAuthorizationSubjectForUser({} as never, 'tenant-1', serviceUser);

    expect(subject).toEqual({
      tenant: 'tenant-1',
      userId: 'svc-1',
      userType: 'service',
      roleIds: ['role-from-db'],
      teamIds: ['team-1'],
      managedUserIds: ['report-1'],
      clientId: null,
      portfolioClientIds: [],
    });
  });
});
