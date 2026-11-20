/**
 * The role-set writes carry the derived portal-admin flag (tickets
 * alga-2026-0003317 / alga-2026-0003347): whatever a caller does to
 * `user_roles`, the linked contact's `is_client_admin` ends up equal to "holds
 * a client Admin role" in the same transaction.
 *
 * The database is an in-memory fake (no Postgres needed) and the real
 * syncContactClientAdminFlag runs on it, so what these tests pin is the
 * end state a caller gets — including the case this card is about: a contact
 * pre-marked as portal admin whose user is created with the 'User' role.
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

import { addUserRoles, removeUserRoles, setUserRoles } from './userRoleWrites';

/**
 * A tiny knex-shaped builder over the arrays above: enough of
 * where / whereNot / whereIn / whereRaw / first / select / insert / del /
 * onConflict for the statements these two modules issue. Predicates are
 * collected and applied at resolution time, after the joins, the way SQL
 * evaluates them.
 */
function makeBuilder(table: string) {
  const sourceOf = (name: string): Row[] =>
    name === 'users' ? world.users : name === 'contacts' ? world.contacts : world.user_roles;
  const ops: Array<{ kind: string; criteria?: Row; column?: string; values?: unknown[]; bindings?: unknown[] }> = [];
  let selectFirst = false;

  function resolveRows(): Row[] {
    let rows: Row[] = sourceOf(table).map((row) => ({ ...row }));
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
      } else if (op.kind === 'whereIn') {
        rows = rows.filter((row) => op.values!.includes(row[unqualify(op.column!)]));
      } else if (op.kind === 'whereRaw') {
        rows = rows.filter((row) => String(row.role_name).toLowerCase() === op.bindings![0]);
      }
    }
    return rows;
  }

  const builder: any = {
    join(other: string) {
      ops.push({ kind: 'join' });
      expect(other.startsWith('roles')).toBe(true);
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
    whereIn(column: string, values: unknown[]) {
      ops.push({ kind: 'whereIn', column, values });
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
    select(..._columns: string[]) {
      return builder;
    },
    insert(rows: Row | Row[]) {
      const incoming = Array.isArray(rows) ? rows : [rows];
      const inserted: Row[] = [];
      const chain: any = {
        onConflict: () => chain,
        ignore: () => chain,
        returning: () => chain,
        then: (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(inserted).then(resolve, reject),
      };
      for (const row of incoming) {
        // The (tenant, user_id, role_id) primary key, with the ON CONFLICT DO
        // NOTHING the helper asks for: an existing pair is left as it is.
        const duplicate = world.user_roles.some(
          (existing) => existing.user_id === row.user_id && existing.role_id === row.role_id
        );
        if (duplicate) continue;
        world.user_roles.push({ ...row });
        inserted.push({ ...row });
      }
      return chain;
    },
    async del() {
      const doomed = resolveRows();
      world.user_roles = world.user_roles.filter(
        (row) => !doomed.some((hit) => hit.user_id === row.user_id && hit.role_id === row.role_id)
      );
      return doomed.length;
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

const trx = () => ({ isTransaction: true }) as any;

function seed({
  userType = 'client',
  contactId = 'contact-1' as string | null,
  roleIds = [] as string[],
  isClientAdmin = false,
}) {
  world.users = [{ user_id: 'user-1', user_type: userType, contact_id: contactId }];
  world.user_roles = roleIds.map((role_id) => ({ tenant: 'tenant-1', user_id: 'user-1', role_id }));
  world.roles = [
    { role_id: 'client-admin', role_name: 'Admin', client: true, msp: false },
    { role_id: 'client-user', role_name: 'User', client: true, msp: false },
    { role_id: 'msp-admin', role_name: 'Admin', client: false, msp: true },
  ];
  world.contacts = [{ contact_name_id: 'contact-1', is_client_admin: isClientAdmin }];
}

const flag = () => world.contacts[0].is_client_admin;
const roleIdsOf = (userId: string) =>
  world.user_roles.filter((row) => row.user_id === userId).map((row) => row.role_id).sort();

describe('user_roles writes', () => {
  beforeEach(() => {
    world.users = [];
    world.user_roles = [];
    world.roles = [];
    world.contacts = [];
  });

  describe('setUserRoles', () => {
    it('replaces the role set and clears the flag when Admin is swapped away', async () => {
      seed({ roleIds: ['client-admin'], isClientAdmin: true });

      await setUserRoles(trx(), 'tenant-1', 'user-1', ['client-user']);

      expect(roleIdsOf('user-1')).toEqual(['client-user']);
      expect(flag()).toBe(false);
    });

    it('sets the flag when the replacement set includes Admin', async () => {
      seed({ roleIds: ['client-user'], isClientAdmin: false });

      await setUserRoles(trx(), 'tenant-1', 'user-1', ['client-user', 'client-admin']);

      expect(roleIdsOf('user-1')).toEqual(['client-admin', 'client-user']);
      expect(flag()).toBe(true);
    });

    it('clears the flag when the role set is emptied', async () => {
      seed({ roleIds: ['client-admin'], isClientAdmin: true });

      await setUserRoles(trx(), 'tenant-1', 'user-1', []);

      expect(roleIdsOf('user-1')).toEqual([]);
      expect(flag()).toBe(false);
    });

    it('leaves contacts alone for an MSP user', async () => {
      seed({ userType: 'internal', contactId: null, roleIds: ['msp-admin'], isClientAdmin: true });

      await setUserRoles(trx(), 'tenant-1', 'user-1', ['msp-admin']);

      expect(flag()).toBe(true);
    });
  });

  describe('addUserRoles', () => {
    it('sets the flag when the client Admin role arrives', async () => {
      seed({ roleIds: ['client-user'], isClientAdmin: false });

      const rows = await addUserRoles(trx(), 'tenant-1', 'user-1', ['client-admin']);

      expect(rows).toEqual([{ tenant: 'tenant-1', user_id: 'user-1', role_id: 'client-admin' }]);
      expect(flag()).toBe(true);
    });

    // The card's creation case: the flag is only an invitation pre-seed, so the
    // role the account is created with wins the moment the user exists.
    it('clears a pre-seeded flag when the account is created with the User role', async () => {
      seed({ roleIds: [], isClientAdmin: true });

      await addUserRoles(trx(), 'tenant-1', 'user-1', ['client-user']);

      expect(flag()).toBe(false);
    });

    it('keeps a pre-seeded flag when the account is created with the Admin role', async () => {
      seed({ roleIds: [], isClientAdmin: true });

      await addUserRoles(trx(), 'tenant-1', 'user-1', ['client-admin']);

      expect(flag()).toBe(true);
    });

    it('is idempotent and still returns the row for a role the user already holds', async () => {
      seed({ roleIds: ['client-admin'], isClientAdmin: true });

      const rows = await addUserRoles(trx(), 'tenant-1', 'user-1', ['client-admin']);

      expect(roleIdsOf('user-1')).toEqual(['client-admin']);
      expect(rows).toEqual([{ tenant: 'tenant-1', user_id: 'user-1', role_id: 'client-admin' }]);
      expect(flag()).toBe(true);
    });

    it('writes nothing and reports no rows for an empty role list', async () => {
      seed({ roleIds: ['client-user'], isClientAdmin: false });

      await expect(addUserRoles(trx(), 'tenant-1', 'user-1', [])).resolves.toEqual([]);
      expect(roleIdsOf('user-1')).toEqual(['client-user']);
    });
  });

  describe('removeUserRoles', () => {
    it('clears the flag when the client Admin role is taken away', async () => {
      seed({ roleIds: ['client-admin', 'client-user'], isClientAdmin: true });

      await expect(removeUserRoles(trx(), 'tenant-1', 'user-1', ['client-admin'])).resolves.toBe(1);

      expect(roleIdsOf('user-1')).toEqual(['client-user']);
      expect(flag()).toBe(false);
    });

    it('leaves the flag set when another Admin role row remains', async () => {
      seed({ roleIds: ['client-admin', 'client-user'], isClientAdmin: true });

      await removeUserRoles(trx(), 'tenant-1', 'user-1', ['client-user']);

      expect(flag()).toBe(true);
    });

    it('leaves contacts alone for an MSP user', async () => {
      seed({ userType: 'internal', contactId: null, roleIds: ['msp-admin'], isClientAdmin: true });

      await removeUserRoles(trx(), 'tenant-1', 'user-1', ['msp-admin']);

      expect(flag()).toBe(true);
    });
  });

  it('refuses to run outside a transaction, where the flag could not commit with the write', async () => {
    seed({ roleIds: ['client-admin'], isClientAdmin: true });

    await expect(setUserRoles({} as any, 'tenant-1', 'user-1', ['client-user'])).rejects.toThrow(
      /must run inside a transaction/
    );
    await expect(addUserRoles({} as any, 'tenant-1', 'user-1', ['client-user'])).rejects.toThrow(
      /must run inside a transaction/
    );
    await expect(removeUserRoles({} as any, 'tenant-1', 'user-1', ['client-admin'])).rejects.toThrow(
      /must run inside a transaction/
    );
  });
});
