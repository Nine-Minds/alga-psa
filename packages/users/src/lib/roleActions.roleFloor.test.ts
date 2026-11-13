import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ticket alga-2026-0003292: removeRoleFromUser is the path the customer hit.
// What is pinned here is the wiring — the guard runs on the write transaction,
// before the delete, and its refusal is reported with the right i18n key.

const hasPermissionMock = vi.fn(async (..._args: any[]): Promise<boolean> => true);
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const assertUserRoleFloorMock = vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({ table: (t: string) => conn(t) }),
  assertUserRoleFloor: (...args: any[]) => assertUserRoleFloorMock(...args),
  isUserRoleFloorRejected: (result: any) => result?.ok === false,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn({ user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

const MSP_ADMIN_ROLE = { role_id: 'role-admin', msp: true, client: false };

function buildRemoveTrx(delSpy: () => Promise<number>) {
  const trx: any = (table: string) => {
    if (table === 'roles') return { where: () => ({ first: async () => MSP_ADMIN_ROLE }) };
    if (table === 'user_roles') return { where: () => ({ del: delSpy }) };
    throw new Error(`Unexpected table: ${table}`);
  };
  trx.isTransaction = true;
  return trx;
}

describe('roleActions.removeRoleFromUser role floor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
  });

  it('refuses to remove the last active MSP admin, and does not delete', async () => {
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_msp_admin',
      message: 'A tenant must keep at least one active MSP Admin user.',
    });
    const delSpy = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRemoveTrx(delSpy))
    );

    const { removeRoleFromUser } = await import('./roleActions');

    await expect(removeRoleFromUser('target-1', 'role-admin')).resolves.toEqual({
      actionError: 'A tenant must keep at least one active MSP Admin user.',
      messageKey: 'msp/settings:errors.roles.lastMspAdmin',
    });
    expect(delSpy).not.toHaveBeenCalled();
    expect(assertUserRoleFloorMock).toHaveBeenCalledWith(expect.anything(), 'tenant-1', {
      kind: 'remove_roles',
      userId: 'target-1',
      roleIds: ['role-admin'],
    });
  });

  it('refuses to remove a user\'s last role with the assign-another-role message', async () => {
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_role',
      message: 'A user must keep at least one role. Assign another role first, then remove this one.',
    });
    const delSpy = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRemoveTrx(delSpy))
    );

    const { removeRoleFromUser } = await import('./roleActions');

    await expect(removeRoleFromUser('target-1', 'role-admin')).resolves.toEqual({
      actionError: 'A user must keep at least one role. Assign another role first, then remove this one.',
      messageKey: 'msp/settings:errors.roles.lastRole',
    });
    expect(delSpy).not.toHaveBeenCalled();
  });

  it('deletes when the floors allow it (a second active admin exists)', async () => {
    assertUserRoleFloorMock.mockResolvedValue({ ok: true });
    const delSpy = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRemoveTrx(delSpy))
    );

    const { removeRoleFromUser } = await import('./roleActions');

    await expect(removeRoleFromUser('target-1', 'role-admin')).resolves.toBeUndefined();
    expect(delSpy).toHaveBeenCalledTimes(1);
  });
});
