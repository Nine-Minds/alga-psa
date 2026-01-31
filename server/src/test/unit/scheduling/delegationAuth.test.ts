import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
    ...actual,
    hasPermission: vi.fn(),
  };
});

import { hasPermission } from '@alga-psa/auth';
import { assertCanActOnBehalf } from '@alga-psa/scheduling/actions/timeEntryDelegationAuth';

describe('assertCanActOnBehalf', () => {
  it('allows self access', async () => {
    const actor = {
      tenant: 'tenant-1',
      user_id: 'actor-1',
      user_type: 'internal',
      username: 'actor',
      email: 'actor@example.com',
      is_inactive: false,
    };

    const db = vi.fn(() => {
      throw new Error('db should not be called for self access');
    }) as any;

    await expect(assertCanActOnBehalf(actor as any, actor.tenant, actor.user_id, db)).resolves.toBe('self');
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('allows tenant-wide access for approve + read_all', async () => {
    const actor = {
      tenant: 'tenant-1',
      user_id: 'admin-1',
      user_type: 'internal',
      username: 'admin',
      email: 'admin@example.com',
      is_inactive: false,
    };

    vi.mocked(hasPermission).mockImplementation(async (_user, resource, action) => {
      if (resource !== 'timesheet') return false;
      return action === 'approve' || action === 'read_all';
    });

    const db = vi.fn(() => {
      throw new Error('db should not be called for tenant-wide access');
    }) as any;

    await expect(assertCanActOnBehalf(actor as any, actor.tenant, 'subject-1', db)).resolves.toBe('tenant-wide');
  });
});
