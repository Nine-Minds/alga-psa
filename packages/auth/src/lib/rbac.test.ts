import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server/src/lib/models/user', () => ({
  default: {
    getUserRolesWithPermissions: vi.fn()
  }
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} }))
}));

import { hasPermission, checkMultiplePermissions } from './rbac';
import type { IUser, IRoleWithPermissions, IPermission } from 'server/src/interfaces/auth.interfaces';

const buildPermission = (resource: string, action: string, msp: boolean, client: boolean): IPermission => ({
  permission_id: `${resource}:${action}:${msp ? 'msp' : 'client'}`,
  resource,
  action,
  msp,
  client
});

const buildRole = (permissions: IPermission[], msp: boolean, client: boolean): IRoleWithPermissions => ({
  role_id: `${msp ? 'msp' : 'client'}-role`,
  role_name: 'role',
  description: 'role',
  permissions,
  msp,
  client
});

describe('rbac permission checks', () => {
  beforeEach(async () => {
    const { default: User } = await import('server/src/lib/models/user');
    vi.mocked(User.getUserRolesWithPermissions).mockReset();
  });

  it('allows internal users to use MSP permissions only', async () => {
    const { default: User } = await import('server/src/lib/models/user');
    const mspPermissions = [
      buildPermission('client', 'read', true, false),
      buildPermission('client', 'write', true, false)
    ];
    const clientPermissions = [
      buildPermission('client', 'read', false, true),
      buildPermission('client', 'write', false, true)
    ];

    vi.mocked(User.getUserRolesWithPermissions).mockResolvedValue([
      buildRole(mspPermissions, true, false),
      buildRole(clientPermissions, false, true)
    ]);

    const user: IUser = {
      user_id: 'u1',
      username: 'u1',
      email: 'u1@example.com',
      hashed_password: 'hash',
      is_inactive: false,
      tenant: 'tenant-1',
      user_type: 'internal',
      created_at: new Date()
    };

    await expect(hasPermission(user, 'client', 'read')).resolves.toBe(true);
    await expect(hasPermission(user, 'client', 'write')).resolves.toBe(true);
  });

  it('allows client users to use client permissions only', async () => {
    const { default: User } = await import('server/src/lib/models/user');
    const mspPermissions = [
      buildPermission('client', 'read', true, false)
    ];
    const clientPermissions = [
      buildPermission('client', 'read', false, true),
      buildPermission('client', 'write', false, true)
    ];

    vi.mocked(User.getUserRolesWithPermissions).mockResolvedValue([
      buildRole(mspPermissions, true, false),
      buildRole(clientPermissions, false, true)
    ]);

    const user: IUser = {
      user_id: 'u2',
      username: 'u2',
      email: 'u2@example.com',
      hashed_password: 'hash',
      is_inactive: false,
      tenant: 'tenant-1',
      user_type: 'client',
      created_at: new Date()
    };

    await expect(hasPermission(user, 'client', 'read')).resolves.toBe(true);
    await expect(hasPermission(user, 'client', 'write')).resolves.toBe(true);
  });

  it('returns aggregated permission results', async () => {
    const { default: User } = await import('server/src/lib/models/user');
    const permissions = [
      buildPermission('client', 'read', true, false),
      buildPermission('projects', 'write', true, false)
    ];

    vi.mocked(User.getUserRolesWithPermissions).mockResolvedValue([
      buildRole(permissions, true, false)
    ]);

    const user: IUser = {
      user_id: 'u3',
      username: 'u3',
      email: 'u3@example.com',
      hashed_password: 'hash',
      is_inactive: false,
      tenant: 'tenant-1',
      user_type: 'internal',
      created_at: new Date()
    };

    const results = await checkMultiplePermissions(user, [
      { resource: 'client', action: 'read' },
      { resource: 'projects', action: 'write' },
      { resource: 'projects', action: 'read' }
    ]);

    expect(results).toEqual([
      { resource: 'client', action: 'read', granted: true },
      { resource: 'projects', action: 'write', granted: true },
      { resource: 'projects', action: 'read', granted: false }
    ]);
  });
});
