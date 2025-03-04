import { IUser, IRole, IPermission, IRoleWithPermissions } from 'server/src/interfaces/auth.interfaces';
import { getUserRolesWithPermissions } from 'server/src/lib/actions/user-actions/userActions';

export class Role implements IRole {
  role_id: string;
  role_name: string;
  description: string;

  constructor(role_id: string, role_name: string, description: string) {
    this.role_id = role_id;
    this.role_name = role_name;
    this.description = description;
  }
}

export class RoleWithPermissions implements IRoleWithPermissions {
  role_id: string;
  role_name: string;
  description: string;
  permissions: IPermission[];

  constructor(role: IRole, permissions: IPermission[]) {
    this.role_id = role.role_id;
    this.role_name = role.role_name;
    this.description = role.description;
    this.permissions = permissions;
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

  constructor(permission_id: string, resource: string, action: string) {
    this.permission_id = permission_id;
    this.resource = resource;
    this.action = action;
  }
}

export async function hasPermission(user: IUser, resource: string, action: string): Promise<boolean> {
  const rolesWithPermissions = await getUserRolesWithPermissions(user.user_id);
  for (const role of rolesWithPermissions) {
    for (const permission of role.permissions) {
      if (permission.resource === resource && permission.action === action) {
        return true;
      }
    }
  }
  return false;
}
