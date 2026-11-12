import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ticket alga-2026-0003292, for the auth copy of removeRoleFromUser (the one
// the client portal and the contact portal tab call). Pins the wiring: the
// guard runs before the delete, and a portal caller is told in portal copy.

const hasPermissionMock = vi.fn(async () => true);
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
const assertUserRoleFloorMock = vi.fn();

let actor: Record<string, unknown> = { user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' };

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  tenantDb: (conn: any) => ({ table: (table: string) => conn(table) }),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  assertUserRoleFloor: (...args: any[]) => assertUserRoleFloorMock(...args),
  isUserRoleFloorRejected: (result: any) => result?.ok === false,
}));

vi.mock('@alga-psa/core/server', () => ({
  deleteEntityWithValidation: vi.fn(),
}), { virtual: true });

vi.mock('../lib/withAuth', () => ({
  withAuth:
    (fn: any) =>
    (...args: any[]) =>
      fn(actor, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../lib/rbac', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

const MSP_ADMIN_ROLE = { role_id: 'role-admin', msp: true, client: false };
const CLIENT_ROLE = { role_id: 'role-client', msp: false, client: true };

function buildRemoveTrx(role: any, delSpy: (...args: any[]) => any, targetUser?: any) {
  const trx: any = (table: string) => {
    if (table === 'roles') return { where: () => ({ first: async () => role }) };
    if (table === 'users') return { where: () => ({ first: async () => targetUser }) };
    if (table === 'contacts') {
      return {
        where: (criteria: Record<string, string>) => ({
          select: () => ({
            first: async () =>
              criteria.contact_name_id === 'contact-actor'
                ? { client_id: 'client-1', is_client_admin: true }
                : { client_id: 'client-1' },
          }),
        }),
      };
    }
    if (table === 'user_roles') return { where: () => ({ del: delSpy }) };
    throw new Error(`Unexpected table: ${table}`);
  };
  trx.isTransaction = true;
  return trx;
}

describe('policyActions.removeRoleFromUser role floor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    actor = { user_id: 'actor-1', tenant: 'tenant-1', user_type: 'internal' };
  });

  it('refuses to remove the last active MSP admin, and does not delete', async () => {
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_msp_admin',
      message: 'A tenant must keep at least one active MSP Admin user.',
    });
    const delSpy = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRemoveTrx(MSP_ADMIN_ROLE, delSpy))
    );

    const { removeRoleFromUser } = await import('./policyActions');

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

  it('reports a portal caller\'s last-role refusal in client portal copy', async () => {
    actor = { user_id: 'actor-9', tenant: 'tenant-1', user_type: 'client', contact_id: 'contact-actor' };
    assertUserRoleFloorMock.mockResolvedValue({
      ok: false,
      violation: 'last_role',
      message: 'A user must keep at least one role. Assign another role first, then remove this one.',
    });
    const delSpy = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRemoveTrx(CLIENT_ROLE, delSpy, { user_id: 'target-2', user_type: 'client', contact_id: 'contact-target' }))
    );

    const { removeRoleFromUser } = await import('./policyActions');

    await expect(removeRoleFromUser('target-2', 'role-client')).resolves.toEqual({
      actionError: 'A user must keep at least one role. Assign another role first, then remove this one.',
      messageKey: 'client-portal:errors.roles.lastRole',
    });
    expect(delSpy).not.toHaveBeenCalled();
  });

  it('deletes when the floors allow it', async () => {
    assertUserRoleFloorMock.mockResolvedValue({ ok: true });
    const delSpy = vi.fn(async () => 1);
    withTransactionMock.mockImplementation(async (_db: any, cb: (trx: any) => Promise<unknown>) =>
      cb(buildRemoveTrx(MSP_ADMIN_ROLE, delSpy))
    );

    const { removeRoleFromUser } = await import('./policyActions');

    await expect(removeRoleFromUser('target-1', 'role-admin')).resolves.toBeUndefined();
    expect(delSpy).toHaveBeenCalledTimes(1);
  });
});
