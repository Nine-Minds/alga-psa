import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  actorRoles: vi.fn(),
  hasPermission: vi.fn(),
  users: [] as Array<Record<string, any>>,
  assignments: ['existing-role'] as string[],
  targetPermissions: [{ role_id: 'admin-role', resource: 'system', action: 'admin', msp: true }],
}));

function queryFor(table: string) {
  const q: any = {
    where: (criteria: Record<string, any>) => { q.criteria = criteria; return q; },
    andWhere: (column: string, value: unknown) => { q.filters ??= {}; q.filters[column] = value; return q; },
    select: () => q,
    first: async () => table === 'users'
      ? (q.filters?.email || q.filters?.username)
        ? undefined
        : fixture.users.find((user) => !q.criteria?.user_id || user.user_id === q.criteria.user_id) ?? { user_id: 'target-user' }
      : undefined,
    whereIn: (_column: string, ids: string[]) => { q.ids = ids; return q; },
    insert: async (rows: Record<string, any> | Record<string, any>[]) => {
      const values = Array.isArray(rows) ? rows : [rows];
      if (table === 'users') fixture.users.push(...values);
      if (table === 'user_roles') fixture.assignments.push(...values.map((value) => value.role_id));
      return values;
    },
    del: async () => { fixture.assignments.splice(0); return 1; },
    update: async () => 1,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
      let rows: unknown[] = [];
      if (table === 'roles') rows = (q.ids ?? []).map((role_id: string) => ({ role_id, msp: true }));
      if (table === 'role_permissions as rp') rows = fixture.targetPermissions.filter((row) => q.ids?.includes(row.role_id));
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return q;
}

const db = vi.hoisted(() => ((table: string) => queryFor(table)) as any);

vi.mock('@alga-psa/db', () => ({
  BaseService: class {
    async getKnex() { return { knex: db, tenant: 'tenant-1' }; }
    buildTenantScopedQuery(_conn: unknown, _context: unknown) { return queryFor('users'); }
  },
  tenantDb: (_conn: unknown, _tenant: string) => ({ table: (table: string) => queryFor(table), tenantJoin: () => undefined }),
  createTenantKnex: async () => ({ knex: db, tenant: 'tenant-1' }),
  withTransaction: async (_knex: unknown, callback: (trx: any) => unknown) => callback(db),
  validateSystemContext: () => undefined,
}));
vi.mock('@alga-psa/db/models/user', () => ({ default: { getUserRolesWithPermissions: fixture.actorRoles } }));
vi.mock('@alga-psa/db/models/userPreferences', () => ({ default: { upsert: vi.fn() } }));
vi.mock('@alga-psa/teams/models/team', () => ({ default: {} }));
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({ hasPermission: fixture.hasPermission }));
vi.mock('@alga-psa/core/encryption', () => ({ hashPassword: async () => 'hashed' }));
vi.mock('@alga-psa/auth', () => ({ verifyAuthenticator: vi.fn() }));
vi.mock('@alga-psa/storage', () => ({ uploadEntityImage: vi.fn(), deleteEntityImage: vi.fn() }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({ getUserAvatarUrl: vi.fn() }));
vi.mock('@alga-psa/core', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../lib/internalUserLicenseGuard', () => ({
  admitInternalUserSeat: async () => ({ ok: true }),
  assertInternalUserSeatsWithinLimit: async () => undefined,
  isInternalUserLicenseLimitRejected: () => false,
}));
vi.mock('./userResponseSanitizer', () => ({
  sanitizeUserForResponse: (user: any) => user,
  USER_RESPONSE_COLUMNS: [],
  USER_RESPONSE_FIELD_NAMES: ['user_id', 'email'],
}));

import { UserService } from './UserService';

describe('UserService MSP role grant authorization', () => {
  beforeEach(() => {
    fixture.actorRoles.mockReset();
    fixture.hasPermission.mockReset();
    fixture.users.splice(0);
    fixture.assignments.splice(0, fixture.assignments.length, 'existing-role');
    fixture.targetPermissions.splice(0, fixture.targetPermissions.length,
      { role_id: 'admin-role', resource: 'system', action: 'admin', msp: true });
    fixture.actorRoles.mockResolvedValue([{ msp: true, permissions: [{ resource: 'ticket', action: 'read', msp: true }] }]);
    fixture.hasPermission.mockResolvedValue(true);
  });

  const context = { userId: 'actor', tenant: 'tenant-1', user: { user_id: 'actor', tenant: 'tenant-1', user_type: 'internal' } } as any;

  it('rejects UserService.create before inserting the account or role assignment', async () => {
    const service = new UserService();

    await expect(service.create({
      username: 'new@example.test', email: 'new@example.test', password: 'secret', role_ids: ['admin-role'], user_type: 'internal',
    } as any, context)).rejects.toThrow(/Cannot assign an MSP role/);

    expect(fixture.users).toHaveLength(0);
    expect(fixture.assignments).toEqual(['existing-role']);
  });

  it('rejects UserService.assignRoles before replacing existing assignments', async () => {
    const service = new UserService();

    await expect(service.assignRoles('target-user', ['admin-role'], context)).rejects.toThrow(/Cannot assign an MSP role/);

    expect(fixture.assignments).toEqual(['existing-role']);
  });
});
