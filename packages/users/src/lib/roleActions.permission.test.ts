import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression tests for the role-assignment authorization fix.
//
// Background: assignRoleToUser/removeRoleFromUser previously had NO permission
// check, so a user without `user:update` (e.g. the Finance role) could assign
// themselves an MSP role such as Admin (privilege escalation). The fix is
// role-type-aware: assigning/removing an MSP role requires `user:update`, while
// a pure client-portal role may also be managed with `client:update`.

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const grantGateMock = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  // The trx builders here supply their own `.where(...)`, so the tenant facade
  // just passes the table through to the mocked connection.
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));
vi.mock('@alga-psa/authorization/roleGrantAuthorization', () => ({
  assertMspRoleGrantsWithinActorPermissions: (...args: any[]) => grantGateMock(...args),
}));

function setPerms({ userCreate = false, userUpdate = false, clientUpdate = false }: { userCreate?: boolean; userUpdate?: boolean; clientUpdate?: boolean }) {
  hasPermissionMock.mockImplementation(async (_user: any, resource: string, action: string) => {
    if (resource === 'user' && action === 'create') return userCreate;
    if (resource === 'user' && action === 'update') return userUpdate;
    if (resource === 'client' && action === 'update') return clientUpdate;
    return false;
  });
}

const MSP_ADMIN_ROLE = { role_id: 'role-admin', msp: true, client: false };
const CLIENT_ROLE = { role_id: 'role-client', msp: false, client: true };
const INTERNAL_USER = { user_id: 'target-1', user_type: 'internal' };
const CLIENT_USER = { user_id: 'target-2', user_type: 'client' };

/** Build a trx() for assignRoleToUser: users.first(), roles.first(), user_roles.insert().returning() */
function buildAssignTrx(user: any, role: any, insertSpy: (...args: any[]) => any, assignments: string[] = []) {
  return (table: string) => {
    if (table === 'users') return { where: () => ({ first: async () => user }) };
    if (table === 'roles') return { where: () => ({ first: async () => role }) };
    if (table === 'user_roles') {
      return {
        insert: (...a: any[]) => {
          insertSpy(...a);
          assignments.push(role.role_id);
          return { returning: async () => [{ user_id: user?.user_id, role_id: role?.role_id, tenant: 'tenant-1' }] };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
}

/** Build a trx() for removeRoleFromUser: roles.first(), user_roles.where().del() */
function buildRemoveTrx(role: any, delSpy: (...args: any[]) => any) {
  return (table: string) => {
    if (table === 'roles') return { where: () => ({ first: async () => role }) };
    if (table === 'user_roles') return { where: () => ({ del: delSpy }) };
    throw new Error(`Unexpected table: ${table}`);
  };
}

describe('roleActions authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grantGateMock.mockResolvedValue(undefined);
  });

  describe('assignRoleToUser', () => {
    it('denies a Finance user (client:update but no user:update) from assigning an MSP role, without inserting', async () => {
      setPerms({ userUpdate: false, clientUpdate: true });
      const insertSpy = vi.fn();
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildAssignTrx(INTERNAL_USER, MSP_ADMIN_ROLE, insertSpy))
      );

      const { assignRoleToUser } = await import('./roleActions');

      await expect(assignRoleToUser('target-1', 'role-admin')).resolves.toEqual({
        permissionError: 'Permission denied: You do not have permission to change user roles.',
        messageKey: 'msp/settings:errors.roles.changePermission',
      });
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('allows a user with user:update to assign an MSP role', async () => {
      setPerms({ userUpdate: true });
      const insertSpy = vi.fn();
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildAssignTrx(INTERNAL_USER, MSP_ADMIN_ROLE, insertSpy))
      );

      const { assignRoleToUser } = await import('./roleActions');

      await expect(assignRoleToUser('target-1', 'role-admin')).resolves.toMatchObject({ role_id: 'role-admin' });
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });

    it('Project Manager with user:create and user:update cannot grant Admin through Add Role', async () => {
      setPerms({ userCreate: true, userUpdate: true });
      const targetAssignments = ['existing-role'];
      grantGateMock.mockRejectedValue(new Error('Permission denied: Cannot assign an MSP role with permissions you do not hold'));
      const insertSpy = vi.fn();
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildAssignTrx(INTERNAL_USER, MSP_ADMIN_ROLE, insertSpy, targetAssignments))
      );

      const { assignRoleToUser } = await import('./roleActions');
      await expect(assignRoleToUser('target-1', 'role-admin')).resolves.toMatchObject({ permissionError: expect.stringContaining('permissions you do not hold') });
      expect(insertSpy).not.toHaveBeenCalled();
      expect(targetAssignments).toEqual(['existing-role']);
    });

    it('allows client:update to assign a pure client-portal role', async () => {
      setPerms({ userUpdate: false, clientUpdate: true });
      const insertSpy = vi.fn();
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildAssignTrx(CLIENT_USER, CLIENT_ROLE, insertSpy))
      );

      const { assignRoleToUser } = await import('./roleActions');

      await expect(assignRoleToUser('target-2', 'role-client')).resolves.toMatchObject({ role_id: 'role-client' });
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeRoleFromUser', () => {
    it('denies a Finance user from removing an MSP role, without deleting', async () => {
      setPerms({ userUpdate: false, clientUpdate: true });
      const delSpy = vi.fn(async () => 1);
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildRemoveTrx(MSP_ADMIN_ROLE, delSpy))
      );

      const { removeRoleFromUser } = await import('./roleActions');

      await expect(removeRoleFromUser('target-1', 'role-admin')).resolves.toEqual({
        permissionError: 'Permission denied: You do not have permission to change user roles.',
        messageKey: 'msp/settings:errors.roles.changePermission',
      });
      expect(delSpy).not.toHaveBeenCalled();
    });

    it('allows a user with user:update to remove a role', async () => {
      setPerms({ userUpdate: true });
      const delSpy = vi.fn(async () => 1);
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildRemoveTrx(MSP_ADMIN_ROLE, delSpy))
      );

      const { removeRoleFromUser } = await import('./roleActions');

      await expect(removeRoleFromUser('target-1', 'role-admin')).resolves.toBeUndefined();
      expect(delSpy).toHaveBeenCalledTimes(1);
    });
  });
});
