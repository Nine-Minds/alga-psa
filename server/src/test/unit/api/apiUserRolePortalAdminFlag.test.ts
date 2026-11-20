/**
 * alga-2026-0003347 on the REST API, the path the reporter automates.
 *
 * `contacts.is_client_admin` mirrors the client portal 'Admin' role, and the
 * portal visibility resolver widens a flagged contact's ticket, asset and
 * project scope from "their own" to "the whole client" on it. Role changes made
 * through the API never re-derived the flag, so a portal user whose Admin role
 * was taken away kept reading their colleagues' tickets.
 *
 * These tests run the real role writes and the real flag derivation
 * (userRoleWrites -> syncContactClientAdminFlag) against an in-memory database:
 * only the tenant facade is faked, so what is asserted is the end state a
 * caller of each endpoint gets, not that some helper was called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const world = vi.hoisted(() => ({
  users: [] as Row[],
  user_roles: [] as Row[],
  roles: [] as Row[],
  contacts: [] as Row[],
}));

/**
 * A knex-shaped builder over the arrays above: enough of
 * where / whereIn / whereNot / whereRaw / first / select / pluck / insert /
 * del / update / onConflict for the statements the API services and the shared
 * role writes issue. Predicates are collected and applied at resolution time,
 * after the joins, the way SQL evaluates them.
 */
function makeBuilder(table: string) {
  const base = table.split(/\s+as\s+/i)[0];
  const sourceOf = (name: string): Row[] =>
    name === 'users'
      ? world.users
      : name === 'contacts'
        ? world.contacts
        : name === 'roles'
          ? world.roles
          : world.user_roles;

  const ops: Array<{ kind: string; criteria?: Row; column?: string; values?: unknown[]; bindings?: unknown[] }> = [];
  let selectFirst = false;
  let plucked: string | null = null;

  function resolveRows(): Row[] {
    let rows: Row[] = sourceOf(base).map((row) => ({ ...row }));
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
    where(criteria: Row | string, value?: unknown) {
      ops.push({
        kind: 'where',
        criteria: typeof criteria === 'string' ? { [criteria]: value } : criteria,
      });
      return builder;
    },
    andWhere(criteria: Row | string, value?: unknown) {
      return builder.where(criteria, value);
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
    pluck(column: string) {
      plucked = column;
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
        // The (tenant, user_id, role_id) primary key with ON CONFLICT DO NOTHING.
        const duplicate = sourceOf(base).some(
          (existing) => existing.user_id === row.user_id && existing.role_id === row.role_id
        );
        if (duplicate) continue;
        sourceOf(base).push({ ...row });
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
    async delete() {
      return builder.del();
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
      const result = plucked ? rows.map((row) => row[unqualify(plucked!)]) : selectFirst ? rows[0] : rows;
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

function unqualify(column: string): string {
  return column.replace(/^[^.]+\./, '');
}

// Only the tenant facade is faked; userRoleWrites and clientPortalAdminFlag
// above it are the real modules, so the derivation under test is the shipped one.
vi.mock('../../../../../packages/db/src/lib/tenantDb', () => ({
  tenantDb: (_conn: any, _tenant: string) => ({
    table: (name: string) => makeBuilder(name),
    tenantJoin: (builder: any, table: string) => builder.join(table),
  }),
}));

const trxStub: any = () => undefined;
trxStub.isTransaction = true;

class BaseServiceStub {
  constructor(_options: unknown) {}
  async getKnex() {
    return { knex: {} };
  }
}

vi.mock('@alga-psa/db', async () => {
  const writes = await import('../../../../../packages/db/src/lib/userRoleWrites');
  const { tenantDb } = await import('../../../../../packages/db/src/lib/tenantDb');
  return {
    BaseService: BaseServiceStub,
    withTransaction: async (_knex: unknown, cb: (trx: any) => Promise<unknown>) => cb(trxStub),
    runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
    getConnection: async () => ({
      transaction: async (cb: (trx: any) => Promise<unknown>) => cb(trxStub),
    }),
    createSystemContext: (tenant: string) => ({ tenant, userId: 'system' }),
    tenantDb,
    // The floors and the seat guard have their own suites; here they allow the
    // change so the flag derivation is what the assertions see.
    assertUserRoleFloor: async () => ({ ok: true }),
    isUserRoleFloorRejected: (result: any) => result?.ok === false,
    assertSeatTechnicianWrite: async () => undefined,
    setUserRoles: writes.setUserRoles,
    addUserRoles: writes.addUserRoles,
    removeUserRoles: writes.removeUserRoles,
  };
});

vi.mock('@alga-psa/db/models/user', () => ({ default: {} }));
vi.mock('@alga-psa/auth/lib/permissionCapabilities', () => ({ unservedPermissionResources: () => [] }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true), checkMultiplePermissions: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const TENANT = 'tenant-1';
const context = { tenant: TENANT, userId: 'actor-1' } as any;

const CLIENT_ADMIN = 'role-client-admin';
const CLIENT_USER = 'role-client-user';
const MSP_ADMIN = 'role-msp-admin';

function seed({
  userType = 'client',
  contactId = 'contact-1' as string | null,
  roleIds = [] as string[],
  isClientAdmin = false,
} = {}) {
  world.users = [{ tenant: TENANT, user_id: 'user-1', user_type: userType, contact_id: contactId }];
  world.user_roles = roleIds.map((role_id) => ({ tenant: TENANT, user_id: 'user-1', role_id }));
  world.roles = [
    { tenant: TENANT, role_id: CLIENT_ADMIN, role_name: 'Admin', client: true, msp: false },
    { tenant: TENANT, role_id: CLIENT_USER, role_name: 'User', client: true, msp: false },
    { tenant: TENANT, role_id: MSP_ADMIN, role_name: 'Admin', client: false, msp: true },
  ];
  world.contacts = [{ tenant: TENANT, contact_name_id: 'contact-1', is_client_admin: isClientAdmin }];
}

const flag = () => world.contacts[0].is_client_admin;
const roleIdsOfUser = () => world.user_roles.filter((row) => row.user_id === 'user-1').map((row) => row.role_id).sort();

async function permissionRoleService() {
  const { PermissionRoleService } = await import('@/lib/api/services/PermissionRoleService');
  const service: any = new PermissionRoleService();
  service.logAuditEvent = vi.fn();
  return service;
}

async function replaceRolesController() {
  const { ApiUserController } = await import('@/lib/api/controllers/ApiUserController');
  const controller: any = new ApiUserController();
  controller.authenticate = async (req: any) => {
    req.context = { userId: 'actor-1', tenant: TENANT, user: { user_id: 'actor-1', user_type: 'internal' } };
    return req;
  };
  controller.checkPermission = async () => undefined;
  controller.extractIdFromPath = async () => 'user-1';
  controller.userService = { getUserRoles: async () => [] };
  return controller;
}

const replaceRequest = (roleIds: string[]) =>
  new Request('http://x/api/v1/users/user-1/roles', {
    method: 'PUT',
    body: JSON.stringify({ role_ids: roleIds }),
    headers: { 'content-type': 'application/json' },
  }) as any;

beforeEach(() => {
  world.users = [];
  world.user_roles = [];
  world.roles = [];
  world.contacts = [];
});

describe('PUT /api/v1/users/{id}/roles (replace)', () => {
  it('clears the contact flag when the client Admin role is replaced away', async () => {
    seed({ roleIds: [CLIENT_ADMIN], isClientAdmin: true });
    const controller = await replaceRolesController();

    const response = await controller.replaceRoles()(replaceRequest([CLIENT_USER]));

    expect(response.status).toBe(200);
    expect(roleIdsOfUser()).toEqual([CLIENT_USER]);
    expect(flag()).toBe(false);
  });

  it('sets the contact flag when the replacement set brings the client Admin role', async () => {
    seed({ roleIds: [CLIENT_USER], isClientAdmin: false });
    const controller = await replaceRolesController();

    await controller.replaceRoles()(replaceRequest([CLIENT_ADMIN]));

    expect(flag()).toBe(true);
  });

  it('touches no contact for an MSP user', async () => {
    seed({ userType: 'internal', contactId: null, roleIds: [MSP_ADMIN], isClientAdmin: true });
    const controller = await replaceRolesController();

    await controller.replaceRoles()(replaceRequest([MSP_ADMIN]));

    expect(flag()).toBe(true);
  });
});

describe('PermissionRoleService user-role writes', () => {
  it('assignRolesToUser sets the flag when the client Admin role arrives', async () => {
    seed({ roleIds: [CLIENT_USER], isClientAdmin: false });
    const service = await permissionRoleService();

    await expect(service.assignRolesToUser('user-1', [CLIENT_ADMIN], context)).resolves.toMatchObject({
      success: true,
    });
    expect(roleIdsOfUser()).toEqual([CLIENT_ADMIN, CLIENT_USER]);
    expect(flag()).toBe(true);
  });

  it('removeRolesFromUser clears the flag when the client Admin role goes away', async () => {
    seed({ roleIds: [CLIENT_ADMIN, CLIENT_USER], isClientAdmin: true });
    const service = await permissionRoleService();

    await expect(service.removeRolesFromUser('user-1', [CLIENT_ADMIN], context)).resolves.toMatchObject({
      success: true,
    });
    expect(roleIdsOfUser()).toEqual([CLIENT_USER]);
    expect(flag()).toBe(false);
  });

  it('removeRolesFromUser leaves the flag set while another Admin role row remains', async () => {
    seed({ roleIds: [CLIENT_ADMIN, CLIENT_USER], isClientAdmin: true });
    const service = await permissionRoleService();

    await service.removeRolesFromUser('user-1', [CLIENT_USER], context);

    expect(flag()).toBe(true);
  });

  it('replaceUserRoles clears the flag when the client Admin role is replaced away', async () => {
    seed({ roleIds: [CLIENT_ADMIN], isClientAdmin: true });
    const service = await permissionRoleService();

    await service.replaceUserRoles('user-1', [CLIENT_USER], context);

    expect(roleIdsOfUser()).toEqual([CLIENT_USER]);
    expect(flag()).toBe(false);
  });

  it('replaceUserRoles touches no contact for an MSP user', async () => {
    seed({ userType: 'internal', contactId: null, roleIds: [MSP_ADMIN], isClientAdmin: true });
    const service = await permissionRoleService();

    await service.replaceUserRoles('user-1', [MSP_ADMIN], context);

    expect(flag()).toBe(true);
  });
});
