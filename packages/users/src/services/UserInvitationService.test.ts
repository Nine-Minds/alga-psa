import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  insert: vi.fn(),
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock('@alga-psa/db', () => ({
  requireTenantId: async () => 'tenant-1',
  tenantDb: () => ({
    table: () => ({
      where: () => ({
        where: () => ({ first: async () => undefined }),
        first: async () => undefined,
      }),
      insert: (row: Record<string, unknown>) => ({
        returning: async () => fixture.insert(row),
      }),
    }),
  }),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: async () => ({ user_id: 'inviter-1', first_name: 'Pat', last_name: 'Admin', username: 'pat' }),
}));
vi.mock('@alga-psa/auth', () => ({
  checkPortalInvitationLimit: async () => ({ success: true }),
  formatRateLimitError: async () => 'rate limited',
}));

import { UserInvitationService } from './UserInvitationService';

describe('UserInvitationService persistence schema compatibility', () => {
  beforeEach(() => {
    fixture.inserted.length = 0;
    fixture.insert.mockReset().mockImplementation(async (row: Record<string, unknown>) => {
      // Model the required email_normalized column found in the connected card
      // schema; PostgreSQL rejects inserts that omit a NOT NULL column.
      if (typeof row.email_normalized !== 'string') {
        throw new Error('null value in column "email_normalized" violates not-null constraint');
      }
      fixture.inserted.push(row);
      return [{ invitation_id: 'invite-1', token: row.token }];
    });
  });

  it('persists trimmed lowercase email and its normalized lookup key together', async () => {
    const result = await UserInvitationService.createInvitationWithTransaction(
      { email: '  New.User@Example.test  ', firstName: 'New', lastName: 'User', roleId: 'role-1' },
      { fn: { now: () => new Date() }, raw: (sql: string) => sql } as any,
    );

    expect(result.success).toBe(true);
    expect(fixture.inserted).toHaveLength(1);
    expect(fixture.inserted[0]).toMatchObject({
      email: 'new.user@example.test',
      email_normalized: 'new.user@example.test',
      tenant: 'tenant-1',
    });
  });
});
