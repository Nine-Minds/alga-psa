/**
 * contacts.is_client_admin is a mirror of the client portal 'Admin' role
 * (ticket alga-2026-0003317): a contact left flagged after the role was taken
 * away keeps the company-wide ticket/asset/project scope the portal visibility
 * resolver grants admins.
 *
 * The database is an in-memory fake (no Postgres needed); what these tests pin
 * is the decision table — who gets re-derived, and in which direction.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const world = {
  users: [] as Row[],
  user_roles: [] as Row[],
  roles: [] as Row[],
  contacts: [] as Row[],
};

vi.mock('./tenantDb', () => ({
  tenantDb: (_conn: any, _tenant: string) => ({
    table: (name: string) => makeBuilder(name),
    tenantJoin: (builder: any, table: string) => builder.join(table),
  }),
}));

import { syncContactClientAdminFlag } from './clientPortalAdminFlag';

/**
 * A tiny knex-shaped builder over the arrays above: enough of
 * where / whereNot / whereRaw / first / update for this module's statements.
 * Predicates are collected and applied at resolution time, after the joins, the
 * way SQL evaluates them — the module registers its join after the where.
 */
function makeBuilder(table: string) {
  const source =
    table === 'users' ? world.users
      : table === 'contacts' ? world.contacts
        : world.user_roles;
  const ops: Array<{ kind: string; criteria?: Row; bindings?: unknown[] }> = [];
  let selectFirst = false;

  function resolveRows(): Row[] {
    let rows: Row[] = source.map((row) => ({ ...row }));
    if (ops.some((op) => op.kind === 'join')) {
      rows = rows.flatMap((userRole) => {
        const role = world.roles.find((candidate) => candidate.role_id === userRole.role_id);
        return role ? [{ ...userRole, ...role }] : [];
      });
    }
    for (const op of ops) {
      if (op.kind === 'where') {
        rows = rows.filter((row) =>
          Object.entries(op.criteria!).every(([column, expected]) => row[unqualify(column)] === expected)
        );
      } else if (op.kind === 'whereNot') {
        rows = rows.filter((row) =>
          Object.entries(op.criteria!).every(([column, expected]) => row[unqualify(column)] !== expected)
        );
      } else if (op.kind === 'whereRaw') {
        rows = rows.filter((row) => String(row.role_name).toLowerCase() === op.bindings![0]);
      }
    }
    return rows;
  }

  const builder: any = {
    join(other: string) {
      if (!other.startsWith('roles')) throw new Error(`Unexpected join to ${other}`);
      ops.push({ kind: 'join' });
      return builder;
    },
    where(criteria: Row) {
      ops.push({ kind: 'where', criteria });
      return builder;
    },
    whereNot(criteria: Row) {
      ops.push({ kind: 'whereNot', criteria });
      return builder;
    },
    whereRaw(_sql: string, bindings: unknown[]) {
      ops.push({ kind: 'whereRaw', bindings });
      return builder;
    },
    first(..._columns: string[]) {
      selectFirst = true;
      return builder;
    },
    async update(values: Row) {
      const matched = resolveRows().map((row) => row.contact_name_id);
      for (const contact of world.contacts) {
        if (matched.includes(contact.contact_name_id)) Object.assign(contact, values);
      }
      return matched.length;
    },
    then(resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) {
      const rows = resolveRows();
      return Promise.resolve(selectFirst ? rows[0] : rows).then(resolve, reject);
    },
  };
  return builder;
}

function unqualify(column: string): string {
  return column.replace(/^[^.]+\./, '');
}

const trx = () => ({ isTransaction: true } as any);

function seed({
  userType = 'client',
  contactId = 'contact-1' as string | null,
  roleIds = [] as string[],
  isClientAdmin = false,
}) {
  world.users = [{ user_id: 'user-1', user_type: userType, contact_id: contactId }];
  world.user_roles = roleIds.map((role_id) => ({ user_id: 'user-1', role_id }));
  world.roles = [
    { role_id: 'client-admin', role_name: 'Admin', client: true, msp: false },
    { role_id: 'client-user', role_name: 'User', client: true, msp: false },
    { role_id: 'msp-admin', role_name: 'Admin', client: false, msp: true },
  ];
  world.contacts = [{ contact_name_id: 'contact-1', is_client_admin: isClientAdmin }];
}

const flag = () => world.contacts[0].is_client_admin;

describe('syncContactClientAdminFlag', () => {
  beforeEach(() => {
    world.users = [];
    world.user_roles = [];
    world.roles = [];
    world.contacts = [];
  });

  it('clears the flag when the portal user no longer holds the client Admin role', async () => {
    seed({ roleIds: ['client-user'], isClientAdmin: true });

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-1');

    expect(flag()).toBe(false);
    expect(world.contacts[0].updated_at).toEqual(expect.any(String));
  });

  it('sets the flag when the portal user is given the client Admin role', async () => {
    seed({ roleIds: ['client-user', 'client-admin'], isClientAdmin: false });

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-1');

    expect(flag()).toBe(true);
  });

  it('does not count an MSP Admin role as client portal admin', async () => {
    seed({ roleIds: ['msp-admin'], isClientAdmin: true });

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-1');

    expect(flag()).toBe(false);
  });

  it('writes nothing when the flag already agrees with the roles', async () => {
    seed({ roleIds: ['client-admin'], isClientAdmin: true });

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-1');

    expect(flag()).toBe(true);
    expect(world.contacts[0].updated_at).toBeUndefined();
  });

  it('never touches contacts for an internal user', async () => {
    seed({ userType: 'internal', contactId: null, roleIds: ['msp-admin'], isClientAdmin: true });

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-1');

    expect(flag()).toBe(true);
  });

  it('leaves a portal user with no linked contact alone', async () => {
    seed({ contactId: null, roleIds: ['client-user'], isClientAdmin: true });

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-1');

    expect(flag()).toBe(true);
  });

  it('leaves an unknown user alone', async () => {
    seed({ roleIds: ['client-user'], isClientAdmin: true });

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'nobody');

    expect(flag()).toBe(true);
  });
});
