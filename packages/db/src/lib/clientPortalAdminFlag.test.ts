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

import {
  resolveInitialPortalRoleId,
  syncContactClientAdminFlag,
  syncContactClientAdminFlagForContact,
  syncContactClientAdminFlagsForUserLinkChange,
} from './clientPortalAdminFlag';

/**
 * A tiny knex-shaped builder over the arrays above: enough of
 * where / whereIn / whereNot / whereRaw / select / first / update for this
 * module's statements. Predicates are collected and applied at resolution time,
 * after the joins, the way SQL evaluates them — the module registers its join
 * after the where.
 */
function makeBuilder(table: string) {
  const base = table.split(/\s+as\s+/i)[0];
  const sourceOf = (): Row[] =>
    base === 'users' ? world.users
      : base === 'contacts' ? world.contacts
        : base === 'roles' ? world.roles
          : world.user_roles;
  const ops: Array<{ kind: string; criteria?: Row; bindings?: unknown[]; column?: string; values?: unknown[] }> = [];
  let selectFirst = false;

  function resolveRows(): Row[] {
    let rows: Row[] = sourceOf().map((row) => ({ ...row }));
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
    whereIn(column: string, values: unknown[]) {
      ops.push({ kind: 'whereIn', column, values });
      return builder;
    },
    whereRaw(_sql: string, bindings: unknown[]) {
      ops.push({ kind: 'whereRaw', bindings });
      return builder;
    },
    select(..._columns: string[]) {
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

/**
 * `users.contact_id` is indexed but not unique, so a contact can carry more
 * than one portal account. The flag is one per contact, so it is true when ANY
 * of them holds the client 'Admin' role — the rule the repair migrations
 * converge on. Deriving it from only the account just written let a second,
 * plain 'User' account clear the flag its admin colleague's access depends on.
 */
describe('a contact with more than one portal user', () => {
  beforeEach(() => {
    world.users = [];
    world.user_roles = [];
    world.roles = [];
    world.contacts = [];
  });

  function seedTwoUsers({ isClientAdmin = true } = {}) {
    world.users = [
      { user_id: 'user-admin', user_type: 'client', contact_id: 'contact-1' },
      { user_id: 'user-plain', user_type: 'client', contact_id: 'contact-1' },
    ];
    world.user_roles = [
      { user_id: 'user-admin', role_id: 'client-admin' },
      { user_id: 'user-plain', role_id: 'client-user' },
    ];
    world.roles = [
      { role_id: 'client-admin', role_name: 'Admin', client: true, msp: false },
      { role_id: 'client-user', role_name: 'User', client: true, msp: false },
    ];
    world.contacts = [{ contact_name_id: 'contact-1', is_client_admin: isClientAdmin }];
  }

  it('keeps the flag set when the plain account is the one written', async () => {
    seedTwoUsers();

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-plain');

    expect(flag()).toBe(true);
  });

  it('keeps the flag set when the admin account is the one written', async () => {
    seedTwoUsers();

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-admin');

    expect(flag()).toBe(true);
  });

  it('clears the flag once the last Admin role is gone', async () => {
    seedTwoUsers();
    world.user_roles = world.user_roles.filter((row) => row.role_id !== 'client-admin');

    await syncContactClientAdminFlag(trx(), 'tenant-1', 'user-admin');

    expect(flag()).toBe(false);
  });
});

describe('syncContactClientAdminFlagForContact', () => {
  beforeEach(() => {
    world.users = [];
    world.user_roles = [];
    world.roles = [];
    world.contacts = [];
  });

  it('re-derives the flag from the contact alone', async () => {
    seed({ roleIds: ['client-user'], isClientAdmin: true });

    await syncContactClientAdminFlagForContact(trx(), 'tenant-1', 'contact-1');

    expect(flag()).toBe(false);
  });

  it('leaves a contact with no portal user alone: there the flag is the pre-mark', async () => {
    seed({ roleIds: ['client-user'], isClientAdmin: true });
    world.users = [{ user_id: 'user-1', user_type: 'internal', contact_id: 'contact-1' }];

    await syncContactClientAdminFlagForContact(trx(), 'tenant-1', 'contact-1');

    expect(flag()).toBe(true);
  });
});

/**
 * A changed `users.contact_id` or `users.user_type` writes no role row, but it
 * changes what the roles the account already holds mean for a contact: the REST
 * update (PUT /api/v1/users/{id}) and the invitation relink both do it.
 */
describe('syncContactClientAdminFlagsForUserLinkChange', () => {
  beforeEach(() => {
    world.users = [];
    world.user_roles = [];
    world.roles = [];
    world.contacts = [];
  });

  function seedLink({ roleIds = ['client-user'] as string[] } = {}) {
    world.users = [{ user_id: 'user-1', user_type: 'client', contact_id: 'contact-new' }];
    world.user_roles = roleIds.map((role_id) => ({ user_id: 'user-1', role_id }));
    world.roles = [
      { role_id: 'client-admin', role_name: 'Admin', client: true, msp: false },
      { role_id: 'client-user', role_name: 'User', client: true, msp: false },
    ];
    world.contacts = [
      { contact_name_id: 'contact-new', is_client_admin: true },
      { contact_name_id: 'contact-old', is_client_admin: true },
    ];
  }

  const contactFlag = (contactId: string) =>
    world.contacts.find((row) => row.contact_name_id === contactId)!.is_client_admin;

  it('clears a pre-marked contact that a plain account was just linked to', async () => {
    seedLink();

    await syncContactClientAdminFlagsForUserLinkChange(trx(), 'tenant-1', 'user-1', 'contact-old');

    expect(contactFlag('contact-new')).toBe(false);
  });

  it('sets the new contact when the linked account holds the Admin role', async () => {
    seedLink({ roleIds: ['client-admin'] });
    world.contacts[0].is_client_admin = false;

    await syncContactClientAdminFlagsForUserLinkChange(trx(), 'tenant-1', 'user-1', 'contact-old');

    expect(contactFlag('contact-new')).toBe(true);
  });

  it('leaves the contact the user left as its pre-mark, having no portal user now', async () => {
    seedLink();

    await syncContactClientAdminFlagsForUserLinkChange(trx(), 'tenant-1', 'user-1', 'contact-old');

    expect(contactFlag('contact-old')).toBe(true);
  });

  it('re-derives the contact the user still points at when its user_type changed', async () => {
    seedLink();
    world.users = [
      { user_id: 'user-1', user_type: 'internal', contact_id: 'contact-new' },
      { user_id: 'user-2', user_type: 'client', contact_id: 'contact-new' },
    ];
    world.user_roles = [{ user_id: 'user-2', role_id: 'client-user' }];

    await syncContactClientAdminFlagsForUserLinkChange(trx(), 'tenant-1', 'user-1', null);

    expect(contactFlag('contact-new')).toBe(false);
  });
});

/**
 * Before the portal user exists the flag runs the other way: it is the
 * invitation pre-mark the MSP sets on the contact, and the contact screen
 * promises the account "will be created with Client Admin role". Every creation
 * path reads it through this resolver, so none of them can downgrade a
 * pre-marked contact to 'User' and then have the sync take the flag away.
 */
describe('resolveInitialPortalRoleId', () => {
  beforeEach(() => {
    world.users = [];
    world.user_roles = [];
    world.roles = [
      { role_id: 'client-admin', role_name: 'Admin', client: true, msp: false },
      { role_id: 'client-user', role_name: 'User', client: true, msp: false },
      { role_id: 'client-reader', role_name: 'Read Only', client: true, msp: false },
      { role_id: 'msp-admin', role_name: 'Admin', client: false, msp: true },
    ];
    world.contacts = [
      { contact_name_id: 'contact-admin', is_client_admin: true },
      { contact_name_id: 'contact-plain', is_client_admin: false },
    ];
  });

  it('gives a pre-marked contact the client Admin role', async () => {
    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', 'contact-admin')).resolves.toBe('client-admin');
  });

  it('gives an unmarked contact the portal User role', async () => {
    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', 'contact-plain')).resolves.toBe('client-user');
  });

  it('never picks an MSP role named Admin', async () => {
    world.roles = world.roles.filter((role) => role.role_id !== 'client-admin');

    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', 'contact-admin')).resolves.toBe('client-user');
  });

  it('honours a configured default role for an unmarked contact (the Entra sync)', async () => {
    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', 'contact-plain', 'read only')).resolves.toBe('client-reader');
  });

  it('lets the pre-mark win over a configured default role', async () => {
    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', 'contact-admin', 'Read Only')).resolves.toBe('client-admin');
  });

  it('falls back to the default role when the tenant has no client Admin role', async () => {
    world.roles = world.roles.filter((role) => role.role_id !== 'client-admin');

    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', 'contact-admin', 'Read Only')).resolves.toBe('client-reader');
  });

  it('returns null when no role matches, leaving the error to the caller', async () => {
    world.roles = [];

    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', 'contact-plain')).resolves.toBeNull();
  });

  it('resolves the default role when there is no contact to read', async () => {
    await expect(resolveInitialPortalRoleId(trx(), 'tenant-1', null)).resolves.toBe('client-user');
  });
});
