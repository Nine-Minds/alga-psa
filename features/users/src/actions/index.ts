/**
 * User server actions
 *
 * These are Next.js server actions for user operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createUserRepository } from '../repositories/index.js';
import {
  createUserSchema,
  createUserWithPasswordSchema,
  updateUserSchema,
  assignRoleSchema,
  removeRoleSchema,
  type User,
  type UserFilters,
  type UserListResponse,
  type CreateUserInput,
  type CreateUserWithPasswordInput,
  type UpdateUserInput,
  type AssignRoleInput,
  type RemoveRoleInput,
  type Role,
  type Permission,
  type UserWithRoles,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a list of users for the current tenant
 */
export async function getUsers(
  context: ActionContext,
  filters: UserFilters = {}
): Promise<UserListResponse> {
  const repo = createUserRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get a single user by ID
 */
export async function getUser(
  context: ActionContext,
  userId: string
): Promise<User | null> {
  const repo = createUserRepository(context.knex);
  return repo.findById(context.tenantId, userId);
}

/**
 * Get a user with their roles
 */
export async function getUserWithRoles(
  context: ActionContext,
  userId: string
): Promise<UserWithRoles | null> {
  const repo = createUserRepository(context.knex);
  return repo.findByIdWithRoles(context.tenantId, userId);
}

/**
 * Create a new user (without password - for internal use)
 */
export async function createUser(
  context: ActionContext,
  input: CreateUserInput
): Promise<{ success: true; user: User } | { success: false; error: string }> {
  // Validate input
  const validation = createUserSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createUserRepository(context.knex);

    // Check if user already exists
    const existingUser = await repo.findByEmail(context.tenantId, validation.data.email);
    if (existingUser) {
      return { success: false, error: 'User with this email already exists' };
    }

    const user = await repo.create(context.tenantId, validation.data);
    return { success: true, user };
  } catch (error) {
    console.error('[users/actions] Failed to create user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create user',
    };
  }
}

/**
 * Create a new user with password (requires password hashing)
 * Note: This should use a password hashing utility from @alga-psa/shared
 */
export async function createUserWithPassword(
  context: ActionContext,
  input: CreateUserWithPasswordInput
): Promise<{ success: true; user: User } | { success: false; error: string }> {
  // Validate input
  const validation = createUserWithPasswordSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createUserRepository(context.knex);

    // Check if user already exists
    const existingUser = await repo.findByEmail(context.tenantId, validation.data.email);
    if (existingUser) {
      return { success: false, error: 'User with this email already exists' };
    }

    // TODO: Hash password using @alga-psa/shared/utils/encryption
    // For now, this is a placeholder
    const { password, ...userData } = validation.data;
    const hashedPassword = password; // Replace with actual hashing

    const user = await repo.create(context.tenantId, userData, hashedPassword);
    return { success: true, user };
  } catch (error) {
    console.error('[users/actions] Failed to create user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create user',
    };
  }
}

/**
 * Update an existing user
 */
export async function updateUser(
  context: ActionContext,
  input: UpdateUserInput
): Promise<{ success: true; user: User } | { success: false; error: string }> {
  // Validate input
  const validation = updateUserSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createUserRepository(context.knex);
    const user = await repo.update(context.tenantId, validation.data);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    return { success: true, user };
  } catch (error) {
    console.error('[users/actions] Failed to update user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update user',
    };
  }
}

/**
 * Delete a user (soft delete)
 */
export async function deleteUser(
  context: ActionContext,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createUserRepository(context.knex);
    const deleted = await repo.delete(context.tenantId, userId);

    if (!deleted) {
      return { success: false, error: 'User not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[users/actions] Failed to delete user:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete user',
    };
  }
}

/**
 * Assign a role to a user
 */
export async function assignRole(
  context: ActionContext,
  input: AssignRoleInput
): Promise<{ success: boolean; error?: string }> {
  // Validate input
  const validation = assignRoleSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createUserRepository(context.knex);

    // Verify user exists
    const user = await repo.findById(context.tenantId, validation.data.user_id);
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Verify role exists
    const role = await repo.getRoleById(validation.data.role_id);
    if (!role) {
      return { success: false, error: 'Role not found' };
    }

    await repo.assignRole(context.tenantId, validation.data.user_id, validation.data.role_id);
    return { success: true };
  } catch (error) {
    console.error('[users/actions] Failed to assign role:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to assign role',
    };
  }
}

/**
 * Remove a role from a user
 */
export async function removeRole(
  context: ActionContext,
  input: RemoveRoleInput
): Promise<{ success: boolean; error?: string }> {
  // Validate input
  const validation = removeRoleSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createUserRepository(context.knex);
    const removed = await repo.removeRole(
      context.tenantId,
      validation.data.user_id,
      validation.data.role_id
    );

    if (!removed) {
      return { success: false, error: 'User role not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[users/actions] Failed to remove role:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove role',
    };
  }
}

/**
 * Get roles assigned to a user
 */
export async function getUserRoles(
  context: ActionContext,
  userId: string
): Promise<Role[]> {
  const repo = createUserRepository(context.knex);
  return repo.getUserRoles(context.tenantId, userId);
}

/**
 * Get permissions for a user (through their roles)
 */
export async function getUserPermissions(
  context: ActionContext,
  userId: string
): Promise<Permission[]> {
  const repo = createUserRepository(context.knex);
  return repo.getUserPermissions(context.tenantId, userId);
}

/**
 * Get all available roles
 */
export async function getAllRoles(
  context: ActionContext
): Promise<Role[]> {
  const repo = createUserRepository(context.knex);
  return repo.getAllRoles(context.tenantId);
}
