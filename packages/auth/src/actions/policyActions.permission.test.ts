import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression tests mirroring roleActions.permission.test.ts, for the duplicate
// assignRoleToUser/removeRoleFromUser implementation exposed via @alga-psa/auth/actions
// (used by the MSP "Assign Roles to Users" screen, the contact portal tab, and the
// client portal). The authorization must be role-type-aware: MSP roles require
// `user:update`; pure client-portal roles may also be managed with `client:update`.

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();

// The role floors have their own suite (packages/db userRoleFloor.test.ts);
// here they allow everything so the authorization decision stands alone.
const assertUserRoleFloorMock = vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true }));

// contacts.is_client_admin is re-derived from the roles by this shared helper;
// its own decision table is covered in packages/db (clientPortalAdminFlag.test.ts).
const syncContactClientAdminFlagMock = vi.fn(async (..._args: any[]) => undefined);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table) }),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  assertUserRoleFloor: (...args: any[]) => assertUserRoleFloorMock(...args),
  isUserRoleFloorRejected: (result: any) => result?.ok === false,
  syncContactClientAdminFlag: (...args: any[]) => syncContactClientAdminFlagMock(...args),
  // Stand-ins for the shared role writes: the same statements against the
  // caller's transaction followed by the flag sync, so this suite keeps
  // asserting the writer's own sequence. The helpers themselves are covered by
  // packages/db/src/lib/userRoleWrites.test.ts.
  addUserRoles: async (trx: any, tenant: string, userId: string, roleIds: string[]) => {
    const rows = roleIds.map((role_id: string) => ({ tenant, user_id: userId, role_id }));
    const written = rows.length > 0 ? await trx('user_roles').insert(rows).returning('*') : [];
    await syncContactClientAdminFlagMock(trx, tenant, userId);
    return written;
  },
  removeUserRoles: async (trx: any, tenant: string, userId: string, roleIds: string[]) => {
    const deleted = await trx('user_roles').where({ user_id: userId }).whereIn('role_id', roleIds).del();
    await syncContactClientAdminFlagMock(trx, tenant, userId);
    return deleted;
  },
  // The seat-technician guard has its own suite; these tests pin the writer's own behaviour.
  assertSeatTechnicianWrite: async () => undefined,
  isSeatTechnicianGuardError: () => false,
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: vi.fn(),
}), { virtual: true });

vi.mock('../lib/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../lib/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

function setPerms({ userUpdate = false, clientUpdate = false }: { userUpdate?: boolean; clientUpdate?: boolean }) {
  hasPermissionMock.mockImplementation(async (_user: any, resource: string, action: string) => {
    if (resource === 'user' && action === 'update') return userUpdate;
    if (resource === 'client' && action === 'update') return clientUpdate;
    return false;
  });
}

const MSP_ADMIN_ROLE = { role_id: 'role-admin', msp: true, client: false };
const CLIENT_ROLE = { role_id: 'role-client', msp: false, client: true };
const INTERNAL_USER = { user_id: 'target-1', user_type: 'internal' };
const CLIENT_USER = { user_id: 'target-2', user_type: 'client' };

function buildAssignTrx(user: any, role: any, insertSpy: (...args: any[]) => any) {
  return (table: string) => {
    if (table === 'users') return { where: () => ({ first: async () => user }) };
    if (table === 'roles') return { where: () => ({ first: async () => role }) };
    if (table === 'user_roles') {
      return {
        insert: (...a: any[]) => {
          insertSpy(...a);
          return { returning: async () => [{ user_id: user?.user_id, role_id: role?.role_id, tenant: 'tenant-1' }] };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
}

function buildRemoveTrx(role: any, delSpy: (...args: any[]) => any) {
  return (table: string) => {
    if (table === 'roles') return { where: () => ({ first: async () => role }) };
    if (table === 'user_roles') return { where: () => ({ del: delSpy, whereIn: () => ({ del: delSpy }) }) };
    throw new Error(`Unexpected table: ${table}`);
  };
}

describe('policyActions authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assignRoleToUser', () => {
    it('denies a Finance user (client:update but no user:update) from assigning an MSP role, without inserting', async () => {
      setPerms({ userUpdate: false, clientUpdate: true });
      const insertSpy = vi.fn();
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildAssignTrx(INTERNAL_USER, MSP_ADMIN_ROLE, insertSpy))
      );

      const { assignRoleToUser } = await import('./policyActions');

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

      const { assignRoleToUser } = await import('./policyActions');

      await expect(assignRoleToUser('target-1', 'role-admin')).resolves.toMatchObject({ role_id: 'role-admin' });
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });

    it('allows client:update to assign a pure client-portal role', async () => {
      setPerms({ userUpdate: false, clientUpdate: true });
      const insertSpy = vi.fn();
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildAssignTrx(CLIENT_USER, CLIENT_ROLE, insertSpy))
      );

      const { assignRoleToUser } = await import('./policyActions');

      await expect(assignRoleToUser('target-2', 'role-client')).resolves.toMatchObject({ role_id: 'role-client' });
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });

    // alga-2026-0003317: contacts.is_client_admin is a mirror of the portal
    // 'Admin' role, so every role write re-derives it in its own transaction.
    it('re-derives the portal admin flag in the same transaction as the insert', async () => {
      setPerms({ userUpdate: false, clientUpdate: true });
      const insertSpy = vi.fn();
      let seenTrx: any;
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) => {
        seenTrx = buildAssignTrx(CLIENT_USER, CLIENT_ROLE, insertSpy);
        return cb(seenTrx);
      });

      const { assignRoleToUser } = await import('./policyActions');

      await assignRoleToUser('target-2', 'role-client');

      expect(syncContactClientAdminFlagMock).toHaveBeenCalledWith(seenTrx, 'tenant-1', 'target-2');
      expect(insertSpy.mock.invocationCallOrder[0]).toBeLessThan(
        syncContactClientAdminFlagMock.mock.invocationCallOrder[0]
      );
    });

    it('leaves the portal admin flag alone when the assignment is refused', async () => {
      setPerms({ userUpdate: false, clientUpdate: false });
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildAssignTrx(CLIENT_USER, CLIENT_ROLE, vi.fn()))
      );

      const { assignRoleToUser } = await import('./policyActions');

      await assignRoleToUser('target-2', 'role-client');

      expect(syncContactClientAdminFlagMock).not.toHaveBeenCalled();
    });
  });

  describe('removeRoleFromUser', () => {
    it('denies a Finance user from removing an MSP role, without deleting', async () => {
      setPerms({ userUpdate: false, clientUpdate: true });
      const delSpy = vi.fn(async () => 1);
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildRemoveTrx(MSP_ADMIN_ROLE, delSpy))
      );

      const { removeRoleFromUser } = await import('./policyActions');

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

      const { removeRoleFromUser } = await import('./policyActions');

      await expect(removeRoleFromUser('target-1', 'role-admin')).resolves.toBeUndefined();
      expect(delSpy).toHaveBeenCalledTimes(1);
    });

    it('re-derives the portal admin flag in the same transaction as the delete', async () => {
      setPerms({ userUpdate: true });
      const delSpy = vi.fn(async () => 1);
      let seenTrx: any;
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) => {
        seenTrx = buildRemoveTrx(CLIENT_ROLE, delSpy);
        return cb(seenTrx);
      });

      const { removeRoleFromUser } = await import('./policyActions');

      await removeRoleFromUser('target-2', 'role-client');

      expect(syncContactClientAdminFlagMock).toHaveBeenCalledWith(seenTrx, 'tenant-1', 'target-2');
      expect(delSpy.mock.invocationCallOrder[0]).toBeLessThan(
        syncContactClientAdminFlagMock.mock.invocationCallOrder[0]
      );
    });

    it('leaves the portal admin flag alone when the removal is refused', async () => {
      setPerms({ userUpdate: false, clientUpdate: false });
      withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
        cb(buildRemoveTrx(CLIENT_ROLE, vi.fn(async () => 1)))
      );

      const { removeRoleFromUser } = await import('./policyActions');

      await removeRoleFromUser('target-2', 'role-client');

      expect(syncContactClientAdminFlagMock).not.toHaveBeenCalled();
    });
  });
});
