import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// getCurrentUser reads the session via the local ./getSession module.
vi.mock('./getSession', () => ({
  getSession: vi.fn(),
}));

// User lookups now go through the @alga-psa/db helpers directly.
vi.mock('@alga-psa/db', () => ({
  getUserWithRoles: vi.fn(),
  getUserWithRolesByEmail: vi.fn(),
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
}));

import { getCurrentUser } from './getCurrentUser';
import { getSession } from './getSession';
import { getUserWithRoles } from '@alga-psa/db';

const envSnapshot = { ...process.env };

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(getUserWithRoles).mockReset();
});

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe('getCurrentUser', () => {
  // Note: avatarUrl is intentionally NOT resolved by getCurrentUser anymore —
  // it caused a circular dependency with @alga-psa/documents. Callers needing
  // the avatar use getUserAvatarUrl separately.
  it('returns user with roles when session has id and tenant', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
      },
    } as any);

    vi.mocked(getUserWithRoles).mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
      roles: [{ role_id: 'role-1' }],
    } as any);

    const user = await getCurrentUser();

    expect(vi.mocked(getUserWithRoles)).toHaveBeenCalledWith('user-1', 'tenant-1');
    expect(user?.user_id).toBe('user-1');
    expect(user?.tenant).toBe('tenant-1');
    expect(user?.roles).toEqual([{ role_id: 'role-1' }]);
  });

  it('returns null when session is missing', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('returns null when the session user cannot be found', async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
      },
    } as any);

    vi.mocked(getUserWithRoles).mockResolvedValue(null as any);

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});
