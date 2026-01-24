import { UserAttributeKey, TicketAttributeKey } from '@alga-psa/types';
import { TenantEntity } from './index';
import type {
  IUser as SharedIUser,
  IRole as SharedIRole,
  IPermission as SharedIPermission,
  IUserWithRoles as SharedIUserWithRoles,
  IUserRole as SharedIUserRole,
} from '@shared/interfaces/user.interfaces';

// Consolidated type re-exports from shared with server-specific strictness where needed

// Base user. Avoid DB-only strictness here (e.g. requiring `hashed_password`),
// since these types are used across UI and server code.
export type IUser = SharedIUser;

// DB-only helper type for call sites that truly require `hashed_password`.
export type IUserWithHashedPassword = SharedIUser & { hashed_password: string };

// Role should remain compatible with shared/types. Avoid introducing UI-breaking strictness here.
export type IRole = SharedIRole;

export type IPermission = SharedIPermission;

export type IUserWithRoles = SharedIUserWithRoles;

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
