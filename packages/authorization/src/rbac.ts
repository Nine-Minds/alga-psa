import type { IUser, IRole, IPermission, IRoleWithPermissions } from '@alga-psa/types';
import User from '@alga-psa/db/models/user';
import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import type { Knex } from 'knex';

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
  client: 'client',
  timeentry: 'time_entry',
  time_entry: 'time_entry',
  timesheet: 'time_sheet',
  time_sheet: 'time_sheet',
};

function canonicalizeResource(resource: string): string {
  return RESOURCE_CANONICAL_MAP[resource] ?? resource;
}

export async function hasPermission(
  user: Pick<IUser, 'user_id' | 'user_type'> & { tenant?: string },
  resource: string,
  action: string,
  knexConnection?: Knex | Knex.Transaction
): Promise<boolean> {
  const normalizedResource = canonicalizeResource(resource);
  let rolesWithPermissions: IRoleWithPermissions[];

  if (knexConnection) {
    rolesWithPermissions = user.tenant
      ? await runWithTenant(user.tenant, () => User.getUserRolesWithPermissions(knexConnection, user.user_id))
      : await User.getUserRolesWithPermissions(knexConnection, user.user_id);
  } else {
    const { knex } = await createTenantKnex();
    rolesWithPermissions = user.tenant
      ? await runWithTenant(user.tenant, () => User.getUserRolesWithPermissions(knex, user.user_id))
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
