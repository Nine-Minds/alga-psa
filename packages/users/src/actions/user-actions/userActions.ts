'use server';

import User from '@alga-psa/db/models/user';
import { DeletionValidationResult, IUser, IUserWithRoles, IUserRole } from '@alga-psa/types';
import { revalidatePath } from 'next/cache';
import { createTenantKnex } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { withAdminTransaction, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { deleteEntityWithValidation } from '@alga-psa/core';
import { hashPassword } from '@alga-psa/core/encryption';
import UserPreferences from '@alga-psa/db/models/userPreferences';
import { getUserAvatarUrl } from '@alga-psa/user-composition/lib/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from '@alga-psa/storage';
import { hasPermission, throwPermissionError } from '@alga-psa/user-composition/lib/permissions';
import { getUserRoles } from '@alga-psa/user-composition/actions';
import logger from '@alga-psa/core/logger';
import { withAuth, withOptionalAuth } from '@alga-psa/auth';

interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

type AddUserResult =
  | { success: true; user: IUser }
  | { success: false; error: string };

const SOLO_USER_LIMIT_MESSAGE = 'Solo plan is limited to 1 user. Upgrade to Pro to add more users.';

const ADD_USER_VALIDATION_ERRORS = new Set([
  'Role is required',
  'Invalid role',
  'Cannot assign MSP role to client portal user',
  'Cannot assign client portal role to MSP user',
  'A user with this email address already exists',
  "You've reached your MSP user licence limit.",
  SOLO_USER_LIMIT_MESSAGE,
]);

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : '';

/**
 * Check if an email exists globally across all tenants
 * @param email The email address to check
 * @returns Promise<boolean> True if email exists, false otherwise
 */
export const checkEmailExistsGlobally = withAuth(async (
  user,
  _ctx,
  email: string
): Promise<boolean> => {
  try {
    const db = await getAdminConnection();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'user', 'read', trx)) {
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
});

export const addUser = withAuth(async (
  user,
  { tenant },
  userData: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    roleId?: string;
    userType?: 'internal' | 'client';
    contactId?: string;
    reportsTo?: string;
  }
): Promise<AddUserResult> => {
  try {
    const {knex: db} = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'user', 'create', trx)) {
        throw new Error('Permission denied: Cannot create user');
      }

      if (!userData.roleId) {
        return { success: false, error: 'Role is required' };
      }

      // Validate that the role exists
      const role = await trx('roles')
        .where({ role_id: userData.roleId, tenant: tenant || undefined })
        .first();

      if (!role) {
        return { success: false, error: 'Invalid role' };
      }

      // Validate role matches user type
      const isClientUser = userData.userType === 'client';
      if (isClientUser && !role.client) {
        return { success: false, error: 'Cannot assign MSP role to client portal user' };
      }
      if (!isClientUser && !role.msp) {
        return { success: false, error: 'Cannot assign client portal role to MSP user' };
      }

      // Check if email already exists globally
      const emailExists = await checkEmailExistsGlobally(userData.email);
      if (emailExists) {
        return { success: false, error: 'A user with this email address already exists' };
      }

      // Check license limits for  MSP (internal) users
      if (userData.userType !== 'client') {
        const tenantRow = await trx('tenants')
          .where({ tenant })
          .first('licensed_user_count', 'plan');

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
        const plan = tenantRow.plan as string | null | undefined;

        if (plan === 'solo' && used >= 1) {
          return { success: false, error: SOLO_USER_LIMIT_MESSAGE };
        }

        if (limit !== null && used >= limit) {
          return { success: false, error: "You've reached your MSP user licence limit." };
        }

      }

      const [newUser] = await trx('users')
        .insert({
          first_name: userData.firstName,
          last_name: userData.lastName,
          email: userData.email.toLowerCase(), // Store email in lowercase for consistency
          username: userData.email.toLowerCase(),
          is_inactive: false,
          hashed_password: await hashPassword(userData.password),
          tenant: tenant || undefined,
          user_type: userData.userType || 'internal', // Default to 'internal' for backward compatibility
          contact_id: userData.contactId || undefined,
          reports_to: userData.reportsTo || undefined
        }).returning('*');

      await trx('user_roles').insert({
        user_id: newUser.user_id,
        role_id: userData.roleId,
        tenant: tenant || undefined
      });

      // Mark that the user hasn't reset their initial password
      await UserPreferences.upsert(trx, {
        user_id: newUser.user_id,
        setting_name: 'has_reset_password',
        setting_value: false,
        updated_at: new Date()
      });

      revalidatePath('/settings');
      return { success: true, user: newUser };
    });
  } catch (error: unknown) {
    logger.error('Error adding user:', error);
    const message = getErrorMessage(error);
    if (ADD_USER_VALIDATION_ERRORS.has(message)) {
      return { success: false, error: message };
    }
    if (message === 'Permission denied: Cannot create user') {
      throw error;
    }
    throw new Error('Failed to add user');
  }
});

export const deleteUser = withAuth(async (
  user,
  { tenant },
  userId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean }> => {
  try {
    const {knex: db} = await createTenantKnex();

    const assignedClient = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(user, 'user', 'delete', trx)) {
        throw new Error('Permission denied: Cannot delete user');
      }

      return await trx('clients')
        .where({ account_manager_id: userId, tenant: tenant || undefined })
        .first();
    });

    if (assignedClient) {
      return {
        success: false,
        canDelete: false,
        code: 'DEPENDENCIES_EXIST',
        message: 'Cannot delete user: Assigned as Account Manager to one or more clients. Please reassign first.',
        dependencies: [],
        alternatives: []
      };
    }

    const result = await deleteEntityWithValidation('user', userId, db, tenant, async (trx, tenantId) => {
      // Clear reports_to references so subordinates don't point to a deleted user
      await trx('users')
        .where({ reports_to: userId, tenant: tenantId || undefined })
        .update({ reports_to: null });

      await trx('workflow_tasks')
        .where({ completed_by: userId, tenant: tenantId || undefined })
        .update({ completed_by: null });

      await trx('boards')
        .where({ default_assigned_to: userId, tenant: tenantId })
        .update({ default_assigned_to: null });

      await trx('platform_notification_recipients').where({ user_id: userId, tenant: tenantId || undefined }).del();
      await trx('user_roles').where({ user_id: userId, tenant: tenantId || undefined }).del();
      await trx('user_preferences').where({ user_id: userId, tenant: tenantId || undefined }).del();

      const deleted = await trx('users').where({ user_id: userId, tenant: tenantId || undefined }).del();
      if (!deleted || deleted === 0) {
        throw new Error('User record not found or could not be deleted');
      }
    });

    revalidatePath('/settings');

    return {
      ...result,
      success: result.deleted === true,
      deleted: result.deleted
    };
  } catch (error) {
    logger.error('Error deleting user:', error);
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Failed to delete user',
      dependencies: [],
      alternatives: []
    };
  }
});

export const updateUser = withAuth(async (
  currentUser,
  { tenant },
  userId: string,
  userData: Partial<IUser>
): Promise<IUserWithRoles | null> => {
  try {
    const { knex } = await createTenantKnex();
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
        await trx('boards')
          .where({ default_assigned_to: userId, tenant })
          .update({ default_assigned_to: null });
      }

      if (userData.reports_to !== undefined) {
        if (userData.reports_to === userId) {
          throw new Error('reports_to cannot reference the user itself');
        }

        if (userData.reports_to) {
          const wouldCreateCycle = await User.isInReportsToChain(trx, userId, userData.reports_to);
          if (wouldCreateCycle) {
            throw new Error('reports_to would create a circular reporting chain');
          }
        }
      }

      await User.update(trx, userId, userData);
      const updatedUser = await User.getUserWithRoles(trx, userId);
      return updatedUser || null;
    });
  } catch (error) {
    logger.error(`Failed to update user with id ${userId}:`, error);
    throw new Error('Failed to update user');
  }
});

export const updateUserRoles = withAuth(async (
  currentUser,
  { tenant },
  userId: string,
  roleIds: string[]
): Promise<void> => {
  try {
    const {knex: db} = await createTenantKnex();

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
});

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

export const registerClientUser = withAuth(async (
  currentUser,
  _ctx,
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> => {
  try {
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

      const [newUser] = await trx('users')
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
        user_id: newUser.user_id,
        role_id: clientRole.role_id,
        tenant: contact.tenant
      });

      return { success: true };
    });
  } catch (error) {
    logger.error('Error registering client user:', error);
    return { success: false, error: 'Failed to register user' };
  }
});

export const checkPasswordResetStatus = withOptionalAuth(async (
  currentUser,
  _ctx
): Promise<{ hasResetPassword: boolean }> => {
  try {
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
});

// New function for users to change their own password
export const changeOwnPassword = withAuth(async (
  currentUser,
  _ctx,
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> => {
  try {
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
});

// Function for admins to change user passwords
export const adminChangeUserPassword = withAuth(async (
  currentUser,
  _ctx,
  userId: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> => {
  try {
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
});

/**
 * Uploads or replaces a user's avatar.
 *
 * @param userId - The ID of the user whose avatar is being uploaded.
 * @param formData - The FormData containing the avatar file under the key 'avatar'.
 * @returns ActionResult indicating success or failure, with optional avatar URL.
 */
export const uploadUserAvatar = withAuth(async (
  currentUser,
  { tenant },
  userId: string,
  formData: FormData
): Promise<ActionResult & { avatarUrl?: string | null }> => {
  try {
    // Context is already set by withAuth
    const { knex } = await createTenantKnex();
    const targetUser = await User.get(knex, userId);

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
    } else if (isAdmin) {
        console.log(`[uploadUserAvatar] Admin user ${currentUser.user_id} updating avatar for user ${userId}`);
    } else {
        // Check permission within tenant context
        const hasUpdatePermission = await hasPermission(currentUser, 'user', 'update', knex);
        if (hasUpdatePermission) {
            console.log(`[uploadUserAvatar] User ${currentUser.user_id} with update permission updating avatar for user ${userId}`);
        } else {
            console.log(`[uploadUserAvatar] Permission denied: User ${currentUser.user_id} trying to update avatar for user ${userId}`);
            return { success: false, error: 'Permission denied: You can only update your own avatar.' };
        }
    }

    const file = formData.get('avatar') as File | null;

    if (!file) {
      return { success: false, error: 'No avatar file provided.' };
    }

    if (file.size === 0) {
        return { success: false, error: 'Avatar file cannot be empty.' };
    }

    // Call the generic service function - tenant context already set by withAuth
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
});


/**
 * Deletes a user's avatar.
 *
 * @param userId - The ID of the user whose avatar is being deleted.
 * @returns ActionResult indicating success or failure.
 */
export const deleteUserAvatar = withAuth(async (
  currentUser,
  { tenant },
  userId: string
): Promise<ActionResult> => {
  try {
    const { knex } = await createTenantKnex();
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

    // Call the generic service function - tenant context already set by withAuth
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
});
