import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@alga-psa/documents/lib/avatarUtils', () => ({
  getUserAvatarUrl: vi.fn(async () => 'https://avatar.test/user.png'),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: any) => Promise<any>) => {
    const user = {
      user_id: 'user-1',
      tenant: 'tenant-1',
    };
    const roles = [{ role_id: 'role-1' }];

    const userQuery = {
      select: () => ({
        where: () => ({
          where: () => ({
            first: async () => user,
          }),
        }),
      }),
    };

    const rolesQuery = {
      join: () => rolesQuery,
      where: () => rolesQuery,
      select: async () => roles,
    };

    const trx = ((table: string) => {
      if (table === 'users') {
        return userQuery;
      }
      if (table === 'roles') {
        return rolesQuery;
      }
      return rolesQuery;
    }) as any;

    return await callback(trx);
  }),
}));

import { getCurrentUser } from './getCurrentUser';

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe('getCurrentUser', () => {
  it('returns user with roles and avatar when session has id and tenant', async () => {
    const { getSession } = await import('@alga-psa/auth');
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-1',
      },
    } as any);

    const user = await getCurrentUser();

    expect(user?.user_id).toBe('user-1');
    expect(user?.tenant).toBe('tenant-1');
    expect(user?.roles).toEqual([{ role_id: 'role-1' }]);
    expect(user?.avatarUrl).toBe('https://avatar.test/user.png');
  });

  it('returns null when session is missing', async () => {
    const { getSession } = await import('@alga-psa/auth');
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it('throws when tenant context mismatches session tenant', async () => {
    const { getSession } = await import('@alga-psa/auth');
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: 'user-1',
        tenant: 'tenant-2',
      },
    } as any);

    const { createTenantKnex } = await import('@alga-psa/db');
    vi.mocked(createTenantKnex).mockResolvedValue({ knex: {}, tenant: 'tenant-1' });

    await expect(getCurrentUser()).rejects.toThrow('Tenant context mismatch');
  });
});
