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
});

