import type { UserAttributeKey, TicketAttributeKey } from '../lib/attributes';
import type { TenantEntity } from './index';
import type {
  IUser as BaseIUser,
  IRole as BaseIRole,
  IPermission as BaseIPermission,
  IUserRole as BaseIUserRole,
} from './user.interfaces';

// Consolidated auth-related interfaces.
//
// NOTE: These types are used across UI and server code. Avoid adding DB-only
// strictness here (e.g. requiring `hashed_password`) since many call sites use
// "basic user" shapes without sensitive fields. If you need DB-only guarantees,
// introduce a separate type alias in the specific package that needs it.

export type IUser = BaseIUser;

export type IRole = BaseIRole;

export type IPermission = BaseIPermission;

export interface IUserWithRoles extends IUser {
  user_id: string;
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

export type IUserRole = Omit<BaseIUserRole, 'tenant'> & TenantEntity;

export interface IUserRegister {
  username: string;
  email: string;
  password: string;
  clientName: string;
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
