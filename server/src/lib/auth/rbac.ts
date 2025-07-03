import { IUser, IRole, IPermission, IRoleWithPermissions } from 'server/src/interfaces/auth.interfaces';
import User from 'server/src/lib/models/user';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

export class Role implements IRole {
  role_id: string;
  role_name: string;
  description: string;
  msp: boolean;
  client: boolean;

  constructor(role_id: string, role_name: string, description: string, msp: boolean = true, client: boolean = false) {
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
  description: string;
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

export async function hasPermission(user: IUser, resource: string, action: string, knexConnection?: Knex | Knex.Transaction): Promise<boolean> {
  let rolesWithPermissions: IRoleWithPermissions[];
  
  if (knexConnection) {
    // Use provided connection (transaction or regular knex instance)
    rolesWithPermissions = await User.getUserRolesWithPermissions(knexConnection, user.user_id);
  } else {
    // Create new connection if none provided
    const { knex } = await createTenantKnex();
    rolesWithPermissions = await User.getUserRolesWithPermissions(knex, user.user_id);
  }
  
  for (const role of rolesWithPermissions) {
    for (const permission of role.permissions) {
      if (permission.resource === resource && permission.action === action) {
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


// Check multiple permissions for a user in a single operation

export async function checkMultiplePermissions(
  user: IUser,
  permissionChecks: PermissionCheck[],
  knexConnection?: Knex | Knex.Transaction
): Promise<PermissionResult[]> {
  let rolesWithPermissions: IRoleWithPermissions[];
  
  if (knexConnection) {
    // Use provided connection (transaction or regular knex instance)
    rolesWithPermissions = await User.getUserRolesWithPermissions(knexConnection, user.user_id);
  } else {
    // Create new connection if none provided
    const { knex } = await createTenantKnex();
    rolesWithPermissions = await User.getUserRolesWithPermissions(knex, user.user_id);
  }
  
  const userPermissions = new Set<string>();
  
  for (const role of rolesWithPermissions) {
    for (const permission of role.permissions) {
      userPermissions.add(`${permission.resource}:${permission.action}`);
    }
  }
  
  return permissionChecks.map(check => ({
    resource: check.resource,
    action: check.action,
    granted: userPermissions.has(`${check.resource}:${check.action}`)
  }));
}
