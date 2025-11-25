import { z } from 'zod';

/**
 * User entity representing a system user
 */
export interface User {
  user_id: string;
  tenant: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_inactive: boolean;
  created_at: Date;
  updated_at: Date;
  user_type: 'internal' | 'client';
  contact_id?: string;
  phone?: string;
  timezone?: string;
  image?: string;
  two_factor_enabled?: boolean;
  is_google_user?: boolean;
  last_login_at?: Date;
  last_login_method?: string;
}

/**
 * Role entity representing a user role
 */
export interface Role {
  role_id: string;
  role_name: string;
  description?: string;
  msp: boolean;
  client: boolean;
  tenant?: string;
}

/**
 * Permission entity representing a system permission
 */
export interface Permission {
  permission_id: string;
  resource: string;
  action: string;
  msp: boolean;
  client: boolean;
  description?: string;
  tenant?: string;
}

/**
 * User-role association
 */
export interface UserRole {
  user_id: string;
  role_id: string;
  tenant: string;
}

/**
 * Role with permissions
 */
export interface RoleWithPermissions extends Role {
  permissions: Permission[];
}

/**
 * User with roles
 */
export interface UserWithRoles extends User {
  roles: Role[];
  avatarUrl?: string | null;
}

/**
 * Input schema for creating a new user (excludes password for type safety)
 */
export const createUserSchema = z.object({
  username: z.string().min(1, 'Username is required').max(100),
  email: z.string().email('Invalid email address'),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  user_type: z.enum(['internal', 'client']),
  contact_id: z.string().uuid().optional(),
  phone: z.string().max(50).optional(),
  timezone: z.string().max(100).optional(),
  image: z.string().optional(),
  two_factor_enabled: z.boolean().optional(),
  is_google_user: z.boolean().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Input schema for creating a user with password
 */
export const createUserWithPasswordSchema = createUserSchema.extend({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type CreateUserWithPasswordInput = z.infer<typeof createUserWithPasswordSchema>;

/**
 * Input schema for updating an existing user (password changes handled separately)
 */
export const updateUserSchema = createUserSchema.partial().extend({
  user_id: z.string().uuid(),
  is_inactive: z.boolean().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/**
 * Filters for querying users
 */
export interface UserFilters {
  search?: string;
  user_type?: 'internal' | 'client';
  is_inactive?: boolean;
  role_id?: string;
  contact_id?: string;
  limit?: number;
  offset?: number;
  orderBy?: keyof User;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Paginated response for user queries
 */
export interface UserListResponse {
  users: User[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Input for assigning a role to a user
 */
export const assignRoleSchema = z.object({
  user_id: z.string().uuid(),
  role_id: z.string().uuid(),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

/**
 * Input for removing a role from a user
 */
export const removeRoleSchema = z.object({
  user_id: z.string().uuid(),
  role_id: z.string().uuid(),
});

export type RemoveRoleInput = z.infer<typeof removeRoleSchema>;
