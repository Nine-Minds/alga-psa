import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const row = {
    user_id: 'user-1',
    tenant: 'tenant-1',
    username: 'ada',
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'ada@example.test',
    user_type: 'internal',
    is_inactive: false,
    two_factor_enabled: true,
    password: 'PASSWORD_SENTINEL',
    hashed_password: 'HASH_SENTINEL',
    two_factor_secret: 'MFA_SENTINEL',
    roles: [{ role_id: 'role-1', role_name: 'Administrator' }],
  };
  const plainRow = { ...row };
  delete (plainRow as any).roles;
  const rows = [plainRow];
  const reportsRows = [plainRow];
  const reportIds = ['user-1'];
  const permission = vi.fn(async () => true);
  const currentUserResolver = vi.fn(async () => row);
  return { row, plainRow, rows, reportsRows, reportIds, permission, currentUserResolver };
});

let currentUser: any = {
  user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal',
};

vi.mock('@alga-psa/auth', () => {
  const wrap = (action: any) => (...args: any[]) => action(currentUser, { tenant: 'tenant-1' }, ...args);
  return { withAuth: wrap, withOptionalAuth: wrap, getCurrentUser: mocks.currentUserResolver };
});

vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn(), debug: vi.fn(), info: vi.fn() } }));
vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getAll: vi.fn(async () => mocks.rows),
    getUserWithRoles: vi.fn(async () => mocks.row),
    getUserRolesBulk: vi.fn(async () => new Map([['user-1', mocks.row.roles]])),
    getReportsToSubordinateIds: vi.fn(async () => mocks.reportIds),
  },
}));
vi.mock('@alga-psa/db/models/userPreferences', () => ({ default: {} }));
vi.mock('@alga-psa/db', () => {
  const query: any = {
    where: () => query,
    whereIn: () => query,
    select: () => query,
    first: async () => undefined,
    then: (resolve: any, reject: any) => Promise.resolve(mocks.reportsRows).then(resolve, reject),
  };
  const db: any = {
    table: () => query,
    tenantJoin: () => query,
  };
  return {
    createTenantKnex: vi.fn(async () => ({ knex: {} })),
    withTransaction: vi.fn(async (_knex: any, callback: any) => callback({})),
    tenantDb: vi.fn(() => db),
  };
});

vi.mock('../lib/avatarUtils', () => ({ getUserAvatarUrl: vi.fn(async () => null) }));

const sensitiveFieldNames = [
  'hashed_password', 'password', 'two_factor_secret', 'mfa_secret', 'totp_secret',
  'recovery_codes', 'backup_codes', 'password_reset_token', 'reset_token',
  'verification_token', 'api_key', 'api_key_hash',
];

function expectSafeUserResponse(value: unknown, rolesExpected: boolean): void {
  const assertNoSensitiveProperties = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(assertNoSensitiveProperties);
      return;
    }
    if (candidate && typeof candidate === 'object') {
      for (const field of sensitiveFieldNames) {
        expect(candidate).not.toHaveProperty(field);
      }
      Object.values(candidate).forEach(assertNoSensitiveProperties);
    }
  };
  assertNoSensitiveProperties(value);

  const serialized = JSON.stringify(value);
  for (const field of sensitiveFieldNames) {
    expect(serialized).not.toContain(field);
  }
  expect(serialized).not.toContain('HASH_SENTINEL');
  expect(serialized).not.toContain('PASSWORD_SENTINEL');
  expect(serialized).not.toContain('MFA_SENTINEL');
  expect(serialized).toContain('ada@example.test');
  expect(serialized).toContain('Ada');
  expect(serialized).toContain('two_factor_enabled');
  if (rolesExpected) expect(serialized).toContain('Administrator');
  else expect(serialized).not.toContain('roles');
}

afterEach(() => {
  currentUser = { user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' };
  mocks.rows.splice(0, mocks.rows.length, mocks.plainRow);
  mocks.reportsRows.splice(0, mocks.reportsRows.length, mocks.plainRow);
  mocks.reportIds.splice(0, mocks.reportIds.length, 'user-1');
  vi.clearAllMocks();
});

describe('browser-facing user query response sanitization', () => {
  it('removes credential fields at single-user and collection response boundaries', async () => {
    const actions = await import('@alga-psa/user-composition/actions/userQueryActions');

    const all = await actions.getAllUsers();
    expect(all).toHaveLength(1);
    expectSafeUserResponse(all, true);

    const basic = await actions.getAllUsersBasic();
    expect(basic).toHaveLength(1);
    expectSafeUserResponse(basic, false);

    const found = await actions.findUserById('user-1');
    expect(found).not.toBeNull();
    expectSafeUserResponse(found, true);
    const withRoles = await actions.getUserWithRoles('user-1');
    expect(withRoles).not.toBeNull();
    expectSafeUserResponse(withRoles, true);
    const multiple = await actions.getMultipleUsersWithRoles(['user-1']);
    expect(multiple).toHaveLength(1);
    expectSafeUserResponse(multiple, true);

    const reports = await actions.getReportsToSubordinates('manager-1');
    expect(reports).toHaveLength(1);
    expectSafeUserResponse(reports, false);
    const clientUsers = await actions.getClientUsersForClient('client-1');
    expect(clientUsers).toHaveLength(1);
    expectSafeUserResponse(clientUsers, false);
  });

  it('sanitizes the exported current user response and preserves null sessions', async () => {
    const actions = await import('@alga-psa/user-composition/actions/userQueryActions');

    const user = await actions.getCurrentUser();
    expect(user).toMatchObject({
      user_id: 'user-1', username: 'ada', first_name: 'Ada', last_name: 'Lovelace',
      email: 'ada@example.test', tenant: 'tenant-1', user_type: 'internal',
      roles: [{ role_id: 'role-1', role_name: 'Administrator' }],
    });
    expectSafeUserResponse(user, true);

    mocks.currentUserResolver.mockResolvedValueOnce(null as any);
    expect(await actions.getCurrentUser()).toBeNull();
  });

  it('preserves null and empty results from the user query actions', async () => {
    const actions = await import('@alga-psa/user-composition/actions/userQueryActions');
    const User = (await import('@alga-psa/db/models/user')).default as any;
    User.getUserWithRoles.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    expect(await actions.findUserById('missing')).toBeNull();
    expect(await actions.getUserWithRoles('missing')).toBeNull();
    expect(await actions.getMultipleUsersWithRoles(['missing'])).toEqual([]);

    mocks.rows.length = 0;
    mocks.reportsRows.length = 0;
    mocks.reportIds.length = 0;
    expect(await actions.getAllUsers()).toEqual([]);
    expect(await actions.getAllUsersBasic()).toEqual([]);
    expect(await actions.getMultipleUsersWithRoles([])).toEqual([]);
    expect(await actions.getReportsToSubordinates('manager-1')).toEqual([]);
    expect(await actions.getClientUsersForClient('client-1')).toEqual([]);
  });
});
