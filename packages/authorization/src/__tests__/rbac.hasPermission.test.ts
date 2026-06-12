import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

/**
 * Unit tests for the real RBAC permission check (hasPermission). The database
 * layer is mocked: runWithTenant is replaced with a recorder that scopes an
 * in-memory role store by tenant, and User.getUserRolesWithPermissions reads
 * from that store. All filtering/canonicalization logic under test is real.
 */

const dbState = vi.hoisted(() => ({
  currentTenant: undefined as string | undefined,
  runWithTenantCalls: [] as string[],
  createTenantKnexCalls: 0,
}));

const getUserRolesWithPermissionsMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => {
    dbState.createTenantKnexCalls += 1;
    return { knex: { __fromCreateTenantKnex: true } };
  }),
  runWithTenant: vi.fn(async (tenant: string, fn: () => Promise<unknown>) => {
    dbState.runWithTenantCalls.push(tenant);
    const previous = dbState.currentTenant;
    dbState.currentTenant = tenant;
    try {
      return await fn();
    } finally {
      dbState.currentTenant = previous;
    }
  }),
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    getUserRolesWithPermissions: getUserRolesWithPermissionsMock,
  },
}));

import { hasPermission } from '../rbac';

interface FixtureRole {
  role_id: string;
  role_name: string;
  msp: boolean;
  client: boolean;
  permissions: Array<{
    permission_id: string;
    resource: string;
    action: string;
    msp: boolean;
    client: boolean;
  }>;
}

let roleStore: Record<string, FixtureRole[]> = {};
const stubKnex = { __stub: true } as unknown as Knex;

function role(
  roleOpts: { msp?: boolean; client?: boolean },
  permissions: Array<{ resource: string; action: string; msp?: boolean; client?: boolean }>
): FixtureRole {
  return {
    role_id: `role-${Math.random().toString(36).slice(2, 8)}`,
    role_name: 'fixture-role',
    msp: roleOpts.msp ?? true,
    client: roleOpts.client ?? false,
    permissions: permissions.map((permission, index) => ({
      permission_id: `perm-${index}`,
      resource: permission.resource,
      action: permission.action,
      msp: permission.msp ?? true,
      client: permission.client ?? false,
    })),
  };
}

beforeEach(() => {
  roleStore = {};
  dbState.currentTenant = undefined;
  dbState.runWithTenantCalls = [];
  dbState.createTenantKnexCalls = 0;
  getUserRolesWithPermissionsMock.mockReset();
  getUserRolesWithPermissionsMock.mockImplementation(async (_knex: Knex, userId: string) => {
    return roleStore[`${dbState.currentTenant}:${userId}`] ?? [];
  });
});

describe('hasPermission', () => {
  it('denies by default when the user has no roles', async () => {
    await expect(
      hasPermission(
        { user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' },
        'ticket',
        'read',
        stubKnex
      )
    ).resolves.toBe(false);
  });

  it('denies when roles exist but none grant the resource/action pair', async () => {
    roleStore['tenant-a:user-1'] = [role({ msp: true }, [{ resource: 'ticket', action: 'read' }])];

    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'ticket', 'delete', stubKnex)
    ).resolves.toBe(false);
    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'invoice', 'read', stubKnex)
    ).resolves.toBe(false);
  });

  it('allows an internal user through an MSP role with a matching MSP permission', async () => {
    roleStore['tenant-a:user-1'] = [role({ msp: true }, [{ resource: 'ticket', action: 'read' }])];

    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'ticket', 'read', stubKnex)
    ).resolves.toBe(true);
  });

  it('ignores MSP-only roles for client portal users', async () => {
    roleStore['tenant-a:user-1'] = [
      role({ msp: true, client: false }, [{ resource: 'ticket', action: 'read', client: true }]),
    ];

    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'client', tenant: 'tenant-a' }, 'ticket', 'read', stubKnex)
    ).resolves.toBe(false);
  });

  it('ignores client-only roles for internal users', async () => {
    roleStore['tenant-a:user-1'] = [
      role({ msp: false, client: true }, [{ resource: 'ticket', action: 'read', msp: true }]),
    ];

    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'ticket', 'read', stubKnex)
    ).resolves.toBe(false);
  });

  it('filters permissions by portal even when the role spans both portals', async () => {
    roleStore['tenant-a:user-1'] = [
      role({ msp: true, client: true }, [
        { resource: 'ticket', action: 'read', msp: false, client: true },
        { resource: 'invoice', action: 'read', msp: true, client: false },
      ]),
    ];

    // Internal user cannot use the client-only ticket permission...
    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'ticket', 'read', stubKnex)
    ).resolves.toBe(false);
    // ...but can use the msp invoice permission, and vice versa for clients.
    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'invoice', 'read', stubKnex)
    ).resolves.toBe(true);
    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'client', tenant: 'tenant-a' }, 'ticket', 'read', stubKnex)
    ).resolves.toBe(true);
    await expect(
      hasPermission({ user_id: 'user-1', user_type: 'client', tenant: 'tenant-a' }, 'invoice', 'read', stubKnex)
    ).resolves.toBe(false);
  });

  it('canonicalizes legacy resource spellings in both the check and the stored permission', async () => {
    roleStore['tenant-a:user-1'] = [
      role({ msp: true }, [
        { resource: 'timeentry', action: 'read' },
        { resource: 'time_sheet', action: 'submit' },
      ]),
    ];

    const subject = { user_id: 'user-1', user_type: 'internal' as const, tenant: 'tenant-a' };
    await expect(hasPermission(subject, 'time_entry', 'read', stubKnex)).resolves.toBe(true);
    await expect(hasPermission(subject, 'timeentry', 'read', stubKnex)).resolves.toBe(true);
    await expect(hasPermission(subject, 'timesheet', 'submit', stubKnex)).resolves.toBe(true);
    await expect(hasPermission(subject, 'time_sheet', 'submit', stubKnex)).resolves.toBe(true);
  });

  describe('tenant scoping', () => {
    it('resolves roles inside runWithTenant for the subject tenant', async () => {
      roleStore['tenant-a:user-1'] = [role({ msp: true }, [{ resource: 'ticket', action: 'read' }])];

      await hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'ticket', 'read', stubKnex);

      expect(dbState.runWithTenantCalls).toEqual(['tenant-a']);
    });

    it('never grants a tenant-A permission to the same user id evaluated under tenant B', async () => {
      roleStore['tenant-a:user-1'] = [role({ msp: true }, [{ resource: 'ticket', action: 'read' }])];

      await expect(
        hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-b' }, 'ticket', 'read', stubKnex)
      ).resolves.toBe(false);
      expect(dbState.runWithTenantCalls).toEqual(['tenant-b']);
    });

    it('skips tenant-context wrapping when the subject carries no tenant', async () => {
      await hasPermission({ user_id: 'user-1', user_type: 'internal' }, 'ticket', 'read', stubKnex);

      expect(dbState.runWithTenantCalls).toEqual([]);
      expect(getUserRolesWithPermissionsMock).toHaveBeenCalledWith(stubKnex, 'user-1');
    });
  });

  describe('connection handling', () => {
    it('uses the provided knex connection without creating a new one', async () => {
      await hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'ticket', 'read', stubKnex);

      expect(dbState.createTenantKnexCalls).toBe(0);
      expect(getUserRolesWithPermissionsMock).toHaveBeenCalledWith(stubKnex, 'user-1');
    });

    it('falls back to createTenantKnex when no connection is supplied', async () => {
      await hasPermission({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-a' }, 'ticket', 'read');

      expect(dbState.createTenantKnexCalls).toBe(1);
      expect(getUserRolesWithPermissionsMock).toHaveBeenCalledWith(
        expect.objectContaining({ __fromCreateTenantKnex: true }),
        'user-1'
      );
    });
  });
});
