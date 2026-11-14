/**
 * Ticket alga-2026-0003292: the user-management actions must put every change
 * that can empty a role set, or take the tenant's last admin, through the
 * shared guard. The guard itself is covered in packages/db
 * (userRoleFloor.test.ts); here the wiring is pinned — the guard is called with
 * the right change, the write does not happen on a refusal, and the refusal
 * comes back in the action's own result shape with its i18n key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn(async () => ({ knex: {} as any })));
const withTransactionMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn(async (..._args: any[]): Promise<boolean> => true));
const assertUserRoleFloorMock = vi.hoisted(() => vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true })));
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());
const getUserWithRolesMock = vi.hoisted(() => vi.fn(async () => ({ user_id: 'target-1' })));

vi.mock('@alga-psa/core', () => ({ isEnterprise: false }));
vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: deleteEntityWithValidationMock,
}));
vi.mock('@alga-psa/core/encryption', () => ({ hashPassword: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (...args: any[]) => any) =>
    (...args: any[]) =>
      fn({ user_id: 'actor-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  withOptionalAuth: (fn: (...args: any[]) => any) => fn,
}));

class UserRoleFloorErrorStub extends Error {
  readonly name = 'UserRoleFloorError';
  constructor(message: string, readonly violation: string) {
    super(message);
  }
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: withTransactionMock,
  withAdminTransaction: vi.fn(),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
    unscoped: (t: string, _reason?: string) => conn(t),
  }),
  assertUserRoleFloor: (...args: any[]) => assertUserRoleFloorMock(...args),
  isUserRoleFloorRejected: (result: any) => result?.ok === false,
  isUserRoleFloorError: (error: any) => error?.name === 'UserRoleFloorError',
  UserRoleFloorError: UserRoleFloorErrorStub,
  // The seat-technician guard has its own suite; these tests pin the writer's own behaviour.
  assertSeatTechnicianWrite: async () => undefined,
  isSeatTechnicianGuardError: () => false,
}));

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn() }));
vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    update: vi.fn(),
    getUserWithRoles: getUserWithRolesMock,
    getUserRoles: vi.fn(async () => []),
    isInReportsToChain: vi.fn(async () => false),
  },
}));
vi.mock('@alga-psa/db/models/userPreferences', () => ({ default: { upsert: vi.fn() } }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishNonCatalogWorkflowEvent: publishWorkflowEventMock,
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: hasPermissionMock,
  throwPermissionError: (what: string) => {
    throw new Error(`Permission denied: ${what}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const INTERNAL_TARGET = { user_id: 'target-1', user_type: 'internal' };

/** users.first() for assertInteractiveUserTarget, plus user_roles write spies. */
function buildRolesTrx(spies: { del: () => Promise<number>; insert: (rows: unknown) => Promise<unknown> }) {
  const trx: any = (table: string) => {
    if (table === 'users') return { where: () => ({ first: async () => INTERNAL_TARGET }) };
    if (table === 'user_roles') {
      return {
        where: () => ({ del: spies.del }),
        insert: spies.insert,
      };
    }
    throw new Error(`Unexpected table ${table}`);
  };
  trx.isTransaction = true;
  return trx;
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionMock.mockResolvedValue(true);
  assertUserRoleFloorMock.mockResolvedValue({ ok: true });
});

describe('updateUserRoles', () => {
  it('refuses an empty role list and writes nothing', async () => {
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_role',
      message: 'A user must keep at least one role. Assign another role first, then remove this one.',
    });
    const spies = { del: vi.fn(async () => 1), insert: vi.fn(async () => []) };
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRolesTrx(spies))
    );

    const { updateUserRoles } = await import('./userActions');

    await expect(updateUserRoles('target-1', [])).resolves.toEqual({
      success: false,
      error: 'A user must keep at least one role. Assign another role first, then remove this one.',
      messageKey: 'msp/settings:errors.roles.lastRole',
    });
    expect(spies.del).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
    expect(assertUserRoleFloorMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', {
      kind: 'set_roles',
      userId: 'target-1',
      roleIds: [],
    });
  });

  it('refuses a swap that drops the last admin', async () => {
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_msp_admin',
      message: 'A tenant must keep at least one active MSP Admin user.',
    });
    const spies = { del: vi.fn(async () => 1), insert: vi.fn(async () => []) };
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRolesTrx(spies))
    );

    const { updateUserRoles } = await import('./userActions');

    await expect(updateUserRoles('target-1', ['role-tech'])).resolves.toEqual({
      success: false,
      error: 'A tenant must keep at least one active MSP Admin user.',
      messageKey: 'msp/settings:errors.roles.lastMspAdmin',
    });
    expect(spies.del).not.toHaveBeenCalled();
  });

  it('replaces the role set when the floors allow it', async () => {
    const spies = { del: vi.fn(async () => 1), insert: vi.fn(async () => []) };
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRolesTrx(spies))
    );

    const { updateUserRoles } = await import('./userActions');

    await expect(updateUserRoles('target-1', ['role-admin', 'role-tech'])).resolves.toBeUndefined();
    expect(spies.del).toHaveBeenCalledTimes(1);
    expect(spies.insert).toHaveBeenCalledTimes(1);
  });
});

describe('deleteUser', () => {
  function buildPreCheckTrx() {
    const trx: any = (table: string) => {
      if (table === 'users') return { where: () => ({ first: async () => INTERNAL_TARGET }) };
      if (table === 'clients') return { where: () => ({ first: async () => undefined }) };
      throw new Error(`Unexpected table ${table}`);
    };
    trx.isTransaction = true;
    return trx;
  }

  it('refuses to delete the last active MSP admin', async () => {
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildPreCheckTrx())
    );
    // The real deleteEntityWithValidation runs the cleanup callback inside its
    // own transaction and lets a throw propagate; so does this stub.
    deleteEntityWithValidationMock.mockImplementation(
      async (_entity: string, _id: string, _db: any, tenant: string, perform: any) => {
        const trx: any = () => {
          throw new Error('no table access expected after the refusal');
        };
        trx.isTransaction = true;
        await perform(trx, tenant);
        return { canDelete: true, deleted: true, dependencies: [], alternatives: [] };
      }
    );
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_msp_admin',
      message: 'A tenant must keep at least one active MSP Admin user.',
    });

    const { deleteUser } = await import('./userActions');

    await expect(deleteUser('target-1')).resolves.toEqual({
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'A tenant must keep at least one active MSP Admin user.',
      dependencies: [],
      alternatives: [],
    });
    expect(assertUserRoleFloorMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', {
      kind: 'delete_user',
      userId: 'target-1',
    });
  });

  it('still deletes a user who has roles', async () => {
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildPreCheckTrx())
    );
    const performed = vi.fn();
    deleteEntityWithValidationMock.mockImplementation(
      async (_entity: string, _id: string, _db: any, tenant: string, perform: any) => {
        const trx: any = () => ({
          where: () => ({ update: async () => 1, del: async () => 1, whereIn: () => ({ del: async () => 1 }) }),
          orWhere: () => ({ update: async () => 1 }),
        });
        trx.isTransaction = true;
        // The cleanup body itself is covered by userActions.test.ts; here only
        // the guard's verdict matters, so the callback is observed, not run.
        performed(trx, tenant);
        return { canDelete: true, deleted: true, dependencies: [], alternatives: [] };
      }
    );

    const { deleteUser } = await import('./userActions');

    await expect(deleteUser('target-1')).resolves.toMatchObject({ success: true, deleted: true });
    expect(performed).toHaveBeenCalledTimes(1);
  });
});

describe('updateUser', () => {
  /** users.first() for assertInteractiveUserTarget; boards only on an allow. */
  function buildUpdateTrx(boardsUpdate: ReturnType<typeof vi.fn>) {
    const trx: any = (table: string) => {
      if (table === 'users') {
        return {
          where: () => ({
            first: async () => INTERNAL_TARGET,
            select: () => ({ first: async () => ({ ...INTERNAL_TARGET, is_inactive: false }) }),
            update: async () => 1,
          }),
        };
      }
      if (table === 'boards') return { where: () => ({ update: boardsUpdate }) };
      throw new Error(`Unexpected table ${table}`);
    };
    trx.isTransaction = true;
    trx.schema = { hasTable: async () => false };
    return trx;
  }

  it('refuses to deactivate the last active MSP admin and leaves boards alone', async () => {
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_msp_admin',
      message: 'A tenant must keep at least one active MSP Admin user.',
    });
    const boardsUpdate = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildUpdateTrx(boardsUpdate))
    );

    const { updateUser } = await import('./userActions');

    await expect(updateUser('target-1', { is_inactive: true } as any)).resolves.toEqual({
      success: false,
      code: 'LAST_MSP_ADMIN',
      error: 'A tenant must keep at least one active MSP Admin user.',
      messageKey: 'msp/settings:errors.roles.lastMspAdmin',
    });
    expect(assertUserRoleFloorMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', {
      kind: 'deactivate_user',
      userId: 'target-1',
    });
    expect(boardsUpdate).not.toHaveBeenCalled();
  });

  it('does not consult the floor when the update leaves the user active', async () => {
    const boardsUpdate = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildUpdateTrx(boardsUpdate))
    );

    const { updateUser } = await import('./userActions');

    await updateUser('target-1', { phone: '555-0100' } as any);
    expect(assertUserRoleFloorMock).not.toHaveBeenCalled();
  });
});

describe('deactivateUserWithDisposition', () => {
  it('refuses to deactivate the last active MSP admin, before any work is disposed', async () => {
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_msp_admin',
      message: 'A tenant must keep at least one active MSP Admin user.',
    });
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) => {
      const trx: any = (table: string) => {
        if (table === 'users') return { where: () => ({ first: async () => INTERNAL_TARGET }) };
        throw new Error(`Unexpected table ${table}`);
      };
      trx.isTransaction = true;
      return cb(trx);
    });

    const { deactivateUserWithDisposition } = await import('./userActions');

    await expect(
      deactivateUserWithDisposition('target-1', {
        tickets: { action: 'unassign' },
        projectTasks: { action: 'unassign' },
      })
    ).resolves.toEqual({
      success: false,
      code: 'DEACTIVATION_FAILED',
      error: 'A tenant must keep at least one active MSP Admin user.',
      messageKey: 'msp/settings:errors.roles.lastMspAdmin',
    });
    expect(publishWorkflowEventMock).not.toHaveBeenCalled();
  });
});
