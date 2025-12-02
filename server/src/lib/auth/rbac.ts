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

const RESOURCE_CANONICAL_MAP: Record<string, string> = {
  client: 'client'
};

function canonicalizeResource(resource: string): string {
  return RESOURCE_CANONICAL_MAP[resource] ?? resource;
}

// Overloaded signatures for hasPermission
export async function hasPermission(userId: string, tenantId: string, resourceAction: string): Promise<boolean>;
export async function hasPermission(user: IUser, resource: string, action: string, knexConnection?: Knex | Knex.Transaction): Promise<boolean>;
export async function hasPermission(userOrId: IUser | string, resourceOrTenant: string, actionOrResourceAction: string, knexConnection?: Knex | Knex.Transaction): Promise<boolean> {
  // Handle new signature: hasPermission(userId, tenantId, 'resource.action')
  if (typeof userOrId === 'string') {
    const userId = userOrId;
    const tenantId = resourceOrTenant;
    const resourceAction = actionOrResourceAction;

    // Parse resource.action format
    const parts = resourceAction.split('.');
    if (parts.length !== 2) {
      throw new Error(`Invalid resource.action format: ${resourceAction}. Expected format: 'resource.action'`);
    }
    const [resource, action] = parts;

    // Get user by ID and call original function
    const { knex } = await createTenantKnex();
    const user = await knex('users').where({ user_id: userId, tenant: tenantId }).first();
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    return hasPermission(user as IUser, resource, action, knex);
  }

  // Handle original signature: hasPermission(user, resource, action, knexConnection?)
  const user = userOrId as IUser;
  const resource = resourceOrTenant;
  const action = actionOrResourceAction;
  const normalizedResource = canonicalizeResource(resource);
  let rolesWithPermissions: IRoleWithPermissions[];
  
  if (knexConnection) {
    // Use provided connection (transaction or regular knex instance)
    rolesWithPermissions = await User.getUserRolesWithPermissions(knexConnection, user.user_id);
  } else {
    // Create new connection if none provided
    const { knex } = await createTenantKnex();
    rolesWithPermissions = await User.getUserRolesWithPermissions(knex, user.user_id);
  }
  
  // Determine portal type based on user type
  const isClientPortal = user.user_type === 'client';
  
  for (const role of rolesWithPermissions) {
    // Filter roles based on portal type
    if (isClientPortal && !role.client) continue;
    if (!isClientPortal && !role.msp) continue;
    
    for (const permission of role.permissions) {
      // Filter permissions based on portal type
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
  
  // Determine portal type based on user type
  const isClientPortal = user.user_type === 'client';
  
  const userPermissions = new Set<string>();
  
  for (const role of rolesWithPermissions) {
    // Filter roles based on portal type
    if (isClientPortal && !role.client) continue;
    if (!isClientPortal && !role.msp) continue;
    
    for (const permission of role.permissions) {
      // Filter permissions based on portal type
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
