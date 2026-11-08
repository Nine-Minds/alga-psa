/**
 * Service principals A/4 (users slice), real Postgres.
 *
 *  - T026 (F018/F019/F082): getAllUsers / getAllUsersBasic / User.getAll and the REST UserService
 *    list/search/stats exclude non-interactive ('service') users by default and include them with
 *    `includeNonInteractive`; the Settings -> Users MSP tab data source excludes them; the user
 *    detail loaders reject their ids.
 *    (The test description says `includeServicePrincipals`; the PRD names the option
 *    `includeNonInteractive`, which is what is implemented.)
 *  - T013 user-management half (F042/F083): adminChangeUserPassword, deleteUser, reactivate
 *    (updateUser is_inactive=false), deactivate and the REST password change refuse a service target
 *    and leave the DB unchanged.
 *  - F085: user_type is immutable (never to/from 'service').
 *  - F086: REST UserService.create accepts only internal|client and enforces the seat limit.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createServiceUser } from '../../../test-utils/serviceUserFixtures';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: async () => '' })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

let testDb: Knex;
let mockCurrentUser: any = null;

// The packages under test import withAuth from the '@alga-psa/auth' barrel.
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrap = (action: any) => async (...args: any[]) => {
    const user = mockCurrentUser;
    if (!user) throw new Error('User not authenticated');
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
  };
  return { ...actual, withAuth: wrap, withOptionalAuth: wrap };
});

// RBAC is not under test here; the caller is an Admin with every permission.
vi.mock('@alga-psa/user-composition/lib/permissions', () => ({
  hasPermission: vi.fn(async () => true),
  throwPermissionError: (action: string) => {
    throw new Error(`Permission denied: Cannot ${action}`);
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async (tenant?: string) => ({ knex: testDb, tenant: tenant ?? mockCurrentUser?.tenant })),
  };
});

let db: Knex;
const tenantsToCleanup = new Set<string>();

const tt = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  for (const table of ['user_preferences', 'user_roles', 'roles', 'users']) {
    await tt(tenantId, table).del();
  }
  await tenantRows().where({ tenant: tenantId }).del();
}

interface Fixture {
  tenant: string;
  admin: any;
  internalId: string;
  clientId: string;
  serviceId: string;
  adminRoleId: string;
}

async function insertUser(tenant: string, userType: 'internal' | 'client', label: string) {
  const userId = uuidv4();
  await tt(tenant, 'users').insert({
    tenant,
    user_id: userId,
    username: `${label}-${userId.slice(0, 8)}`,
    email: `${label}-${userId.slice(0, 8)}@example.com`,
    first_name: label,
    last_name: 'User',
    hashed_password: 'original-hash',
    user_type: userType,
    is_inactive: false,
  });
  return userId;
}

async function createFixture(opts: { licensedUserCount?: number | null } = {}): Promise<Fixture> {
  const tenant = uuidv4();
  tenantsToCleanup.add(tenant);
  await tenantRows().insert({
    tenant,
    client_name: `T026 ${tenant.slice(0, 8)}`,
    email: `t-${tenant.slice(0, 8)}@example.com`,
    licensed_user_count: opts.licensedUserCount ?? null,
  });
  const adminRoleId = uuidv4();
  await tt(tenant, 'roles').insert({ tenant, role_id: adminRoleId, role_name: 'Admin', msp: true, client: false });
  const adminId = await insertUser(tenant, 'internal', 'admin');
  await tt(tenant, 'user_roles').insert({ tenant, user_id: adminId, role_id: adminRoleId });
  const internalId = await insertUser(tenant, 'internal', 'staff');
  const clientId = await insertUser(tenant, 'client', 'portal');
  const { userId: serviceId } = await createServiceUser(db, tenant);
  const admin = {
    user_id: adminId,
    tenant,
    user_type: 'internal',
    username: 'admin',
    email: 'admin@example.com',
    roles: [{ role_id: adminRoleId, role_name: 'Admin' }],
  };
  mockCurrentUser = admin;
  return { tenant, admin, internalId, clientId, serviceId, adminRoleId };
}

const serviceRow = (f: Fixture) => tt(f.tenant, 'users').where({ user_id: f.serviceId }).first();

describe('Service principals A/4 user management (T026, T013, F085, F086)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDb = db;
    // BaseService resolves its connection through a relative import that vi.mock cannot reach.
    const { BaseService } = await import('@alga-psa/db');
    vi.spyOn(BaseService.prototype as any, 'getKnex').mockImplementation(async () => ({
      knex: testDb,
      tenant: mockCurrentUser.tenant,
    }));
  });
  afterEach(async () => {
    mockCurrentUser = null;
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });
  afterAll(async () => {
    if (db) await db.destroy();
  });

  describe('T026: list defaults exclude non-interactive users', () => {
    it('User.getAll excludes service by default and includes with includeNonInteractive', async () => {
      const f = await createFixture();
      const User = (await import('@alga-psa/db/models/user')).default;
      const { runWithTenant } = await import('@alga-psa/db');
      await runWithTenant(f.tenant, async () => {
        const byDefault = await User.getAll(db, true);
        expect(byDefault.map((u) => u.user_id)).not.toContain(f.serviceId);
        expect(byDefault.map((u) => u.user_id)).toEqual(expect.arrayContaining([f.internalId, f.clientId]));
        const all = await User.getAll(db, true, { includeNonInteractive: true });
        expect(all.map((u) => u.user_id)).toContain(f.serviceId);
      });
    });

    it('getAllUsers / getAllUsersBasic exclude service by default, include with the option; an explicit service filter needs it', async () => {
      const f = await createFixture();
      const { getAllUsers, getAllUsersBasic } = await import('@alga-psa/user-composition/actions/userQueryActions');

      for (const fn of [getAllUsers, getAllUsersBasic] as any[]) {
        const byDefault = await fn(true);
        expect(byDefault.map((u: any) => u.user_id)).not.toContain(f.serviceId);
        expect(byDefault.map((u: any) => u.user_id)).toEqual(expect.arrayContaining([f.internalId, f.clientId]));

        const explicitServiceNoOptIn = await fn(true, 'service');
        expect(explicitServiceNoOptIn).toEqual([]);

        const optedIn = await fn(true, undefined, true);
        expect(optedIn.map((u: any) => u.user_id)).toContain(f.serviceId);

        const optedInService = await fn(true, 'service', true);
        expect(optedInService.map((u: any) => u.user_id)).toEqual([f.serviceId]);

        const internalOnly = await fn(true, 'internal');
        expect(internalOnly.every((u: any) => u.user_type === 'internal')).toBe(true);
      }
    });

    it('Settings -> Users MSP tab data (getAllUsers + isLicensedUserType filter) excludes service users', async () => {
      const f = await createFixture();
      const { getAllUsers } = await import('@alga-psa/user-composition/actions/userQueryActions');
      const { isLicensedUserType } = await import('@alga-psa/types');
      const fetched: any[] = await getAllUsers(true);
      const mspTab = fetched.filter((u) => isLicensedUserType(u.user_type) || !u.user_type);
      expect(mspTab.map((u) => u.user_id)).toEqual(expect.arrayContaining([f.admin.user_id, f.internalId]));
      expect(mspTab.map((u) => u.user_id)).not.toContain(f.serviceId);
    });

    it('user detail loaders reject a service id and still return interactive users (F082)', async () => {
      const f = await createFixture();
      const { findUserById, getUserWithRoles, getMultipleUsersWithRoles } = await import(
        '@alga-psa/user-composition/actions/userQueryActions'
      );
      expect(await findUserById(f.serviceId)).toBeNull();
      expect(await getUserWithRoles(f.serviceId)).toBeNull();
      expect((await findUserById(f.internalId))?.user_id).toBe(f.internalId);
      expect((await getUserWithRoles(f.clientId))?.user_id).toBe(f.clientId);
      const multi = await getMultipleUsersWithRoles([f.serviceId, f.internalId]);
      expect(multi.map((u: any) => u.user_id)).toEqual([f.internalId]);
    });

    it('REST UserService list / search / stats exclude service by default and include with includeNonInteractive', async () => {
      const f = await createFixture();
      const { UserService } = await import('@alga-psa/users/services/UserService');
      const service = new UserService();
      const context: any = { tenant: f.tenant, userId: f.admin.user_id, user: f.admin };

      const listDefault = await service.list({ page: 1, limit: 100, filters: {} } as any, context);
      expect(listDefault.data.map((u: any) => u.user_id)).not.toContain(f.serviceId);
      expect(listDefault.total).toBe(3);
      const listOptIn = await service.list({ page: 1, limit: 100, filters: {}, includeNonInteractive: true } as any, context);
      expect(listOptIn.data.map((u: any) => u.user_id)).toContain(f.serviceId);
      expect(listOptIn.total).toBe(4);

      // explicit service filter is only honoured with the opt-in
      const svcFilterNoOptIn = await service.list({ page: 1, limit: 100, filters: { user_type: 'service' } } as any, context);
      expect(svcFilterNoOptIn.data).toEqual([]);
      const svcFilterOptIn = await service.list(
        { page: 1, limit: 100, filters: { user_type: 'service' }, includeNonInteractive: true } as any,
        context
      );
      expect(svcFilterOptIn.data.map((u: any) => u.user_id)).toEqual([f.serviceId]);

      const searchDefault = await service.searchUsers({ query: 'Service', include_inactive: true, limit: 50 } as any, context);
      expect(searchDefault.map((u: any) => u.user_id)).not.toContain(f.serviceId);
      const searchOptIn = await service.searchUsers(
        { query: 'Service', include_inactive: true, limit: 50 } as any,
        context,
        { includeNonInteractive: true }
      );
      expect(searchOptIn.map((u: any) => u.user_id)).toContain(f.serviceId);

      const stats = await service.getUserStats(context);
      expect(stats.total_users).toBe(3);
      expect(stats.users_by_type.service).toBeUndefined();
      const statsOptIn = await service.getUserStats(context, { includeNonInteractive: true });
      expect(statsOptIn.total_users).toBe(4);
      expect(statsOptIn.users_by_type.service).toBe(1);

      // getById does not expose a service user
      expect(await service.getById(f.serviceId, context)).toBeNull();
    });
  });

  describe('T013 (user-management half): actions refuse a service target; DB unchanged', () => {
    it('adminChangeUserPassword refuses a service target', async () => {
      const f = await createFixture();
      const before = await serviceRow(f);
      const { adminChangeUserPassword } = await import('@alga-psa/users/actions/user-actions/userActions');
      const result = await adminChangeUserPassword(f.serviceId, 'Sup3r-secret-password!');
      expect(result.success).toBe(false);
      expect((await serviceRow(f)).hashed_password).toBe(before.hashed_password);
    });

    it('deleteUser refuses a service target and the row remains', async () => {
      const f = await createFixture();
      const { deleteUser } = await import('@alga-psa/users/actions/user-actions/userActions');
      const result: any = await deleteUser(f.serviceId);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_FOUND');
      expect(await serviceRow(f)).toBeTruthy();
    });

    it('reactivate (updateUser is_inactive=false) refuses an inactive service target', async () => {
      const f = await createFixture();
      await tt(f.tenant, 'users').where({ user_id: f.serviceId }).update({ is_inactive: true });
      const { updateUser } = await import('@alga-psa/users/actions/user-actions/userActions');
      const result: any = await updateUser(f.serviceId, { is_inactive: false } as any);
      expect(result.success).toBe(false);
      expect((await serviceRow(f)).is_inactive).toBe(true);
    });

    it('updateUser cannot change user_type of any user (silently dropped) and refuses a service target', async () => {
      const f = await createFixture();
      const { updateUser } = await import('@alga-psa/users/actions/user-actions/userActions');
      await updateUser(f.internalId, { user_type: 'service', first_name: 'Kept' } as any);
      const row = await tt(f.tenant, 'users').where({ user_id: f.internalId }).first();
      expect(row.user_type).toBe('internal');
      const result: any = await updateUser(f.serviceId, { first_name: 'Renamed' } as any);
      expect(result.success).toBe(false);
      expect((await serviceRow(f)).first_name).toBe('Service');
    });

    it('deactivateUserWithDisposition and updateUserRoles refuse a service target', async () => {
      const f = await createFixture();
      const { deactivateUserWithDisposition, updateUserRoles } = await import(
        '@alga-psa/users/actions/user-actions/userActions'
      );
      const deactivated: any = await deactivateUserWithDisposition(f.serviceId, {
        tickets: { action: 'unassign' },
        projectTasks: { action: 'unassign' },
      } as any);
      expect(deactivated?.success).toBe(false);
      expect((await serviceRow(f)).is_inactive).toBe(false);

      const roles: any = await updateUserRoles(f.serviceId, [f.adminRoleId]);
      expect(roles?.success).toBe(false);
      expect(await tt(f.tenant, 'user_roles').where({ user_id: f.serviceId }).count('* as c').first()).toMatchObject({ c: '0' });
    });

    it('REST UserService.changePassword refuses a service target (F042)', async () => {
      const f = await createFixture();
      const before = await serviceRow(f);
      const { UserService } = await import('@alga-psa/users/services/UserService');
      const service = new UserService();
      const context: any = { tenant: f.tenant, userId: f.admin.user_id, user: f.admin };
      await expect(
        service.changePassword({ user_id: f.serviceId, new_password: 'Sup3r-secret-password!' } as any, context)
      ).rejects.toMatchObject({ statusCode: 404 });
      expect((await serviceRow(f)).hashed_password).toBe(before.hashed_password);
    });

    it('REST UserService.delete / update refuse a service target', async () => {
      const f = await createFixture();
      const { UserService } = await import('@alga-psa/users/services/UserService');
      const service = new UserService();
      const context: any = { tenant: f.tenant, userId: f.admin.user_id, user: f.admin };
      await expect(service.delete(f.serviceId, context)).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.update(f.serviceId, { first_name: 'X' } as any, context)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
      const row = await serviceRow(f);
      expect(row).toBeTruthy();
      expect(row.first_name).toBe('Service');
    });
  });

  describe('F085: REST user_type immutability', () => {
    it('rejects any change to or from service; allows internal<->client and a same-value no-op', async () => {
      const f = await createFixture();
      const { UserService } = await import('@alga-psa/users/services/UserService');
      const service = new UserService();
      const context: any = { tenant: f.tenant, userId: f.admin.user_id, user: f.admin };

      await expect(service.update(f.internalId, { user_type: 'service' } as any, context)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect((await tt(f.tenant, 'users').where({ user_id: f.internalId }).first()).user_type).toBe('internal');

      await expect(service.update(f.serviceId, { user_type: 'internal' } as any, context)).rejects.toThrow();
      expect((await serviceRow(f)).user_type).toBe('service');

      const noop: any = await service.update(f.internalId, { user_type: 'internal', first_name: 'Same' } as any, context);
      expect(noop.first_name).toBe('Same');

      const changed: any = await service.update(f.clientId, { user_type: 'internal' } as any, context);
      expect(changed.user_type).toBe('internal');
    });
  });

  describe('F086: REST UserService.create', () => {
    const base = (suffix: string, userType?: string) => ({
      username: `new-${suffix}-${uuidv4().slice(0, 6)}`,
      email: `new-${suffix}-${uuidv4().slice(0, 6)}@example.com`,
      password: 'Sup3r-secret-password!',
      ...(userType ? { user_type: userType } : {}),
    });

    it('rejects service (and any non internal|client) type and creates nothing', async () => {
      const f = await createFixture();
      const { UserService } = await import('@alga-psa/users/services/UserService');
      const service = new UserService();
      const context: any = { tenant: f.tenant, userId: f.admin.user_id, user: f.admin };
      const count = async () => Number((await tt(f.tenant, 'users').count('* as c').first())?.c);
      const before = await count();
      for (const t of ['service', 'bogus']) {
        await expect(service.create(base('bad', t) as any, context)).rejects.toMatchObject({ statusCode: 400 });
      }
      expect(await count()).toBe(before);
    });

    it('rejects an internal user at the seat limit with a 4xx LICENSE_LIMIT_REACHED, allows client', async () => {
      // admin + staff are active internal users => limit 2 is full (service user is not a seat)
      const f = await createFixture({ licensedUserCount: 2 });
      const { UserService } = await import('@alga-psa/users/services/UserService');
      const service = new UserService();
      const context: any = { tenant: f.tenant, userId: f.admin.user_id, user: f.admin };
      const count = async () => Number((await tt(f.tenant, 'users').count('* as c').first())?.c);
      const before = await count();

      await expect(service.create(base('internal', 'internal') as any, context)).rejects.toMatchObject({
        statusCode: 403,
        code: 'LICENSE_LIMIT_REACHED',
      });
      await expect(service.create(base('default') as any, context)).rejects.toMatchObject({
        code: 'LICENSE_LIMIT_REACHED',
      });
      expect(await count()).toBe(before);

      const client: any = await service.create(base('client', 'client') as any, context);
      expect(client.user_type).toBe('client');
      expect(await count()).toBe(before + 1);
    });

    it('creates an internal user when seats remain', async () => {
      const f = await createFixture({ licensedUserCount: 3 });
      const { UserService } = await import('@alga-psa/users/services/UserService');
      const service = new UserService();
      const context: any = { tenant: f.tenant, userId: f.admin.user_id, user: f.admin };
      const created: any = await service.create(base('ok', 'internal') as any, context);
      expect(created.user_type).toBe('internal');
    });
  });
});
