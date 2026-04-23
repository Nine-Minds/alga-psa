import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const getAdminConnectionMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const hashPasswordMock = vi.hoisted(() => vi.fn());
const revalidatePathMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());
const userUpdateMock = vi.hoisted(() => vi.fn());
const getUserWithRolesMock = vi.hoisted(() => vi.fn());
const isInReportsToChainMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) => {
    return (...args: any[]) => {
      if (args.length === 1) {
        return fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, args[0]);
      }
      return fn(...args);
    };
  },
  withOptionalAuth: (fn: (...args: any[]) => any) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
  withAdminTransaction: vi.fn(),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    update: userUpdateMock,
    getUserWithRoles: getUserWithRolesMock,
    isInReportsToChain: isInReportsToChainMock,
  },
}));

vi.mock('@alga-psa/core/encryption', () => ({
  hashPassword: hashPasswordMock,
}));

vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: hasPermissionMock,
  throwPermissionError: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock('@alga-psa/db/models/userPreferences', () => ({
  default: {
    upsert: upsertMock,
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function createAdminDb(existingUserId?: string) {
  return ((table: string) => {
    if (table !== 'users') {
      throw new Error(`Unexpected admin table ${table}`);
    }

    return {
      where: (_criteria: Record<string, any>) => ({
        whereNot: (_column: string, _value: string) => ({
          first: async () => (existingUserId ? { user_id: existingUserId } : null),
        }),
        first: async () => (existingUserId ? { user_id: existingUserId } : null),
      }),
    };
  }) as any;
}

function createTenantDb(input: { plan: 'solo' | 'pro'; licensedUserCount: number | null; usedInternalUsers: number }) {
  return ((table: string) => {
    if (table === 'roles') {
      return {
        where: (_criteria: Record<string, any>) => ({
          first: async () => ({ role_id: 'role-1', client: false, msp: true }),
        }),
      };
    }

    if (table === 'tenants') {
      return {
        where: (_criteria: Record<string, any>) => ({
          first: async () => ({
            licensed_user_count: input.licensedUserCount,
            plan: input.plan,
          }),
        }),
      };
    }

    if (table === 'users') {
      return {
        where: (_criteria: Record<string, any>) => ({
          count: async () => [{ count: String(input.usedInternalUsers) }],
        }),
        insert: (values: Record<string, any>) => ({
          returning: async () => [{ user_id: 'new-user', ...values }],
        }),
      };
    }

    if (table === 'user_roles') {
      return {
        insert: async (_values: Record<string, any>) => [],
      };
    }

    throw new Error(`Unexpected tenant table ${table}`);
  }) as any;
}

describe('addUser', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    getAdminConnectionMock.mockReset();
    withTransactionMock.mockReset();
    hasPermissionMock.mockReset();
    hashPasswordMock.mockReset();
    revalidatePathMock.mockReset();
    upsertMock.mockReset();
    userUpdateMock.mockReset();
    getUserWithRolesMock.mockReset();
    isInReportsToChainMock.mockReset();

    hasPermissionMock.mockResolvedValue(true);
    hashPasswordMock.mockResolvedValue('hashed-password');
    upsertMock.mockResolvedValue(undefined);
    revalidatePathMock.mockReturnValue(undefined);
    userUpdateMock.mockResolvedValue(undefined);
    getUserWithRolesMock.mockResolvedValue({
      user_id: 'user-1',
      email: 'updated@example.com',
    });
    isInReportsToChainMock.mockResolvedValue(false);

    withTransactionMock.mockImplementation(async (db: any, callback: (trx: any) => Promise<any>) => callback(db));
    getAdminConnectionMock.mockResolvedValue(createAdminDb());
  });

  async function loadAddUser() {
    const mod = await import('./userActions');
    return mod.addUser as any;
  }

  async function loadUpdateUser() {
    const mod = await import('./userActions');
    return mod.updateUser as any;
  }

  const actingUser = { user_id: 'user-1', user_type: 'internal' } as any;
  const tenantContext = { tenant: 'tenant-1' };
  const userData = {
    firstName: 'Solo',
    lastName: 'User',
    email: 'solo@example.com',
    password: 'password123',
    roleId: 'role-1',
    userType: 'internal' as const,
  };

  it('rejects adding a second internal user on the Solo plan', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createTenantDb({ plan: 'solo', licensedUserCount: 1, usedInternalUsers: 1 }),
    });

    const addUser = await loadAddUser();
    const result = await addUser(actingUser, tenantContext, userData);

    expect(result).toEqual({
      success: false,
      code: 'SOLO_PLAN_LIMIT',
      error: 'Solo plan is limited to 1 user. Upgrade to Pro to add more users.',
    });
  });

  it('allows adding the first internal user on the Solo plan', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createTenantDb({ plan: 'solo', licensedUserCount: 1, usedInternalUsers: 0 }),
    });

    const addUser = await loadAddUser();
    const result = await addUser(actingUser, tenantContext, userData);

    expect(result).toMatchObject({
      success: true,
      user: {
        email: 'solo@example.com',
        user_type: 'internal',
      },
    });
  });

  it('does not apply the Solo restriction to Pro tenants', async () => {
    createTenantKnexMock.mockResolvedValue({
      knex: createTenantDb({ plan: 'pro', licensedUserCount: 5, usedInternalUsers: 1 }),
    });

    const addUser = await loadAddUser();
    const result = await addUser(actingUser, tenantContext, userData);

    expect(result).toMatchObject({
      success: true,
      user: {
        email: 'solo@example.com',
      },
    });
  });

  it('rejects updating an email when another tenant already uses it', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    getAdminConnectionMock.mockResolvedValue(createAdminDb('other-tenant-user'));

    const updateUser = await loadUpdateUser();

    const result = await updateUser(actingUser, tenantContext, actingUser.user_id, {
      email: 'duplicate@example.com',
    });

    expect(result).toEqual({
      success: false,
      code: 'EMAIL_ALREADY_EXISTS',
      error: 'A user with this email address already exists',
    });
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('normalizes updated email addresses to lowercase before saving', async () => {
    createTenantKnexMock.mockResolvedValue({ knex: {} });

    const updateUser = await loadUpdateUser();
    const result = await updateUser(actingUser, tenantContext, actingUser.user_id, {
      email: 'Updated@Example.com',
      first_name: 'Updated',
    });

    expect(userUpdateMock).toHaveBeenCalledWith(
      {},
      actingUser.user_id,
      expect.objectContaining({
        email: 'updated@example.com',
        first_name: 'Updated',
      })
    );
    expect(result).toEqual({
      success: true,
      user: {
        user_id: 'user-1',
        email: 'updated@example.com',
      },
    });
  });
});
