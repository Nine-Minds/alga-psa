import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

/**
 * Table-driven policy matrix (role x resource x action) exercised through the
 * real CE authorization kernel (server/src/lib/authorization/kernel ->
 * createBuiltinAuthorizationKernel) and the real RBAC evaluation logic in
 * @alga-psa/authorization (hasPermission). Only the database model layer
 * (User.getUserRolesWithPermissions) is mocked; the mock resolves roles from a
 * tenant-keyed in-memory store using the real AsyncLocalStorage tenant context
 * set by runWithTenant, so tenant propagation is exercised end to end.
 */

const getUserRolesWithPermissionsMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: getUserRolesWithPermissionsMock,
  },
}));

import { getTenantContext } from '@alga-psa/db/tenant';
import { createBuiltinAuthorizationKernel } from 'server/src/lib/authorization/kernel';

interface FixturePermission {
  permission_id: string;
  resource: string;
  action: string;
  msp: boolean;
  client: boolean;
}

interface FixtureRole {
  role_id: string;
  role_name: string;
  msp: boolean;
  client: boolean;
  permissions: FixturePermission[];
}

let permissionSeq = 0;
function perm(resource: string, action: string, opts: { msp?: boolean; client?: boolean } = {}): FixturePermission {
  permissionSeq += 1;
  return {
    permission_id: `perm-${permissionSeq}`,
    resource,
    action,
    msp: opts.msp ?? true,
    client: opts.client ?? false,
  };
}

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

// Roles are registered per (tenant, user). A user therefore has NO roles in
// any tenant other than the one their grants were created in.
const roleStore: Record<string, FixtureRole[]> = {
  [`${TENANT_A}:alice`]: [
    {
      role_id: 'role-admin',
      role_name: 'Admin',
      msp: true,
      client: false,
      permissions: [
        perm('ticket', 'read'),
        perm('ticket', 'update'),
        perm('credit', 'reimburse'),
      ],
    },
  ],
  [`${TENANT_A}:bob`]: [
    {
      role_id: 'role-tech',
      role_name: 'Technician',
      msp: true,
      client: false,
      permissions: [perm('ticket', 'read')],
    },
  ],
  [`${TENANT_A}:carol`]: [
    {
      role_id: 'role-portal-user',
      role_name: 'Client Portal User',
      msp: false,
      client: true,
      permissions: [
        perm('ticket', 'read', { msp: false, client: true }),
        perm('invoice', 'read', { msp: false, client: true }),
      ],
    },
  ],
  // dave is a client-portal user who was (mis)assigned an MSP-only role.
  [`${TENANT_A}:dave`]: [
    {
      role_id: 'role-admin',
      role_name: 'Admin',
      msp: true,
      client: false,
      permissions: [perm('ticket', 'read'), perm('ticket', 'update')],
    },
  ],
  // erin is internal; her dual-portal role carries a client-only permission,
  // which must not be usable from the MSP portal.
  [`${TENANT_A}:erin`]: [
    {
      role_id: 'role-hybrid',
      role_name: 'Hybrid',
      msp: true,
      client: true,
      permissions: [perm('ticket', 'read', { msp: false, client: true })],
    },
  ],
  [`${TENANT_A}:frank`]: [],
  // tina's grants use legacy resource spellings to exercise canonicalization.
  [`${TENANT_A}:tina`]: [
    {
      role_id: 'role-time',
      role_name: 'Time Admin',
      msp: true,
      client: false,
      permissions: [perm('timeentry', 'read'), perm('time_sheet', 'submit')],
    },
  ],
};

function fakeKnex(): Knex {
  // The mocked model never touches the connection; a sentinel keeps any
  // accidental query attempt loud.
  return new Proxy(() => undefined, {
    apply() {
      throw new Error('Unexpected database access in policy matrix unit test');
    },
    get(_target, prop) {
      if (prop === 'then') return undefined;
      throw new Error(`Unexpected database access (knex.${String(prop)}) in policy matrix unit test`);
    },
  }) as unknown as Knex;
}

describe('authorization policy matrix (role x resource x action)', () => {
  const kernel = createBuiltinAuthorizationKernel();
  const tenantsSeenByModel: Array<string | undefined> = [];

  beforeEach(() => {
    tenantsSeenByModel.length = 0;
    getUserRolesWithPermissionsMock.mockReset();
    getUserRolesWithPermissionsMock.mockImplementation(async (_knex: Knex, userId: string) => {
      const tenant = getTenantContext();
      tenantsSeenByModel.push(tenant);
      return roleStore[`${tenant}:${userId}`] ?? [];
    });
  });

  function authorize(
    userId: string,
    userType: 'internal' | 'client',
    resource: string,
    action: string,
    tenant: string = TENANT_A
  ) {
    return kernel.authorizeResource({
      knex: fakeKnex(),
      subject: { tenant, userId, userType },
      resource: { type: resource, action },
    });
  }

  const matrix: Array<{
    label: string;
    userId: string;
    userType: 'internal' | 'client';
    resource: string;
    action: string;
    expected: boolean;
  }> = [
    { label: 'admin can read tickets', userId: 'alice', userType: 'internal', resource: 'ticket', action: 'read', expected: true },
    { label: 'admin can update tickets', userId: 'alice', userType: 'internal', resource: 'ticket', action: 'update', expected: true },
    { label: 'admin can reimburse credits', userId: 'alice', userType: 'internal', resource: 'credit', action: 'reimburse', expected: true },
    { label: 'admin is denied unlisted actions (deny by default)', userId: 'alice', userType: 'internal', resource: 'ticket', action: 'delete', expected: false },
    { label: 'admin is denied unlisted resources (deny by default)', userId: 'alice', userType: 'internal', resource: 'invoice', action: 'read', expected: false },
    { label: 'technician can read tickets', userId: 'bob', userType: 'internal', resource: 'ticket', action: 'read', expected: true },
    { label: 'technician cannot update tickets', userId: 'bob', userType: 'internal', resource: 'ticket', action: 'update', expected: false },
    { label: 'client portal user can read tickets via client permission', userId: 'carol', userType: 'client', resource: 'ticket', action: 'read', expected: true },
    { label: 'client portal user can read invoices via client permission', userId: 'carol', userType: 'client', resource: 'invoice', action: 'read', expected: true },
    { label: 'client portal user cannot update tickets', userId: 'carol', userType: 'client', resource: 'ticket', action: 'update', expected: false },
    { label: 'client user cannot use an MSP-only role', userId: 'dave', userType: 'client', resource: 'ticket', action: 'read', expected: false },
    { label: 'internal user cannot use a client-only permission', userId: 'erin', userType: 'internal', resource: 'ticket', action: 'read', expected: false },
    { label: 'user without roles is denied everything', userId: 'frank', userType: 'internal', resource: 'ticket', action: 'read', expected: false },
  ];

  it.each(matrix)('$label', async ({ userId, userType, resource, action, expected }) => {
    const decision = await authorize(userId, userType, resource, action);

    expect(decision.allowed).toBe(expected);
    if (expected) {
      expect(decision.reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ stage: 'rbac', code: 'rbac_allowed' })])
      );
    } else {
      expect(decision.scope.denied).toBe(true);
      expect(decision.scope.constraints).toEqual([]);
      expect(decision.reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ stage: 'rbac', code: 'rbac_denied' })])
      );
    }
  });

  const canonicalizationMatrix: Array<{ resource: string; action: string; expected: boolean }> = [
    { resource: 'time_entry', action: 'read', expected: true },
    { resource: 'timeentry', action: 'read', expected: true },
    { resource: 'time_sheet', action: 'submit', expected: true },
    { resource: 'timesheet', action: 'submit', expected: true },
    { resource: 'time_entry', action: 'delete', expected: false },
  ];

  it.each(canonicalizationMatrix)(
    'canonicalizes legacy resource spellings: $resource:$action -> $expected',
    async ({ resource, action, expected }) => {
      const decision = await authorize('tina', 'internal', resource, action);
      expect(decision.allowed).toBe(expected);
    }
  );

  describe('tenant isolation', () => {
    it('denies a user whose roles exist only in another tenant', async () => {
      // alice is an admin in tenant-a; the same user id evaluated under
      // tenant-b must never authorize.
      const decision = await authorize('alice', 'internal', 'ticket', 'read', TENANT_B);

      expect(decision.allowed).toBe(false);
      expect(decision.scope.denied).toBe(true);
      expect(decision.reasons).toEqual(
        expect.arrayContaining([expect.objectContaining({ stage: 'rbac', code: 'rbac_denied' })])
      );
    });

    it('resolves roles inside the tenant context of the subject, not a global one', async () => {
      await authorize('alice', 'internal', 'ticket', 'read', TENANT_B);
      expect(tenantsSeenByModel).toEqual([TENANT_B]);

      tenantsSeenByModel.length = 0;
      await authorize('alice', 'internal', 'ticket', 'read', TENANT_A);
      expect(tenantsSeenByModel).toEqual([TENANT_A]);
    });

    it('keeps decisions independent across tenants for the same user id', async () => {
      const [inTenantA, inTenantB] = [
        await authorize('alice', 'internal', 'ticket', 'read', TENANT_A),
        await authorize('alice', 'internal', 'ticket', 'read', TENANT_B),
      ];

      expect(inTenantA.allowed).toBe(true);
      expect(inTenantB.allowed).toBe(false);
    });
  });
});
