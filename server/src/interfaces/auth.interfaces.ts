import { UserAttributeKey, TicketAttributeKey } from '@shared/types/attributes';
import { TenantEntity } from './index';
import type {
  IUser as SharedIUser,
  IRole as SharedIRole,
  IPermission as SharedIPermission,
  IUserWithRoles as SharedIUserWithRoles,
  IUserRole as SharedIUserRole,
} from '@shared/interfaces/user.interfaces';

// Consolidated type re-exports from shared with server-specific strictness where needed

// Base user with stricter DB requirement for hashed_password
export type IUser = SharedIUser & { hashed_password: string };

// Role with stricter DB requirement for description
export type IRole = SharedIRole & { description: string };

export type IPermission = SharedIPermission;

export interface IUserWithRoles extends IUser {
  roles: IRole[];
  avatarUrl?: string | null;
}

export interface ITeam extends TenantEntity {
  team_id: string;
  team_name: string;
  manager_id: string | null;
  created_at?: Date;
  updated_at?: Date;
  members: IUserWithRoles[];
}

export interface IRoleWithPermissions extends IRole {
  permissions: IPermission[];
}

export interface IResource extends TenantEntity {
  type: string;
  id: string;
  attributes: Map<string, any>;
}

export interface IPolicy extends TenantEntity {
  policy_id: string;
  policy_name: string;
  resource: string;
  action: string;
  conditions: ICondition[];
}

export interface ICondition extends TenantEntity {
  userAttribute: UserAttributeKey;
  operator: string;
  resourceAttribute: TicketAttributeKey;
}

export type IUserRole = Omit<SharedIUserRole, 'tenant'> & TenantEntity;

export interface IUserRegister {
  username: string;
  email: string;
  password: string;
  companyName: string;
  user_type: string;
}

export interface IUserAuthenticated {
  isValid: boolean;
  user: IUser | null;
}

export interface TPasswordCriteria {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
}
