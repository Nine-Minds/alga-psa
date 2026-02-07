import { IUser, IRole, IPermission, IRoleWithPermissions } from 'server/src/interfaces/auth.interfaces';
import User from '@alga-psa/db/models/user';
import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { Knex } from 'knex';

export class Role implements IRole {
  role_id: string;
  role_name: string;
  description?: string;
  msp: boolean;
  client: boolean;

  constructor(role_id: string, role_name: string, description: string = '', msp: boolean = true, client: boolean = false) {
    this.role_id = role_id;
    this.role_name = role_name;
    this.description = description;
    this.msp = msp;
    this.client = client;
  }
}

export class RoleWithPermissions implements IRoleWithPermissions {
  role_id: string;
  role_name: string;
  description?: string;
  permissions: IPermission[];
  msp: boolean;
  client: boolean;

  constructor(role: IRole, permissions: IPermission[]) {
    this.role_id = role.role_id;
    this.role_name = role.role_name;
    this.description = role.description;
    this.permissions = permissions;
    this.msp = role.msp;
    this.client = role.client;
  }

  addPermission(permission: IPermission) {
    this.permissions.push(permission);
  }

  removePermission(permission: IPermission) {
    this.permissions = this.permissions.filter(p => p.permission_id !== permission.permission_id);
  }
}

export class Permission implements IPermission {
  permission_id: string;
  resource: string;
  action: string;
  msp: boolean;
  client: boolean;

  constructor(permission_id: string, resource: string, action: string, msp: boolean = true, client: boolean = false) {
    this.permission_id = permission_id;
    this.resource = resource;
    this.action = action;
    this.msp = msp;
    this.client = client;
  }
}

const RESOURCE_CANONICAL_MAP: Record<string, string> = {
  client: 'client'
};

function canonicalizeResource(resource: string): string {
  return RESOURCE_CANONICAL_MAP[resource] ?? resource;
}

export async function hasPermission(
  user: Pick<IUser, 'user_id' | 'user_type'>,
  resource: string,
  action: string,
  knexConnection?: Knex | Knex.Transaction
): Promise<boolean> {
  const normalizedResource = canonicalizeResource(resource);
  const userTenant = (user as IUser & { tenant?: string }).tenant;
  let rolesWithPermissions: IRoleWithPermissions[];

  if (knexConnection) {
    // Use provided connection (transaction or regular knex instance)
    rolesWithPermissions = userTenant
      ? await runWithTenant(userTenant, () => User.getUserRolesWithPermissions(knexConnection, user.user_id))
      : await User.getUserRolesWithPermissions(knexConnection, user.user_id);
  } else {
    const { knex } = await createTenantKnex();
    rolesWithPermissions = userTenant
      ? await runWithTenant(userTenant, () => User.getUserRolesWithPermissions(knex, user.user_id))
      : await User.getUserRolesWithPermissions(knex, user.user_id);
  }

  const isClientPortal = user.user_type === 'client';

  for (const role of rolesWithPermissions) {
    if (isClientPortal && !role.client) continue;
    if (!isClientPortal && !role.msp) continue;

    for (const permission of role.permissions) {
      if (isClientPortal && !permission.client) continue;
      if (!isClientPortal && !permission.msp) continue;

      if (canonicalizeResource(permission.resource) === normalizedResource && permission.action === action) {
        return true;
      }
    }
  }
  return false;
}

export interface PermissionCheck {
  resource: string;
  action: string;
}

export interface PermissionResult {
  resource: string;
  action: string;
  granted: boolean;
}

export async function checkMultiplePermissions(
  user: Pick<IUser, 'user_id' | 'user_type'>,
  permissionChecks: PermissionCheck[],
  knexConnection?: Knex | Knex.Transaction
): Promise<PermissionResult[]> {
  const userTenant = (user as IUser & { tenant?: string }).tenant;
  let rolesWithPermissions: IRoleWithPermissions[];

  if (knexConnection) {
    // Use provided connection (transaction or regular knex instance)
    rolesWithPermissions = userTenant
      ? await runWithTenant(userTenant, () => User.getUserRolesWithPermissions(knexConnection, user.user_id))
      : await User.getUserRolesWithPermissions(knexConnection, user.user_id);
  } else {
    const { knex } = await createTenantKnex();
    rolesWithPermissions = userTenant
      ? await runWithTenant(userTenant, () => User.getUserRolesWithPermissions(knex, user.user_id))
      : await User.getUserRolesWithPermissions(knex, user.user_id);
  }

  const isClientPortal = user.user_type === 'client';

  const userPermissions = new Set<string>();

  for (const role of rolesWithPermissions) {
    if (isClientPortal && !role.client) continue;
    if (!isClientPortal && !role.msp) continue;

    for (const permission of role.permissions) {
      if (isClientPortal && !permission.client) continue;
      if (!isClientPortal && !permission.msp) continue;

      userPermissions.add(`${permission.resource}:${permission.action}`);
    }
  }

  return permissionChecks.map(check => ({
    resource: check.resource,
    action: check.action,
    granted: userPermissions.has(`${check.resource}:${check.action}`)
  }));
}
