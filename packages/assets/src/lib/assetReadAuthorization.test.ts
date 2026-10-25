import { describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      where: () => ({
        select: async () => [],
      }),
    }),
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => [],
}));

import { resolveAuthorizationSubjectForUser } from './assetReadAuthorization';

describe('resolveAuthorizationSubjectForUser', () => {
  it('accepts a service-principal session user and preserves its user type on the subject', async () => {
    const user: Pick<IUserWithRoles, 'user_id' | 'user_type' | 'roles'> = {
      user_id: 'svc-1',
      user_type: 'service',
      roles: [{ role_id: 'role-a' } as IUserWithRoles['roles'][number]],
    };

    const subject = await resolveAuthorizationSubjectForUser({} as any, 'tenant-1', user);

    expect(subject).toMatchObject({
      tenant: 'tenant-1',
      userId: 'svc-1',
      userType: 'service',
      roleIds: ['role-a'],
      clientId: null,
    });
  });
});
