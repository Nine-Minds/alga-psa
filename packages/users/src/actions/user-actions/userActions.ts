'use server';

import User from '@alga-psa/db/models/user';
import { IUser, IRole, IUserWithRoles, IRoleWithPermissions, IUserRole } from '@alga-psa/types';
import { revalidatePath } from 'next/cache';
import { createTenantKnex, getTenantContext, runWithTenant } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { withAdminTransaction, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';
import Tenant from '@alga-psa/db/models/tenant';
import UserPreferences from '@alga-psa/db/models/userPreferences';
import { getUserAvatarUrl } from '../../lib/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from '@alga-psa/media';
import { hasPermission, throwPermissionError } from '@alga-psa/auth';
import logger from '@alga-psa/core/logger';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';

interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Check if an email exists globally across all tenants
 * @param email The email address to check
 * @returns Promise<boolean> True if email exists, false otherwise
 */
export async function checkEmailExistsGlobally(email: string): Promise<boolean> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const db = await getAdminConnection();
    
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot check email existence');
      }

      const existingUser = await trx('users')
        .where({ email: email.toLowerCase() })
        .first();
      
      return !!existingUser;
    });
  } catch (error) {
    logger.error('Error checking email existence globally:', error);
    throw error; // Preserve original error
  }
}

export async function addUser(userData: { 
  firstName: string; 
  lastName: string; 
  email: string;
  password: string;
  roleId?: string;
  userType?: 'internal' | 'client';
  contactId?: string;
  }): Promise<IUser> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!currentUser.tenant) {
      throw new Error('Tenant is required');
    }

    const {knex: db, tenant} = await createTenantKnex(currentUser.tenant);

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'create', trx)) {
        throw new Error('Permission denied: Cannot create user');
      }

      if (!userData.roleId) {
        throw new Error("Role is required");
      }

      // Validate that the role exists
      const role = await trx('roles')
        .where({ role_id: userData.roleId, tenant: tenant || undefined })
        .first();
        
      if (!role) {
        throw new Error("Invalid role");
      }
      
      // Validate role matches user type
      const isClientUser = userData.userType === 'client';
      if (isClientUser && !role.client) {
        throw new Error("Cannot assign MSP role to client portal user");
      }
      if (!isClientUser && !role.msp) {
        throw new Error("Cannot assign client portal role to MSP user");
      }

      // Check if email already exists globally
      const emailExists = await checkEmailExistsGlobally(userData.email);
      if (emailExists) {
        throw new Error("A user with this email address already exists");
      }

      // Check license limits for  MSP (internal) users
      if (userData.userType !== 'client') {
        const tenantRow = await trx('tenants')
          .where({ tenant })
          .first('licensed_user_count');

        if (!tenantRow) {
          throw new Error(`Tenant not found: ${tenant}`);
        }

        const usedResult = await trx('users')
          .where({
            tenant,
            user_type: 'internal',
            is_inactive: false,
          })
          .count('* as count');

        const used = parseInt(usedResult[0].count as string, 10);
        const limit = tenantRow.licensed_user_count as number | null;

        if (limit !== null && used >= limit) {
          throw new Error("You've reached your MSP user licence limit.");
        }
        
      }

      const [user] = await trx('users')
        .insert({
          first_name: userData.firstName,
          last_name: userData.lastName,
          email: userData.email.toLowerCase(), // Store email in lowercase for consistency
          username: userData.email.toLowerCase(),
          is_inactive: false,
          hashed_password: await hashPassword(userData.password),
          tenant: tenant || undefined,
          user_type: userData.userType || 'internal', // Default to 'internal' for backward compatibility
          contact_id: userData.contactId || undefined
        }).returning('*');

      await trx('user_roles').insert({
        user_id: user.user_id,
        role_id: userData.roleId,
        tenant: tenant || undefined
      });

      // Mark that the user hasn't reset their initial password
      await UserPreferences.upsert(trx, {
        user_id: user.user_id,
        setting_name: 'has_reset_password',
        setting_value: false,
        updated_at: new Date()
      });

      revalidatePath('/settings');
      return user;
    });
  } catch (error: any) {
    logger.error('Error adding user:', error);
    // Pass through the specific error message if it's about duplicate email
    if (error.message === "A user with this email address already exists") {
      throw error;
    }
    // Pass through permission denied errors
    if (error.message === "Permission denied: Cannot create user") {
      throw error;
    }
    // Pass through license limit errors
    if (error.message === "You've reached your internal user licence limit.") {
      throw error;
    }
    throw new Error('Failed to add user');
  }
}

export async function deleteUser(userId: string): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!currentUser.tenant) {
      throw new Error('Tenant is required');
    }

    const {knex: db, tenant} = await createTenantKnex(currentUser.tenant);

    await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'delete', trx)) {
        throw new Error('Permission denied: Cannot delete user');
      }

      const assignedClient = await trx('clients')
        .where({ account_manager_id: userId, tenant: tenant || undefined })
        .first();

      if (assignedClient) {
        throw new Error('Cannot delete user: Assigned as Account Manager to one or more clients. Please reassign first.');
      }

      // Set completed_by to NULL in workflow_tasks where the user is the completer
      await trx('workflow_tasks')
        .where({ completed_by: userId, tenant: tenant || undefined })
        .update({ completed_by: null });

      // Clear default_assigned_to on boards where this user is the default
      if (!tenant) {
        throw new Error('Tenant is required to clear board defaults');
      }
      await trx('boards')
        .where({ default_assigned_to: userId, tenant })
        .update({ default_assigned_to: null });

      // Delete user roles
      await trx('user_roles').where({ user_id: userId, tenant: tenant || undefined }).del();

      // Delete user preferences
      await trx('user_preferences').where({ user_id: userId, tenant: tenant || undefined }).del();

      // Delete user
      await trx('users').where({ user_id: userId, tenant: tenant || undefined }).del();
    });

    revalidatePath('/settings');
  } catch (error) {
    logger.error('Error deleting user:', error);
    throw new Error('Failed to delete user');
  }
}

export { getCurrentUser };

export async function findUserById(id: string): Promise<IUserWithRoles | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!currentUser.tenant) {
      throw new Error('Tenant is required');
    }

    const {knex} = await createTenantKnex(currentUser.tenant);

    return await runWithTenant(currentUser.tenant, async () =>
      withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'user', 'read', trx)) {
          throw new Error('Permission denied: Cannot read user');
        }

        const user = await User.getUserWithRoles(trx, id);
        return user || null;
      })
    );
  } catch (error) {
    logger.error(`Failed to find user with id ${id}:`, error);
    throw new Error('Failed to find user');
  }
}

/**
 * Get all users without roles - more efficient for components that only need basic user info
 * (e.g., UserPicker, dropdowns, assignments)
 */
export async function getAllUsersBasic(includeInactive: boolean = true, userType?: string): Promise<IUser[]> {
  try {
    const currentUser = await getCurrentUser();
    const tenant = currentUser?.tenant;

    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    return await runWithTenant(tenant, async () => {
      const {knex} = await createTenantKnex(tenant);

      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'user', 'read', trx)) {
          throw new Error('Permission denied: Cannot read users');
        }

        const users = await User.getAll(trx, includeInactive);

        // Filter by tenant and optionally by user_type
        return users.filter(user =>
          user.tenant === tenant &&
          (userType ? user.user_type === userType : true)
        );
      });
    });
  } catch (error) {
    logger.error('Failed to fetch users:', error);
    throw new Error('Failed to fetch users');
  }
}

export async function getAllUsers(includeInactive: boolean = true, userType?: string): Promise<IUserWithRoles[]> {
  try {
    const currentUser = await getCurrentUser();
    const tenant = currentUser?.tenant;

    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    return await runWithTenant(tenant, async () => {
      const {knex} = await createTenantKnex(tenant);

      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'user', 'read', trx)) {
          throw new Error('Permission denied: Cannot read users');
        }

        const users = await User.getAll(trx, includeInactive);

        // Filter by tenant and optionally by user_type first to reduce role fetching
        const filteredUsers = users.filter(user =>
          user.tenant === tenant &&
          (userType ? user.user_type === userType : true)
        );

        // Fetch all roles in a single query (avoids N+1)
        const userIds = filteredUsers.map(u => u.user_id);
        const rolesByUser = await User.getUserRolesBulk(trx, userIds);

        return filteredUsers.map((user): IUserWithRoles => ({
          ...user,
          roles: rolesByUser.get(user.user_id) || []
        }));
      });
    });
  } catch (error) {
    logger.error('Failed to fetch users:', error);
    throw new Error('Failed to fetch users');
  }
}

export async function updateUser(userId: string, userData: Partial<IUser>): Promise<IUserWithRoles | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      // Permission Check: User can update their own profile OR have user:update permission
      const isOwnProfile = currentUser.user_id === userId;

      if (isOwnProfile) {
        logger.debug(`[updateUser] User ${currentUser.user_id} updating their own profile`);
      } else if (!await hasPermission(currentUser, 'user', 'update', trx)) {
        throw new Error('Permission denied: Cannot update user');
      }

      // If user is being deactivated, clear default_assigned_to on boards
      if (userData.is_inactive === true) {
        if (!tenant) {
          throw new Error('Tenant is required to clear board defaults');
        }
        await trx('boards')
          .where({ default_assigned_to: userId, tenant })
          .update({ default_assigned_to: null });
      }

      await User.update(trx, userId, userData);
      const updatedUser = await User.getUserWithRoles(trx, userId);
      return updatedUser || null;
    });
  } catch (error) {
    logger.error(`Failed to update user with id ${userId}:`, error);
    throw new Error('Failed to update user');
  }
}

export async function updateUserRoles(userId: string, roleIds: string[]): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!currentUser.tenant) {
      throw new Error('Tenant is required');
    }

    const {knex: db, tenant} = await createTenantKnex(currentUser.tenant);

    await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'update', trx)) {
        throw new Error('Permission denied: Cannot update user roles');
      }

      // Delete existing roles
      await trx('user_roles')
        .where({ user_id: userId, tenant: tenant || undefined })
        .del();

      // Insert new roles
      if (roleIds.length > 0) {
        const userRoles = roleIds.map((roleId):IUserRole => ({
          user_id: userId,
          role_id: roleId,
          tenant: tenant || undefined
        }));
        await trx('user_roles').insert(userRoles);
      }
    });

    revalidatePath('/settings');
  } catch (error) {
    logger.error(`Failed to update roles for user with id ${userId}:`, error);
    throw new Error('Failed to update user roles');
  }
}

export async function getUserRoles(userId: string, knexConnection?: Knex | Knex.Transaction): Promise<IRole[]> {
  try {
    let knex: Knex | Knex.Transaction | undefined = knexConnection;
    let tenant = await getTenantContext();

    if (!knex) {
      const result = await createTenantKnex();
      knex = result.knex;
      tenant = tenant ?? result.tenant ?? undefined;
    }

    if (!tenant) {
      const { tenant: currentTenantId } = await createTenantKnex();
      if (currentTenantId) {
        tenant = currentTenantId;
      }
    }

    if (!tenant) {
      throw new Error('Tenant context is required to fetch user roles');
    }

    return await runWithTenant(tenant, async () => {
      return User.getUserRoles(knex!, userId);
    });
  } catch (error) {
    logger.error(`Failed to fetch roles for user with id ${userId}:`, error);
    throw new Error('Failed to fetch user roles');
  }
}

export async function getAllRoles(): Promise<IRole[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const roles = await trx('roles')
        .where({ tenant: tenant || undefined })
        .select('*');
      return roles;
    });
  } catch (error) {
    logger.error('Failed to fetch all roles:', error);
    throw new Error('Failed to fetch all roles');
  }
}

/**
 * Get MSP roles only (roles with msp flag = true)
 */
export async function getMSPRoles(): Promise<IRole[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const roles = await trx('roles')
        .where({ 
          tenant: tenant || undefined,
          msp: true 
        })
        .select('*');
      return roles;
    });
  } catch (error) {
    logger.error('Failed to fetch MSP roles:', error);
    throw new Error('Failed to fetch MSP roles');
  }
}

/**
 * Get Client Portal roles only (roles with client flag = true)
 */
export async function getClientPortalRoles(): Promise<IRole[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const roles = await trx('roles')
        .where({ 
          tenant: tenant || undefined,
          client: true 
        })
        .select('*');
      return roles;
    });
  } catch (error) {
    logger.error('Failed to fetch client portal roles:', error);
    throw new Error('Failed to fetch client portal roles');
  }
}

export async function getUserRolesWithPermissions(userId: string, knexConnection?: Knex | Knex.Transaction): Promise<IRoleWithPermissions[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!currentUser.tenant) {
      throw new Error('Tenant is required');
    }

    let knex: Knex | Knex.Transaction;
    if (knexConnection) {
      knex = knexConnection;
      // If we have a connection passed in, check permissions directly
      if (!await hasPermission(currentUser, 'user', 'read', knex)) {
        throw new Error('Permission denied: Cannot read user roles with permissions');
      }
      const rolesWithPermissions = await runWithTenant(currentUser.tenant, () =>
        User.getUserRolesWithPermissions(knex, userId)
      );
      return rolesWithPermissions;
    } else {
      const result = await createTenantKnex(currentUser.tenant);
      knex = result.knex;
      
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'user', 'read', trx)) {
          throw new Error('Permission denied: Cannot read user roles with permissions');
        }
        
        const rolesWithPermissions = await runWithTenant(currentUser.tenant, () =>
          User.getUserRolesWithPermissions(trx, userId)
        );
        return rolesWithPermissions;
      });
    }
  } catch (error) {
    logger.error(`Failed to fetch roles with permissions for user with id ${userId}:`, error);
    throw new Error('Failed to fetch user roles with permissions');
  }
}

/**
 * Retrieves a flattened list of unique permission strings for the current user.
 * @returns Promise<string[]> A promise that resolves to an array of unique permission strings.
 */
export async function getCurrentUserPermissions(): Promise<string[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      logger.debug('No current user found, returning empty permissions.');
      return [];
    }

    const rolesWithPermissions = await getUserRolesWithPermissions(currentUser.user_id);

    // Flatten permissions from all roles and make them unique
    const allPermissions = rolesWithPermissions.reduce((acc, role) => {
      if (role.permissions) {
        role.permissions.forEach(permission => {
          const permissionString = `${permission.resource}:${permission.action}`;
          acc.add(permissionString);
        });
      }
      return acc;
    }, new Set<string>());

    logger.debug(`User ${currentUser.user_id} has permissions: ${Array.from(allPermissions).join(', ')}`);
    return Array.from(allPermissions);
  } catch (error) {
    logger.error('Failed to get current user permissions:', error);
    // Depending on requirements, you might want to return empty array or re-throw
    // Returning empty array for now to avoid breaking flows that might expect an array
    return [];
  }
}

export async function getUserWithRoles(userId: string): Promise<IUserWithRoles | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!currentUser.tenant) {
      throw new Error('Tenant is required');
    }

    const {knex} = await createTenantKnex(currentUser.tenant);
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user with roles');
      }

      const user = await User.getUserWithRoles(trx, userId);
      return user || null;
    });
  } catch (error) {
    logger.error(`Failed to fetch user with roles for id ${userId}:`, error);
    throw new Error('Failed to fetch user with roles');
  }
}

export async function getMultipleUsersWithRoles(userIds: string[]): Promise<IUserWithRoles[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    if (!currentUser.tenant) {
      throw new Error('Tenant is required');
    }

    const {knex} = await createTenantKnex(currentUser.tenant);
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read multiple users with roles');
      }

      const users = await Promise.all(userIds.map((id: string): Promise<IUserWithRoles | undefined> => User.getUserWithRoles(trx, id)));
      return users.filter((user): user is IUserWithRoles => user !== undefined);
    });
  } catch (error) {
    logger.error('Failed to fetch multiple users with roles:', error);
    throw new Error('Failed to fetch multiple users with roles');
  }
}

// User Preferences Actions
export async function getUserPreference(userId: string, settingName: string): Promise<any> {
  try {
    const currentUser = await getCurrentUser();
    const tenant = currentUser?.tenant;
    if (!tenant) throw new Error('Tenant is required');

    return await runWithTenant(tenant, async () => {
      const {knex} = await createTenantKnex(tenant);
      const preference = await UserPreferences.get(knex, userId, settingName);
      if (!preference?.setting_value) return null;

      try {
        // Try to parse the JSON value
        return JSON.parse(preference.setting_value);
      } catch (e) {
        // If parsing fails, return the raw value
        return preference.setting_value;
      }
    });
  } catch (error) {
    logger.error('Failed to get user preference:', error);
    throw new Error('Failed to get user preference');
  }
}

export async function setUserPreference(userId: string, settingName: string, settingValue: any): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    const tenant = currentUser?.tenant;
    if (!tenant) throw new Error('Tenant is required');

    await runWithTenant(tenant, async () => {
      // Convert the value to a JSON string
      const jsonValue = JSON.stringify(settingValue);

      const {knex} = await createTenantKnex(tenant);
      await UserPreferences.upsert(knex, {
        user_id: userId,
        setting_name: settingName,
        setting_value: jsonValue,
        updated_at: new Date()
      });
    });
  } catch (error) {
    logger.error('Failed to set user preference:', error);
    throw new Error('Failed to set user preference');
  }
}

export async function verifyContactEmail(email: string): Promise<{ exists: boolean; isActive: boolean; clientId?: string; tenant?: string }> {
  try {
    // Email suffix functionality removed for security - only check contacts
    const contact = await withAdminTransaction(async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .join('clients', function() {
          this.on('clients.client_id', '=', 'contacts.client_id')
              .andOn('clients.tenant', '=', 'contacts.tenant');
        })
        .where({ 'contacts.email': email.toLowerCase() })
        .select('contacts.contact_name_id', 'contacts.client_id', 'contacts.is_inactive', 'contacts.tenant')
        .first();
    });

    if (!contact) {
      return { exists: false, isActive: false };
    }

    return {
      exists: true,
      isActive: !contact.is_inactive,
      clientId: contact.client_id,
      tenant: contact.tenant
    };
  } catch (error) {
    logger.error('Failed to verify contact email:', error);
    throw new Error('Failed to verify contact email');
  }
}

export async function registerClientUser(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const db = await getAdminConnection();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'create', trx)) {
        throw new Error('Permission denied: Cannot create client user');
      }

      // First verify the contact exists and get their tenant
      const contact = await trx('contacts')
        .join('clients', function() {
          this.on('clients.client_id', '=', 'contacts.client_id')
              .andOn('clients.tenant', '=', 'contacts.tenant');
        })
        .where({ 'contacts.email': email.toLowerCase() })
        .select(
          'contacts.contact_name_id',
          'contacts.client_id',
          'contacts.tenant',
          'contacts.is_inactive',
          'contacts.full_name'
        )
        .first();

      if (!contact) {
        return { success: false, error: 'Contact not found' };
      }

      if (contact.is_inactive) {
        return { success: false, error: 'Contact is inactive' };
      }

      // Check if user already exists globally
      const emailExists = await checkEmailExistsGlobally(email);
      if (emailExists) {
        return { success: false, error: 'User with this email already exists' };
      }

      // Split full name into first and last name
      const nameParts = contact.full_name.trim().split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Create the user with client user type
      logger.debug('Creating new user record...');
      const hashedPassword = await hashPassword(password);
      logger.debug('Password hashed successfully');

      const [user] = await trx('users')
        .insert({
          email: email.toLowerCase(),
          username: email.toLowerCase(),
          first_name: firstName,
          last_name: lastName,
          hashed_password: hashedPassword,
          tenant: contact.tenant,
          user_type: 'client',
          contact_id: contact.contact_name_id,
          is_inactive: false,
          created_at: new Date()
        })
        .returning('*');

      // Get the default client portal user role (must exist via migrations)
      const clientRole = await trx('roles')
        .where({ 
          tenant: contact.tenant,
          client: true,
          msp: false
        })
        .whereRaw('LOWER(role_name) = ?', ['user'])
        .first();

      if (!clientRole) {
        throw new Error('Client portal User role not found for tenant');
      }

      // Assign the role to the user
      await trx('user_roles').insert({
        user_id: user.user_id,
        role_id: clientRole.role_id,
        tenant: contact.tenant
      });

      return { success: true };
    });
  } catch (error) {
    logger.error('Error registering client user:', error);
    return { success: false, error: 'Failed to register user' };
  }
}

export async function checkPasswordResetStatus(): Promise<{ hasResetPassword: boolean }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { hasResetPassword: true }; // Default to true if no user
    }

    const {knex} = await createTenantKnex();

    // RBAC check - users can only check their own password reset status
    if (!await hasPermission(currentUser, 'user', 'read', knex)) {
      // Use standardized permission error to avoid silent success paths
      throwPermissionError('check password reset status');
    }

    // UserPreferences enforces tenant scoping internally (tenant is part of its unique key)
    const preference = await UserPreferences.get(knex, currentUser.user_id, 'has_reset_password');
    
    // For existing users without this preference, assume they have already reset their password
    // Only new users created after this feature will have has_reset_password = false
    const hasReset = preference ? preference.setting_value === true : true;
    
    return { hasResetPassword: hasReset };
  } catch (error) {
    logger.error('Error checking password reset status:', error);
    return { hasResetPassword: true }; // Default to true on error to avoid showing warning
  }
}

// New function for users to change their own password
export async function changeOwnPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not found' };
    }

    // Verify current password
    const isValidPassword = await User.verifyPassword(currentUser.user_id, currentPassword);
    if (!isValidPassword) {
      return { success: false, error: 'Current password is incorrect' };
    }

    // Hash the new password and update
    const hashedPassword = await hashPassword(newPassword);
    await User.updatePassword(currentUser.email, hashedPassword);

    // Mark that the user has reset their password
    const {knex} = await createTenantKnex();
    await UserPreferences.upsert(knex, {
      user_id: currentUser.user_id,
      setting_name: 'has_reset_password',
      setting_value: true,
      updated_at: new Date()
    });

    return { success: true };
  } catch (error) {
    logger.error('Error changing password:', error);
    return { success: false, error: 'Failed to change password' };
  }
}

// Function for admins to change user passwords
export async function getUserClientId(userId: string): Promise<string | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // For client users accessing their own client ID, no permission check needed
      // For other users, check user:read permission
      if (currentUser.user_id !== userId && !await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user client ID');
      }

      const user = await User.get(trx, userId); // Use User.get which includes tenant context
      if (!user) return null;

      // First try to get client ID from contact if user is contact-based
      if (user.contact_id) {
        const contact = await trx('contacts')
          .where({
            contact_name_id: user.contact_id,
            tenant: tenant
          })
          .select('client_id')
          .first();

        if (contact?.client_id) {
          return contact.client_id;
        }
      }

      // Email suffix functionality removed for security
      return null;
    });
  } catch (error) {
    logger.error('Error getting user client ID:', error);
    throw new Error('Failed to get user client ID');
  }
}

/**
 * Gets the contact_id for a user, which is needed for fetching contact avatars
 * @param userId The user ID to get the contact_id for
 * @returns The contact_id if found, null otherwise
 */
export async function getUserContactId(userId: string): Promise<string | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user contact ID');
      }

      const user = await trx('users')
        .where({
          user_id: userId,
          tenant: tenant
        })
        .select('contact_id')
        .first();

      return user?.contact_id || null;
    });
  } catch (error) {
    logger.error('Error getting user contact ID:', error);
    throw new Error('Failed to get user contact ID');
  }
}

export async function adminChangeUserPassword(
  userId: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'Admin user not found' };
    }

    const {knex} = await createTenantKnex();
    // Get the user to verify they're in the same tenant
    const targetUser = await User.get(knex, userId);
    if (!targetUser) {
      return { success: false, error: 'User not found' };
    }

    // Verify users are in the same tenant
    if (targetUser.tenant !== currentUser.tenant) {
      return { success: false, error: 'Unauthorized: Cannot modify user from different tenant' };
    }

    const currentUserRoles = await getUserRoles(currentUser.user_id);
    const isAdmin = currentUserRoles.some(role => role.role_name.toLowerCase() === 'admin');

    if (!isAdmin) {
      return { success: false, error: 'Unauthorized: Admin privileges required' };
    }

    // Hash the new password and update
    const hashedPassword = await hashPassword(newPassword);
    await User.updatePassword(targetUser.email, hashedPassword);

    return { success: true };
  } catch (error) {
    logger.error('Error changing user password:', error);
    return { success: false, error: 'Failed to change user password' };
  }
}

/**
 * Uploads or replaces a user's avatar.
 *
 * @param userId - The ID of the user whose avatar is being uploaded.
 * @param formData - The FormData containing the avatar file under the key 'avatar'.
 * @returns ActionResult indicating success or failure, with optional avatar URL.
 */
export async function uploadUserAvatar(
  userId: string,
  formData: FormData
): Promise<ActionResult & { avatarUrl?: string | null }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.user_id) {
      return { success: false, error: 'Authentication required.' };
    }

    const { tenant } = await createTenantKnex(); // Still need tenant
    if (!tenant) {
        return { success: false, error: 'Tenant context is missing.' };
    }

    const {knex} = await createTenantKnex();
    const targetUser = await User.get(knex, userId); // Use existing User model

    if (!targetUser) {
      return { success: false, error: 'Target user not found.' };
    }

    // Ensure users are in the same tenant
    if (targetUser.tenant !== currentUser.tenant) {
        return { success: false, error: 'Permission denied: Cannot modify user in different tenant.' };
    }

    // Permission Check: User can update their own avatar OR have user update permission
    const isOwnAvatar = currentUser.user_id === userId;
    const isAdmin = currentUser.roles.some(role => role.role_name.toLowerCase() === 'admin');
    
    // Always allow users to update their own avatar, regardless of permissions
    if (isOwnAvatar) {
        console.log(`[uploadUserAvatar] User ${currentUser.user_id} updating their own avatar`);
    } else if (isAdmin || await hasPermission(currentUser, 'user', 'update', knex)) {
        console.log(`[uploadUserAvatar] User ${currentUser.user_id} with admin/update permission updating avatar for user ${userId}`);
    } else {
        console.log(`[uploadUserAvatar] Permission denied: User ${currentUser.user_id} trying to update avatar for user ${userId}`);
        return { success: false, error: 'Permission denied: You can only update your own avatar.' };
    }

    const file = formData.get('avatar') as File | null;

    if (!file) {
      return { success: false, error: 'No avatar file provided.' };
    }

    if (file.size === 0) {
        return { success: false, error: 'Avatar file cannot be empty.' };
    }

    // Call the generic service function
    const uploadResult = await uploadEntityImage(
      'user',
      userId,
      file,
      currentUser.user_id,
      tenant,
      'user_avatar',
      true
    );

    if (!uploadResult.success) {
      return { success: false, error: uploadResult.message || 'Failed to upload avatar.' };
    }

    // Invalidate cache
    revalidatePath(`/users/${userId}`);
    revalidatePath(`/profile/${userId}`);
    revalidatePath('/settings/users'); // Adjust path as needed

    // Use the imageUrl returned by the service
    const avatarUrl = uploadResult.imageUrl;
    logger.debug(`[uploadUserAvatar] New avatar URL: ${avatarUrl}`);

    return {
      success: true,
      message: 'Avatar uploaded successfully.',
      avatarUrl
    };

  } catch (error: any) {
    logger.error('[UserActions] Failed to upload user avatar:', {
      operation: 'uploadUserAvatar',
      userId,
      errorMessage: error.message || 'Unknown error',
      errorStack: error.stack,
      errorName: error.name
    });
    return { success: false, error: error.message || 'An unexpected error occurred while uploading the avatar.' };
  }
}


/**
 * Deletes a user's avatar.
 *
 * @param userId - The ID of the user whose avatar is being deleted.
 * @returns ActionResult indicating success or failure.
 */
export async function deleteUserAvatar(userId: string): Promise<ActionResult> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.user_id) {
      return { success: false, error: 'Authentication required.' };
    }

    const { tenant } = await createTenantKnex(); // Still need tenant
    if (!tenant) {
        return { success: false, error: 'Tenant context is missing.' };
    }

    const {knex} = await createTenantKnex();
    const targetUser = await User.get(knex, userId);

    if (!targetUser) {
      return { success: false, error: 'Target user not found.' };
    }

    // Ensure users are in the same tenant
    if (targetUser.tenant !== currentUser.tenant) {
        return { success: false, error: 'Permission denied: Cannot modify user in different tenant.' };
    }

    // Permission Check: User can delete their own avatar OR have user update permission
    const isOwnAvatar = currentUser.user_id === userId;
    const isAdmin = currentUser.roles.some(role => role.role_name.toLowerCase() === 'admin');
    
    // Always allow users to delete their own avatar, regardless of permissions
    if (isOwnAvatar) {
        console.log(`[deleteUserAvatar] User ${currentUser.user_id} deleting their own avatar`);
    } else if (isAdmin || await hasPermission(currentUser, 'user', 'update', knex)) {
        console.log(`[deleteUserAvatar] User ${currentUser.user_id} with admin/update permission deleting avatar for user ${userId}`);
    } else {
        console.log(`[deleteUserAvatar] Permission denied: User ${currentUser.user_id} trying to delete avatar for user ${userId}`);
        return { success: false, error: 'Permission denied: You can only delete your own avatar.' };
    }

    // Call the generic service function
    const deleteResult = await deleteEntityImage(
      'user',
      userId,
      currentUser.user_id,
      tenant
    );

    if (!deleteResult.success) {
      return { success: false, error: deleteResult.message || 'Failed to delete avatar.' };
    }

    // Invalidate cache
    revalidatePath(`/users/${userId}`);
    revalidatePath(`/profile/${userId}`);
    revalidatePath('/settings/users'); // Adjust path as needed

    return { success: true, message: deleteResult.message || 'Avatar deleted successfully.' };

  } catch (error: any) {
    logger.error(`[UserActions] Failed to delete user avatar:`, {
      operation: 'deleteUserAvatar',
      userId,
      errorMessage: error.message || 'Unknown error',
      errorStack: error.stack,
      errorName: error.name
    });
    return { success: false, error: error.message || 'An unexpected error occurred while deleting the avatar.' };
  }
}

export async function getClientUsersForClient(clientId: string): Promise<IUser[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get all users associated with the client
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read client users for client');
      }

      const users = await trx('users')
        .join('contacts', function() {
          this.on('users.contact_id', '=', 'contacts.contact_name_id')
              .andOn('contacts.tenant', '=', trx.raw('?', [tenant]));
        })
        .where({
          'contacts.client_id': clientId,
          'users.tenant': tenant,
          'users.user_type': 'client'
        })
        .select('users.*');

      return users;
    });
  } catch (error) {
    logger.error('Error getting client users:', error);
    throw error;
  }
}

// Alias for compatibility
export const getUserById = findUserById;

/**
 * Get the current user's avatar URL (server action for client components)
 */
export async function getCurrentUserAvatarUrl(): Promise<string | null> {
  'use server';

  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      return null;
    }

    return await getUserAvatarUrl(user.user_id, user.tenant);
  } catch (error) {
    logger.error('Error getting current user avatar URL:', error);
    return null;
  }
}
