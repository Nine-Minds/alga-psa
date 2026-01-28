/**
 * Canonical User Interfaces
 * These are the canonical definitions for user-related types used across the codebase.
 * All references should use these definitions unless there's a specific reason not to.
 */

/**
 * Core user entity interface
 */
export interface IUser {
  user_id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  email: string;
  hashed_password?: string;
  password?: string; // Some tables use 'password' field
  image?: string;
  created_at?: Date | string;
  updated_at?: Date | string;
  two_factor_enabled?: boolean;
  two_factor_secret?: string;
  two_factor_required_new_device?: boolean;
  is_google_user?: boolean;
  is_inactive: boolean;
  tenant: string;
  user_type: 'internal' | 'client';
  contact_id?: string;
  /** The client_id associated with this user (derived from contact_id for client users) */
  clientId?: string;
  phone?: string;
  timezone?: string;
  last_login_at?: Date | string;
  last_login_method?: string;
}

/**
 * Role entity interface
 */
export interface IRole {
  role_id: string;
  role_name: string;
  description?: string;
  msp: boolean;
  client: boolean;
  tenant?: string;
}

/**
 * Permission entity interface
 */
export interface IPermission {
  permission_id: string;
  resource: string;
  action: string;
  msp: boolean;
  client: boolean;
  description?: string;
  tenant?: string;
}

/**
 * Role with permissions
 */
export interface IRoleWithPermissions extends IRole {
  permissions: IPermission[];
}

/**
 * User with roles
 */
export interface IUserWithRoles extends IUser {
  roles: IRole[];
  avatarUrl?: string | null;
}

/**
 * User-role association
 */
export interface IUserRole {
  user_id: string;
  role_id: string;
  tenant: string;
}

/**
 * Input type for creating a portal user
 */
export interface CreatePortalUserInput {
  email: string;
  password: string;
  contactId: string;
  clientId: string;
  tenantId: string;
  firstName?: string;
  lastName?: string;
  roleId?: string; // Optional specific role ID
  isClientAdmin?: boolean; // Whether the user should be a client admin
}

/**
 * Result type for portal user creation
 */
export interface CreatePortalUserResult {
  success: boolean;
  userId?: string;
  roleId?: string;
  error?: string;
}

/**
 * Portal user with additional context
 */
export interface PortalUserWithContext extends IUser {
  client_id: string;
  client_name?: string;
  contact_name?: string;
  roles: IRole[];
}

/**
 * Options for determining portal user role
 */
export interface PortalRoleOptions {
  isClientAdmin: boolean;
  tenantId: string;
  roleId?: string; // Optional override
}