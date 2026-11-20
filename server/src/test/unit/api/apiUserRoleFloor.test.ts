/**
 * Ticket alga-2026-0003292 on the REST API: removing roles no longer merely
 * warns when a user is left with none, replacing roles rejects an empty list,
 * and neither may take the tenant's last active MSP Admin.
 *
 * The floors themselves are decided by the shared guard (covered in
 * packages/db userRoleFloor.test.ts); these tests mock the guard and pin the
 * API-side wiring: it runs before the write, and its verdict is reported as
 * 400 (assign another role first) or 409 (the tenant needs an admin).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  floor: { ok: true } as any,
  floorCalls: [] as any[],
  writes: [] as string[],
}));

class BaseServiceStub {
  constructor(_options: unknown) {}
  async getKnex() {
    return { knex: knexStub };
  }
}

const trxStub: any = () => undefined;
trxStub.isTransaction = true;

const knexStub: any = {
  transaction: async (cb: (trx: any) => Promise<unknown>) => cb(trxStub),
};

vi.mock('@alga-psa/db', () => ({
  BaseService: BaseServiceStub,
  withTransaction: async (_knex: unknown, cb: (trx: any) => Promise<unknown>) => cb(trxStub),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
  getConnection: async () => knexStub,
  createSystemContext: (tenant: string) => ({ tenant, userId: 'system' }),
  tenantDb: (_conn: unknown, _tenant: string) => ({
    table: (table: string) => buildTable(table),
  }),
  assertUserRoleFloor: async (...args: any[]) => {
    state.floorCalls.push(args);
    return state.floor;
  },
  isUserRoleFloorRejected: (result: any) => result?.ok === false,
}));

function buildTable(table: string) {
  const builder: any = {
    where: () => builder,
    whereIn: () => builder,
    first: async () => (table === 'users' ? { user_id: 'target-1', user_type: 'internal' } : undefined),
    pluck: async () => ['role-admin'],
    delete: async () => {
      state.writes.push(`delete:${table}`);
      return 1;
    },
    del: async () => {
      state.writes.push(`delete:${table}`);
      return 1;
    },
    insert: async () => {
      state.writes.push(`insert:${table}`);
      return [];
    },
    count: () => builder,
  };
  return builder;
}

vi.mock('@alga-psa/db/models/user', () => ({ default: {} }));
vi.mock('@alga-psa/auth/lib/permissionCapabilities', () => ({ unservedPermissionResources: () => [] }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true), checkMultiplePermissions: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const LAST_ROLE = {
  ok: false,
  violation: 'last_role',
  message: 'A user must keep at least one role. Assign another role first, then remove this one.',
};
const LAST_ADMIN = {
  ok: false,
  violation: 'last_msp_admin',
  message: 'A tenant must keep at least one active MSP Admin user.',
};

const context = { tenant: 'tenant-1', userId: 'actor-1' } as any;

describe('PermissionRoleService role floors', () => {
  beforeEach(() => {
    state.floor = { ok: true };
    state.floorCalls = [];
    state.writes = [];
  });

  it('rejects a removal that would leave the user with no role, instead of warning', async () => {
    state.floor = LAST_ROLE;
    const { PermissionRoleService } = await import('@/lib/api/services/PermissionRoleService');
    const service: any = new PermissionRoleService();

    await expect(service.removeRolesFromUser('target-1', ['role-admin'], context)).rejects.toMatchObject({
      name: 'ValidationError',
      message: LAST_ROLE.message,
    });
    expect(state.writes).toEqual([]);
    expect(state.floorCalls[0][2]).toEqual({ kind: 'remove_roles', userId: 'target-1', roleIds: ['role-admin'] });
  });

  it('rejects a removal that would leave the tenant with no active MSP admin', async () => {
    state.floor = LAST_ADMIN;
    const { PermissionRoleService } = await import('@/lib/api/services/PermissionRoleService');
    const service: any = new PermissionRoleService();
    service.logAuditEvent = vi.fn();

    await expect(service.removeRolesFromUser('target-1', ['role-admin'], context)).rejects.toMatchObject({
      name: 'ConflictError',
      message: LAST_ADMIN.message,
    });
    expect(state.writes).toEqual([]);
  });

  it('rejects replacing a user\'s roles with an empty list', async () => {
    state.floor = LAST_ROLE;
    const { PermissionRoleService } = await import('@/lib/api/services/PermissionRoleService');
    const service: any = new PermissionRoleService();

    await expect(service.replaceUserRoles('target-1', [], context)).rejects.toMatchObject({
      name: 'ValidationError',
      message: LAST_ROLE.message,
    });
    expect(state.writes).toEqual([]);
    expect(state.floorCalls[0][2]).toEqual({ kind: 'set_roles', userId: 'target-1', roleIds: [] });
  });

  it('removes roles when the floors allow it', async () => {
    const { PermissionRoleService } = await import('@/lib/api/services/PermissionRoleService');
    const service: any = new PermissionRoleService();
    service.logAuditEvent = vi.fn();

    await expect(service.removeRolesFromUser('target-1', ['role-tech'], context)).resolves.toMatchObject({
      success: true,
    });
    expect(state.writes).toEqual(['delete:user_roles']);
  });
});

describe('ApiUserController.replaceRoles role floors', () => {
  beforeEach(() => {
    state.floor = { ok: true };
    state.floorCalls = [];
    state.writes = [];
  });

  async function makeController() {
    const { ApiUserController } = await import('@/lib/api/controllers/ApiUserController');
    const controller: any = new ApiUserController();
    controller.authenticate = async (req: any) => {
      req.context = { userId: 'actor-1', tenant: 'tenant-1', user: { user_id: 'actor-1', user_type: 'internal' } };
      return req;
    };
    controller.checkPermission = async () => undefined;
    controller.extractIdFromPath = async () => 'target-1';
    controller.userService = { getUserRoles: async () => [] };
    return controller;
  }

  const request = (body: unknown) =>
    new Request('http://x/api/v1/users/target-1/roles', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }) as any;

  it('400s an empty role_ids with the assign-another-role message', async () => {
    state.floor = LAST_ROLE;
    const controller = await makeController();

    const response = await controller.replaceRoles()(request({ role_ids: [] }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(LAST_ROLE.message);
    expect(state.writes).toEqual([]);
    expect(state.floorCalls[0][2]).toEqual({ kind: 'set_roles', userId: 'target-1', roleIds: [] });
  });

  it('409s a replacement that drops the tenant\'s last active MSP admin', async () => {
    state.floor = LAST_ADMIN;
    const controller = await makeController();

    const response = await controller.replaceRoles()(request({ role_ids: ['role-tech'] }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(LAST_ADMIN.message);
    expect(state.writes).toEqual([]);
  });
});
