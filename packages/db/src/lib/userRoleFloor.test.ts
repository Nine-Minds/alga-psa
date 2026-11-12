/**
 * The two floors, decided in one place: a tenant keeps an active MSP Admin and
 * an interactive user keeps a role (ticket alga-2026-0003292).
 *
 * The database is an in-memory fake (no Postgres needed); what these tests pin
 * is the decision table and the fact that the per-tenant advisory lock is the
 * first statement, before any read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const world = {
  users: [] as Row[],
  user_roles: [] as Row[],
  roles: [] as Row[],
  lockCalls: [] as unknown[][],
};

vi.mock('./tenantDb', () => ({
  tenantDb: (_conn: any, _tenant: string) => ({
    table: (name: string) => makeBuilder(name),
    tenantJoin: (builder: any, table: string) => builder.join(table),
  }),
}));

import { assertUserRoleFloor, LAST_MSP_ADMIN_MESSAGE, LAST_ROLE_MESSAGE } from './userRoleFloor';

/**
 * A tiny knex-shaped builder over the arrays above: enough of where / whereIn /
 * whereNot / whereRaw / pluck / first / countDistinct for this module's reads.
 */
function makeBuilder(table: string) {
  let rows: Row[] =
    table === 'users' ? world.users : table === 'user_roles' ? world.user_roles : world.roles;
  let joined = false;

  const builder: any = {
    join(other: string) {
      if (other !== 'users') throw new Error(`Unexpected join to ${other}`);
      joined = true;
      rows = rows.map((userRole) => ({
        ...userRole,
        ...(world.users.find((user) => user.user_id === userRole.user_id) ?? {}),
      }));
      return builder;
    },
    where(criteria: Row | string, value?: unknown) {
      if (typeof criteria === 'string') {
        const column = unqualify(criteria, joined);
        rows = rows.filter((row) => row[column] === value);
        return builder;
      }
      rows = rows.filter((row) =>
        Object.entries(criteria).every(([column, expected]) => row[unqualify(column, joined)] === expected)
      );
      return builder;
    },
    whereRaw(_sql: string, bindings: unknown[]) {
      rows = rows.filter((row) => String(row.role_name).toLowerCase() === bindings[0]);
      return builder;
    },
    whereIn(column: string, values: unknown[]) {
      rows = rows.filter((row) => values.includes(row[unqualify(column, joined)]));
      return builder;
    },
    whereNotIn(column: string, values: unknown[]) {
      rows = rows.filter((row) => !values.includes(row[unqualify(column, joined)]));
      return builder;
    },
    async pluck(column: string) {
      return rows.map((row) => row[unqualify(column, joined)]);
    },
    async first(..._columns: string[]) {
      return rows[0];
    },
    countDistinct(expression: string) {
      const column = unqualify(expression.split(' as ')[0], joined);
      const distinct = new Set(rows.map((row) => row[column]));
      return { first: async () => ({ count: String(distinct.size) }) };
    },
  };
  return builder;
}

function unqualify(column: string, joined: boolean): string {
  return joined ? column.split('.').pop() as string : column.replace(/^[^.]+\./, '');
}

function trx() {
  const fake: any = {
    isTransaction: true,
    raw: async (...args: unknown[]) => {
      world.lockCalls.push(args);
      return { rows: [] };
    },
  };
  return fake;
}

const ADMIN_ROLE = { role_id: 'role-admin', role_name: 'Admin', msp: true, client: false };
const TECH_ROLE = { role_id: 'role-tech', role_name: 'Technician', msp: true, client: false };
const PORTAL_ROLE = { role_id: 'role-portal', role_name: 'Client', msp: false, client: true };

function seed(options: { users: Row[]; userRoles: Row[] }) {
  world.users = options.users;
  world.user_roles = options.userRoles;
  world.roles = [ADMIN_ROLE, TECH_ROLE, PORTAL_ROLE];
}

const SOLE_ADMIN = { user_id: 'user-1', user_type: 'internal', is_inactive: false };

beforeEach(() => {
  world.lockCalls = [];
  seed({ users: [SOLE_ADMIN], userRoles: [{ user_id: 'user-1', role_id: 'role-admin' }] });
});

describe('lock and transaction requirement', () => {
  it('takes the per-tenant advisory xact lock before any read', async () => {
    await assertUserRoleFloor(trx(), 'tenant-1', { kind: 'remove_roles', userId: 'user-1', roleIds: [] });

    expect(world.lockCalls).toEqual([
      ['SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', ['user_role_floor', 'tenant-1']],
    ]);
  });

  it('throws for a non-transaction caller', async () => {
    const notTrx = {} as any;
    await expect(
      assertUserRoleFloor(notTrx, 'tenant-1', { kind: 'delete_user', userId: 'user-1' })
    ).rejects.toThrow(/inside a transaction/);
  });
});

describe('invariant 1: a tenant keeps one active MSP admin', () => {
  it('rejects removing the Admin role from the only active admin', async () => {
    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'remove_roles',
      userId: 'user-1',
      roleIds: ['role-admin'],
    });

    expect(result).toEqual({ ok: false, violation: 'last_msp_admin', message: LAST_MSP_ADMIN_MESSAGE });
  });

  it('allows the removal when a second ACTIVE admin exists', async () => {
    seed({
      users: [SOLE_ADMIN, { user_id: 'user-2', user_type: 'internal', is_inactive: false }],
      userRoles: [
        { user_id: 'user-1', role_id: 'role-admin' },
        { user_id: 'user-1', role_id: 'role-tech' },
        { user_id: 'user-2', role_id: 'role-admin' },
      ],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'remove_roles',
      userId: 'user-1',
      roleIds: ['role-admin'],
    });

    expect(result).toEqual({ ok: true });
  });

  it('does not count an inactive admin toward the minimum', async () => {
    seed({
      users: [SOLE_ADMIN, { user_id: 'user-2', user_type: 'internal', is_inactive: true }],
      userRoles: [
        { user_id: 'user-1', role_id: 'role-admin' },
        { user_id: 'user-1', role_id: 'role-tech' },
        { user_id: 'user-2', role_id: 'role-admin' },
      ],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'remove_roles',
      userId: 'user-1',
      roleIds: ['role-admin'],
    });

    expect(result).toEqual({ ok: false, violation: 'last_msp_admin', message: LAST_MSP_ADMIN_MESSAGE });
  });

  it('rejects swapping the last admin Admin -> Technician, allows a swap that keeps Admin', async () => {
    const swapAway = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'set_roles',
      userId: 'user-1',
      roleIds: ['role-tech'],
    });
    expect(swapAway).toEqual({ ok: false, violation: 'last_msp_admin', message: LAST_MSP_ADMIN_MESSAGE });

    const keepsAdmin = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'set_roles',
      userId: 'user-1',
      roleIds: ['role-admin', 'role-tech'],
    });
    expect(keepsAdmin).toEqual({ ok: true });
  });

  it('rejects deactivating and deleting the last active admin', async () => {
    const deactivate = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'deactivate_user',
      userId: 'user-1',
    });
    const remove = await assertUserRoleFloor(trx(), 'tenant-1', { kind: 'delete_user', userId: 'user-1' });

    expect(deactivate).toEqual({ ok: false, violation: 'last_msp_admin', message: LAST_MSP_ADMIN_MESSAGE });
    expect(remove).toEqual({ ok: false, violation: 'last_msp_admin', message: LAST_MSP_ADMIN_MESSAGE });
  });

  it('excludes users the same bulk operation is deactivating from the remaining count', async () => {
    seed({
      users: [SOLE_ADMIN, { user_id: 'user-2', user_type: 'internal', is_inactive: false }],
      userRoles: [
        { user_id: 'user-1', role_id: 'role-admin' },
        { user_id: 'user-2', role_id: 'role-admin' },
      ],
    });

    const result = await assertUserRoleFloor(
      trx(),
      'tenant-1',
      { kind: 'deactivate_user', userId: 'user-1' },
      { alsoAffectedUserIds: ['user-2'] }
    );

    expect(result).toEqual({ ok: false, violation: 'last_msp_admin', message: LAST_MSP_ADMIN_MESSAGE });
  });

  it('ignores an already inactive admin being deactivated again', async () => {
    seed({
      users: [{ user_id: 'user-1', user_type: 'internal', is_inactive: true }],
      userRoles: [{ user_id: 'user-1', role_id: 'role-admin' }],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'deactivate_user',
      userId: 'user-1',
    });

    expect(result).toEqual({ ok: true });
  });
});

describe('invariant 2: a user keeps at least one role', () => {
  it('rejects removing an internal user\'s only role', async () => {
    seed({
      users: [{ user_id: 'user-2', user_type: 'internal', is_inactive: false }],
      userRoles: [{ user_id: 'user-2', role_id: 'role-tech' }],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'remove_roles',
      userId: 'user-2',
      roleIds: ['role-tech'],
    });

    expect(result).toEqual({ ok: false, violation: 'last_role', message: LAST_ROLE_MESSAGE });
  });

  it('rejects an empty role list for a client portal user', async () => {
    seed({
      users: [{ user_id: 'portal-1', user_type: 'client', is_inactive: false }],
      userRoles: [{ user_id: 'portal-1', role_id: 'role-portal' }],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'set_roles',
      userId: 'portal-1',
      roleIds: [],
    });

    expect(result).toEqual({ ok: false, violation: 'last_role', message: LAST_ROLE_MESSAGE });
  });

  it('allows replacing one role with another', async () => {
    seed({
      users: [{ user_id: 'user-2', user_type: 'internal', is_inactive: false }],
      userRoles: [{ user_id: 'user-2', role_id: 'role-tech' }],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'set_roles',
      userId: 'user-2',
      roleIds: ['role-admin'],
    });

    expect(result).toEqual({ ok: true });
  });

  it('exempts deleting the user, whose role rows go with them', async () => {
    seed({
      users: [{ user_id: 'user-2', user_type: 'internal', is_inactive: false }],
      userRoles: [{ user_id: 'user-2', role_id: 'role-tech' }],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', { kind: 'delete_user', userId: 'user-2' });

    expect(result).toEqual({ ok: true });
  });

  it('exempts non-interactive service principals', async () => {
    seed({
      users: [{ user_id: 'svc-1', user_type: 'service', is_inactive: false }],
      userRoles: [{ user_id: 'svc-1', role_id: 'role-tech' }],
    });

    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'set_roles',
      userId: 'svc-1',
      roleIds: [],
    });

    expect(result).toEqual({ ok: true });
  });

  it('allows a no-op removal of a role the user does not hold', async () => {
    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'remove_roles',
      userId: 'user-1',
      roleIds: ['role-tech'],
    });

    expect(result).toEqual({ ok: true });
  });

  it('leaves "user not found" to the caller', async () => {
    const result = await assertUserRoleFloor(trx(), 'tenant-1', {
      kind: 'set_roles',
      userId: 'ghost',
      roleIds: [],
    });

    expect(result).toEqual({ ok: true });
  });
});
