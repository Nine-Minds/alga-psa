import { describe, expect, it, vi } from 'vitest';

let currentUser: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: vi.fn(), tenant: currentUser.tenant })),
}));

import { hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { fetchEligibleTimeEntrySubjects } from '@alga-psa/scheduling/actions/timeEntryDelegationActions';

describe('fetchEligibleTimeEntrySubjects', () => {
  it('returns self-only for non-delegates', async () => {
    currentUser = {
      tenant: 'tenant-1',
      user_id: 'user-1',
      user_type: 'internal',
      username: 'user',
      email: 'user@example.com',
      is_inactive: false,
    };

    vi.mocked(hasPermission).mockResolvedValue(false);

    const subjects = await fetchEligibleTimeEntrySubjects();
    expect(subjects).toHaveLength(1);
    expect(subjects[0].user_id).toBe(currentUser.user_id);
  });

  it('returns team members for managers (only managed teams)', async () => {
    currentUser = {
      tenant: 'tenant-1',
      user_id: 'manager-1',
      user_type: 'internal',
      username: 'manager',
      email: 'manager@example.com',
      is_inactive: false,
      first_name: 'Manny',
      last_name: 'Manager',
    };

    vi.mocked(hasPermission).mockImplementation(async (_user, resource, action) => {
      if (resource !== 'timesheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return false;
      return false;
    });

    const managedTeamUsers = [
      {
        user_id: 'report-1',
        username: 'report1',
        first_name: 'Rita',
        last_name: 'Report',
        email: 'report1@example.com',
        is_inactive: false,
        tenant: 'tenant-1',
        user_type: 'internal',
        timezone: 'America/Los_Angeles',
      },
      {
        user_id: 'report-2',
        username: 'report2',
        first_name: 'Remy',
        last_name: 'Report',
        email: 'report2@example.com',
        is_inactive: false,
        tenant: 'tenant-1',
        user_type: 'internal',
        timezone: 'America/New_York',
      },
    ];

    const qb: any = {
      join: () => qb,
      where: () => qb,
      distinct: async () => managedTeamUsers,
    };
    const fakeDb = vi.fn(() => qb) as any;

    vi.mocked(createTenantKnex).mockResolvedValue({ knex: fakeDb, tenant: currentUser.tenant } as any);

    const subjects = await fetchEligibleTimeEntrySubjects();
    const ids = subjects.map((u) => u.user_id);

    expect(ids).toContain('manager-1');
    expect(ids).toContain('report-1');
    expect(ids).toContain('report-2');
    expect(ids).not.toContain('outside-user');
  });
});
