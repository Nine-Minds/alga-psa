import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUserWithRoles } from '@alga-psa/types';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  byId: vi.fn(),
  byEmail: vi.fn(),
  modelById: vi.fn(),
  all: vi.fn(),
  roles: vi.fn(),
  permission: vi.fn(),
  subordinates: vi.fn(),
  table: vi.fn(),
}));

vi.mock('@alga-psa/core/logger', () => ({ default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../../packages/auth/src/lib/getSession', () => ({
  getSession: mocks.session,
  getSessionWithRevocationCheck: mocks.session,
  logSessionRejection: vi.fn(),
}));
vi.mock('@alga-psa/db', () => ({
  getUserWithRoles: mocks.byId,
  getUserWithRolesByEmail: mocks.byEmail,
  createTenantKnex: async () => ({ knex: {}, tenant: 'tenant-a' }),
  noteTenantProductCode: vi.fn(),
  withTransaction: async (_db: unknown, fn: (trx: object) => unknown) => fn({}),
  tenantDb: () => ({ table: mocks.table, tenantJoin: (query: unknown) => query }),
}));
vi.mock('@alga-psa/db/models/user', () => ({ default: {
  getUserWithRoles: mocks.modelById,
  getAll: mocks.all,
  getUserRolesBulk: mocks.roles,
  getReportsToSubordinateIds: mocks.subordinates,
} }));
vi.mock('@alga-psa/db/models/userPreferences', () => ({ default: {} }));
vi.mock('../../../../../packages/user-composition/src/lib/avatarUtils', () => ({ getUserAvatarUrl: vi.fn() }));
vi.mock('../../../../../packages/user-composition/src/lib/permissions', () => ({ hasPermission: mocks.permission }));
// Keep the actual current-user resolver behind the actual action re-export.
// Only the unrelated action wrappers are simplified to isolate response behavior.
vi.mock('@alga-psa/auth', async () => {
  const { getCurrentUser } = await import('../../../../../packages/auth/src/lib/getCurrentUser');
  const wrap = (fn: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    const user = await getCurrentUser();
    if (!user) throw new Error('Unauthenticated');
    return fn(user, { tenant: user.tenant }, ...args);
  };
  return { getCurrentUser, withAuth: wrap, withOptionalAuth: wrap };
});

import {
  getCurrentUser, findUserById, getAllUsers, getAllUsersBasic,
  getUserWithRoles, getMultipleUsersWithRoles, getReportsToSubordinates, getClientUsersForClient,
} from '../../../../../packages/user-composition/src/actions/userQueryActions';
import { getCurrentUserWithRevocationCheck } from '../../../../../packages/auth/src/lib/getCurrentUser';
import { runWithApiKeyUser } from '../../../../../packages/auth/src/lib/apiKeyUserContext';

const fullUser: IUserWithRoles & { future_credential: string } = {
  user_id: 'user-a', tenant: 'tenant-a', username: 'alice', email: 'alice@example.test',
  user_type: 'internal', is_inactive: false, first_name: 'Alice', phone_extension: '123',
  hashed_password: 'PRIVATE_PASSWORD_HASH', two_factor_secret: 'PRIVATE_TOTP_SEED',
  future_credential: 'PRIVATE_FUTURE_CREDENTIAL', two_factor_enabled: true,
  roles: [{ role_id: 'role-a', role_name: 'Admin', msp: true, client: false, tenant: 'tenant-a' }],
  clientId: 'client-a', avatarUrl: '/avatar-a',
};

function expectPublic(user: any, withRoles = true) {
  expect(user).toMatchObject({
    user_id: 'user-a', tenant: 'tenant-a', email: 'alice@example.test', two_factor_enabled: true,
    phone_extension: '123',
  });
  if (withRoles) expect(user.roles).toEqual(fullUser.roles);
  const serialized = JSON.stringify(user);
  for (const [key, value] of Object.entries({
    hashed_password: fullUser.hashed_password, two_factor_secret: fullUser.two_factor_secret,
    future_credential: fullUser.future_credential,
  })) {
    expect(user).not.toHaveProperty(key);
    expect(serialized).not.toContain(value);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'user-a', tenant: 'tenant-a' } });
  mocks.byId.mockResolvedValue(fullUser);
  mocks.byEmail.mockResolvedValue(fullUser);
  mocks.modelById.mockResolvedValue(fullUser);
  mocks.all.mockResolvedValue([fullUser, { ...fullUser, tenant: 'other-tenant' }]);
  mocks.roles.mockResolvedValue(new Map([['user-a', fullUser.roles]]));
  mocks.permission.mockResolvedValue(true);
  mocks.subordinates.mockResolvedValue(['user-a']);
  // Deliberately return a full row even if SQL is projected: test the boundary itself.
  const query = {
    where: vi.fn().mockReturnThis(), whereIn: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([fullUser]).then(resolve),
  };
  mocks.table.mockReturnValue(query);
});
afterEach(() => vi.unstubAllEnvs());

describe('public current-user action', () => {
  it.each(['internal', 'client'] as const)('excludes credentials for a %s caller resolved by ID', async user_type => {
    mocks.byId.mockResolvedValue({ ...fullUser, user_type });
    const user = await getCurrentUser();
    expectPublic(user);
    expect(user).toMatchObject({ user_type, clientId: 'client-a', avatarUrl: '/avatar-a' });
    expect(mocks.byId).toHaveBeenCalledWith('user-a', 'tenant-a');
    expect(fullUser.hashed_password).toBe('PRIVATE_PASSWORD_HASH');
  });

  it.each(['client', undefined])('projects the development email fallback (%s)', async user_type => {
    vi.stubEnv('NODE_ENV', 'development');
    mocks.session.mockResolvedValue({ user: { email: fullUser.email, tenant: 'tenant-a', user_type } });
    expectPublic(await getCurrentUser());
    expect(mocks.byEmail).toHaveBeenCalledWith(fullUser.email, 'tenant-a', user_type);
  });

  it('projects API-key overrides without consulting the ambient session', async () => {
    expectPublic(await runWithApiKeyUser(fullUser, () => getCurrentUser()));
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it('projects the revocation-checked resolver used by authorization boundaries', async () => {
    expectPublic(await getCurrentUserWithRevocationCheck());
  });

  it('preserves missing and inactive-user behavior and rejects production email fallbacks', async () => {
    mocks.byId.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
    mocks.byId.mockResolvedValue({ ...fullUser, is_inactive: true });
    expect(await getCurrentUser()).toBeNull();
    mocks.session.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
    vi.stubEnv('NODE_ENV', 'production');
    mocks.session.mockResolvedValue({ user: { email: fullUser.email, tenant: 'tenant-a' } });
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.byEmail).not.toHaveBeenCalled();
  });
});

describe('sibling user-query responses', () => {
  it.each([findUserById, getUserWithRoles])('projects single-user actions', async action => {
    expectPublic(await action('user-a'));
    mocks.modelById.mockResolvedValue({ ...fullUser, user_type: 'service' });
    expect(await action('user-a')).toBeNull();
  });

  it('projects lists and retains tenant filtering and roles', async () => {
    const all = await getAllUsers();
    expect(all).toHaveLength(1);
    expectPublic(all[0]);
    const basic = await getAllUsersBasic();
    expect(basic).toHaveLength(1);
    expectPublic(basic[0], false);
    expectPublic((await getMultipleUsersWithRoles(['user-a']))[0]);
    expectPublic((await getReportsToSubordinates())[0], false);
    expectPublic((await getClientUsersForClient('client-a'))[0], false);
  });

  it('retains permission and portal restrictions', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(await findUserById('user-a')).toBeNull();
    expect(await getAllUsers()).toEqual([]);
    expect(mocks.modelById).not.toHaveBeenCalled();
    expect(mocks.all).not.toHaveBeenCalled();
    mocks.permission.mockResolvedValue(true);
    mocks.byId.mockResolvedValue({ ...fullUser, user_type: 'client' });
    expect(await getMultipleUsersWithRoles(['user-a'])).toEqual([]);
    expect(mocks.modelById).not.toHaveBeenCalled();
  });
});
