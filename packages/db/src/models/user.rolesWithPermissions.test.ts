import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

const requireTenantIdMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/tenantId', () => ({
  requireTenantId: requireTenantIdMock,
}));

import User, { groupRolePermissionRows } from './user';

const sqlKnex = knexFactory({ client: 'pg' });

afterAll(async () => {
  await sqlKnex.destroy();
});

type Executed = { sql: string; bindings: readonly unknown[] };

// Real pg query builders so the tenant helpers compile to SQL, with execution
// replaced by a fixture so the test can see exactly what would run.
function createKnexMock(rows: unknown[]) {
  const executed: Executed[] = [];
  const knexMock = Object.assign(
    vi.fn((table: string) => {
      const builder = sqlKnex(table);
      (builder as any).then = (onFulfilled: any, onRejected: any) => {
        const { sql, bindings } = builder.toSQL();
        executed.push({ sql, bindings });
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      };
      return builder;
    }),
    { raw: sqlKnex.raw.bind(sqlKnex), fn: sqlKnex.fn }
  ) as any;
  return { knexMock, executed };
}

const adminRow = {
  role_id: 'role-admin',
  role_name: 'Admin',
  description: 'Full access',
  tenant: 'tenant-1',
  msp: true,
  client: false,
};

const techRow = {
  role_id: 'role-tech',
  role_name: 'Technician',
  description: null,
  tenant: 'tenant-1',
  msp: true,
  client: false,
};

const noPermission = {
  permission_id: null,
  resource: null,
  action: null,
  permission_tenant: null,
  permission_msp: null,
  permission_client: null,
};

describe('User.getUserRolesWithPermissions', () => {
  beforeEach(() => {
    requireTenantIdMock.mockReset();
    requireTenantIdMock.mockResolvedValue('tenant-1');
  });

  it('resolves every role and permission in one tenant-scoped query', async () => {
    const { knexMock, executed } = createKnexMock([]);

    await User.getUserRolesWithPermissions(knexMock, 'user-1');

    expect(executed).toHaveLength(1);
    const [{ sql, bindings }] = executed;
    expect(sql).toMatch(/^select .* from "roles"/i);
    expect(sql).toMatch(/inner join "user_roles" on "roles"\."role_id" = "user_roles"\."role_id" and "user_roles"\."tenant" = "roles"\."tenant"/i);
    expect(sql).toMatch(/left join "role_permissions" on "roles"\."role_id" = "role_permissions"\."role_id" and "role_permissions"\."tenant" = "roles"\."tenant"/i);
    expect(sql).toMatch(/left join "permissions" on "role_permissions"\."permission_id" = "permissions"\."permission_id" and "permissions"\."tenant" = "role_permissions"\."tenant"/i);
    expect(sql).toMatch(/where "roles"\."tenant" = \? and "user_roles"\."user_id" = \?/i);
    expect(bindings).toEqual(['tenant-1', 'user-1']);
  });

  it('groups joined rows by role and keeps permission-less roles', async () => {
    const { knexMock } = createKnexMock([
      { ...adminRow, permission_id: 'p1', resource: 'ticket', action: 'read', permission_tenant: 'tenant-1', permission_msp: true, permission_client: false },
      { ...adminRow, permission_id: 'p2', resource: 'ticket', action: 'update', permission_tenant: 'tenant-1', permission_msp: true, permission_client: true },
      { ...techRow, ...noPermission },
    ]);

    const roles = await User.getUserRolesWithPermissions(knexMock, 'user-1');

    expect(roles).toEqual([
      {
        role_id: 'role-admin',
        role_name: 'Admin',
        description: 'Full access',
        tenant: 'tenant-1',
        msp: true,
        client: false,
        permissions: [
          { permission_id: 'p1', resource: 'ticket', action: 'read', tenant: 'tenant-1', msp: true, client: false },
          { permission_id: 'p2', resource: 'ticket', action: 'update', tenant: 'tenant-1', msp: true, client: true },
        ],
      },
      {
        role_id: 'role-tech',
        role_name: 'Technician',
        description: undefined,
        tenant: 'tenant-1',
        msp: true,
        client: false,
        permissions: [],
      },
    ]);
  });

  it('returns no roles for an unassigned user', () => {
    expect(groupRolePermissionRows([])).toEqual([]);
  });
});
