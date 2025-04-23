'use server';

import User from 'server/src/lib/models/user';
import { IUser, IRole, IUserWithRoles, IRoleWithPermissions, IUserRole } from 'server/src/interfaces/auth.interfaces';
import { getServerSession } from "next-auth/next";
import { options as authOptions } from 'server/src/app/api/auth/[...nextauth]/options';
import { revalidatePath } from 'next/cache';
import { createTenantKnex } from 'server/src/lib/db';
import { getAdminConnection } from 'server/src/lib/db/admin';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import Tenant from 'server/src/lib/models/tenant';
import UserPreferences from 'server/src/lib/models/userPreferences';
import { verifyEmailSuffix, getCompanyByEmailSuffix } from 'server/src/lib/actions/company-settings/emailSettings';
import { getUserAvatarUrl } from 'server/src/lib/utils/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from 'server/src/lib/services/EntityImageService'; // Added import

interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export async function addUser(userData: { firstName: string; lastName: string; email: string, password: string, roleId?: string }): Promise<IUser> {
  try {
    const {knex: db, tenant} = await createTenantKnex();

    if (!userData.roleId) {
      throw new Error("Role is required");
    }

    const newUser = await db.transaction(async (trx) => {
      const [user] = await trx('users')
        .insert({
          first_name: userData.firstName,
          last_name: userData.lastName,
          email: userData.email,
          username: userData.email,
          is_inactive: false,
          hashed_password: await hashPassword(userData.password),
          tenant: tenant || undefined
        }).returning('*');

      await trx('user_roles').insert({
        user_id: user.user_id,
        role_id: userData.roleId,
        tenant: tenant || undefined
      });

      return user;
    });

    revalidatePath('/settings');
    return newUser;
  } catch (error) {
    console.error('Error adding user:', error);
    throw new Error('Failed to add user');
  }
}

export async function deleteUser(userId: string): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();

    const assignedCompany = await db('companies')
      .where({ account_manager_id: userId, tenant: tenant || undefined })
      .first();

    if (assignedCompany) {
      throw new Error('Cannot delete user: Assigned as Account Manager to one or more companies. Please reassign first.');
    }

    await db.transaction(async (trx) => {
      // Delete user roles
      await trx('user_roles').where({ user_id: userId, tenant: tenant || undefined }).del();

      // Delete user
      await trx('users').where({ user_id: userId, tenant: tenant || undefined }).del();
    });

    revalidatePath('/settings');
  } catch (error) {
    console.error('Error deleting user:', error);
    throw new Error('Failed to delete user');
  }
}

export async function getCurrentUser(): Promise<IUserWithRoles | null> {
  try {
    console.log('Getting current user from session');
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      console.log('No user email found in session');
      return null;
    }

    console.log(`Looking up user by email: ${session.user.email}`);
    const user = await User.findUserByEmail(session.user.email);

    if (!user) {
      console.log(`User not found for email: ${session.user.email}`);
      return null;
    }

    console.log(`Fetching roles for user ID: ${user.user_id}`);
    const roles = await User.getUserRoles(user.user_id);

    const avatarUrl = await getUserAvatarUrl(user.user_id, user.tenant);

    console.log(`Current user retrieved successfully: ${user.user_id} with ${roles.length} roles`);
    return { ...user, roles, avatarUrl };
  } catch (error) {
    console.error('Failed to get current user:', error);
    throw new Error('Failed to get current user');
  }
}

export async function findUserById(id: string): Promise<IUserWithRoles | null> {
  try {
    const user = await User.getUserWithRoles(id);
    return user || null;
  } catch (error) {
    console.error(`Failed to find user with id ${id}:`, error);
    throw new Error('Failed to find user');
  }
}

export async function getAllUsers(includeInactive: boolean = true): Promise<IUserWithRoles[]> {
  try {
    const currentUser = await getCurrentUser();
    const tenant = currentUser?.tenant;

    if (!tenant) {
      throw new Error('Tenant is required');
    }

    const users = await User.getAll(includeInactive);
    const usersWithRoles = await Promise.all(users.map(async (user: IUser): Promise<IUserWithRoles> => {
      const roles = await User.getUserRoles(user.user_id);
      return { ...user, roles };
    }));

    return usersWithRoles.filter(user => user.tenant === tenant);
  } catch (error) {
    console.error('Failed to fetch users:', error);
    throw new Error('Failed to fetch users');
  }
}

export async function updateUser(userId: string, userData: Partial<IUser>): Promise<IUserWithRoles | null> {
  try {
    await User.update(userId, userData);
    const updatedUser = await User.getUserWithRoles(userId);
    return updatedUser || null;
  } catch (error) {
    console.error(`Failed to update user with id ${userId}:`, error);
    throw new Error('Failed to update user');
  }
}

export async function updateUserRoles(userId: string, roleIds: string[]): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();

    await db.transaction(async (trx) => {
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
    console.error(`Failed to update roles for user with id ${userId}:`, error);
    throw new Error('Failed to update user roles');
  }
}

export async function getUserRoles(userId: string): Promise<IRole[]> {
  try {
    const roles = await User.getUserRoles(userId);
    return roles;
  } catch (error) {
    console.error(`Failed to fetch roles for user with id ${userId}:`, error);
    throw new Error('Failed to fetch user roles');
  }
}

export async function getAllRoles(): Promise<IRole[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    const roles = await db('roles')
      .where({ tenant: tenant || undefined })
      .select('*');
    return roles;
  } catch (error) {
    console.error('Failed to fetch all roles:', error);
    throw new Error('Failed to fetch all roles');
  }
}

export async function getUserRolesWithPermissions(userId: string): Promise<IRoleWithPermissions[]> {
  try {
    const rolesWithPermissions = await User.getUserRolesWithPermissions(userId);
    return rolesWithPermissions;
  } catch (error) {
    console.error(`Failed to fetch roles with permissions for user with id ${userId}:`, error);
    throw new Error('Failed to fetch user roles with permissions');
  }
}

export async function getUserWithRoles(userId: string): Promise<IUserWithRoles | null> {
  try {
    const user = await User.getUserWithRoles(userId);
    return user || null;
  } catch (error) {
    console.error(`Failed to fetch user with roles for id ${userId}:`, error);
    throw new Error('Failed to fetch user with roles');
  }
}

export async function getMultipleUsersWithRoles(userIds: string[]): Promise<IUserWithRoles[]> {
  try {
    const users = await Promise.all(userIds.map((id: string): Promise<IUserWithRoles | undefined> => User.getUserWithRoles(id)));
    return users.filter((user): user is IUserWithRoles => user !== undefined);
  } catch (error) {
    console.error('Failed to fetch multiple users with roles:', error);
    throw new Error('Failed to fetch multiple users with roles');
  }
}

// User Preferences Actions
export async function getUserPreference(userId: string, settingName: string): Promise<any> {
  try {
    const currentUser = await getCurrentUser();
    const tenant = currentUser?.tenant;
    if (!tenant) throw new Error('Tenant is required');

    const preference = await UserPreferences.get(tenant, userId, settingName);
    if (!preference?.setting_value) return null;

    try {
      // Try to parse the JSON value
      return JSON.parse(preference.setting_value);
    } catch (e) {
      // If parsing fails, return the raw value
      return preference.setting_value;
    }
  } catch (error) {
    console.error('Failed to get user preference:', error);
    throw new Error('Failed to get user preference');
  }
}

export async function setUserPreference(userId: string, settingName: string, settingValue: any): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    const tenant = currentUser?.tenant;
    if (!tenant) throw new Error('Tenant is required');

    // Convert the value to a JSON string
    const jsonValue = JSON.stringify(settingValue);

    await UserPreferences.upsert({
      tenant,
      user_id: userId,
      setting_name: settingName,
      setting_value: jsonValue,
      updated_at: new Date()
    });
  } catch (error) {
    console.error('Failed to set user preference:', error);
    throw new Error('Failed to set user preference');
  }
}

export async function verifyContactEmail(email: string): Promise<{ exists: boolean; isActive: boolean; companyId?: string; tenant?: string }> {
  try {
    // First check if email matches any company email suffixes
    const isValidSuffix = await verifyEmailSuffix(email);
    if (isValidSuffix) {
      const result = await getCompanyByEmailSuffix(email);
      if (result) {
        return {
          exists: false, // Not a contact, but valid email suffix
          isActive: true,
          companyId: result.companyId,
          tenant: result.tenant
        };
      }
    }

    // If not a valid suffix, check contacts
    const db = await getAdminConnection();
    const contact = await db('contacts')
      .join('companies', function() {
        this.on('companies.company_id', '=', 'contacts.company_id')
            .andOn('companies.tenant', '=', 'contacts.tenant');
      })
      .where({ 'contacts.email': email })
      .select('contacts.contact_name_id', 'contacts.company_id', 'contacts.is_inactive', 'contacts.tenant')
      .first();

    if (!contact) {
      return { exists: false, isActive: false };
    }

    return {
      exists: true,
      isActive: !contact.is_inactive,
      companyId: contact.company_id,
      tenant: contact.tenant
    };
  } catch (error) {
    console.error('Failed to verify contact email:', error);
    throw new Error('Failed to verify contact email');
  }
}

export async function registerClientUser(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getAdminConnection();

    // First verify the contact exists and get their tenant
    const contact = await db('contacts')
      .join('companies', function() {
        this.on('companies.company_id', '=', 'contacts.company_id')
            .andOn('companies.tenant', '=', 'contacts.tenant');
      })
      .where({ 'contacts.email': email })
      .select(
        'contacts.contact_name_id',
        'contacts.company_id',
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

    // Check if user already exists
    const existingUser = await db('users')
      .where({ email })
      .first();

    if (existingUser) {
      return { success: false, error: 'User with this email already exists' };
    }

    // Split full name into first and last name
    const nameParts = contact.full_name.trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Create the user with client user type
    console.log('Creating new user record...');
    const hashedPassword = await hashPassword(password);
    console.log('Password hashed successfully');

    const [user] = await db('users')
      .insert({
        email,
        username: email,
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

    // Get the default client role
    const [clientRole] = await db('roles')
      .where({ role_name: 'client', tenant: contact.tenant })
      .returning('*');

    if (!clientRole) {
      // Create default client role if it doesn't exist
      const [newRole] = await db('roles')
        .insert({
          role_name: 'client',
          description: 'Default client user role',
          tenant: contact.tenant
        })
        .returning('*');

      // Assign the new role to the user
      await db('user_roles').insert({
        user_id: user.user_id,
        role_id: newRole.role_id,
        tenant: contact.tenant
      });
    } else {
      // Assign existing client role to the user
      await db('user_roles').insert({
        user_id: user.user_id,
        role_id: clientRole.role_id,
        tenant: contact.tenant
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Error registering client user:', error);
    return { success: false, error: 'Failed to register user' };
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

    // Verify current password using the User model's verifyPassword method
    const isCurrentPasswordValid = await User.verifyPassword(currentUser.user_id, currentPassword);
    if (!isCurrentPasswordValid) {
      return { success: false, error: 'Current password is incorrect' };
    }

    // Update password using the User model's updatePassword method
    await User.updatePassword(currentUser.email, await hashPassword(newPassword));

    return { success: true };
  } catch (error) {
    console.error('Error changing password:', error);
    return { success: false, error: 'Failed to change password' };
  }
}

// Function for admins to change user passwords
export async function getUserCompanyId(userId: string): Promise<string | null> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await User.get(userId); // Use User.get which includes tenant context
    if (!user) return null;

    // First try to get company ID from contact if user is contact-based
    if (user.contact_id) {
      const contact = await db('contacts')
        .where({
          contact_name_id: user.contact_id,
          tenant: tenant
        })
        .select('company_id')
        .first();

      if (contact?.company_id) {
        return contact.company_id;
      }
    }

    // If no contact or no company found, try to get company from user's email domain
    const emailDomain = user.email.split('@')[1];
    if (!emailDomain) return null;

    const emailSetting = await db('company_email_settings')
      .where({
        email_suffix: emailDomain,
        tenant: tenant
      })
      .select('company_id')
      .first();

    return emailSetting?.company_id || null;
  } catch (error) {
    console.error('Error getting user company ID:', error);
    throw new Error('Failed to get user company ID');
  }
}

/**
 * Gets the contact_id for a user, which is needed for fetching contact avatars
 * @param userId The user ID to get the contact_id for
 * @returns The contact_id if found, null otherwise
 */
export async function getUserContactId(userId: string): Promise<string | null> {
  try {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await db('users')
      .where({
        user_id: userId,
        tenant: tenant
      })
      .select('contact_id')
      .first();

    return user?.contact_id || null;
  } catch (error) {
    console.error('Error getting user contact ID:', error);
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

    // Get the user to verify they're in the same tenant
    const targetUser = await User.get(userId);
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

    // Update password using the User model's updatePassword method
    await User.updatePassword(targetUser.email, await hashPassword(newPassword));

    return { success: true };
  } catch (error) {
    console.error('Error changing user password:', error);
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

    const targetUser = await User.get(userId); // Use existing User model

    if (!targetUser) {
      return { success: false, error: 'Target user not found.' };
    }

    // Ensure users are in the same tenant
    if (targetUser.tenant !== currentUser.tenant) {
        return { success: false, error: 'Permission denied: Cannot modify user in different tenant.' };
    }

    // Permission Check: User can update their own avatar OR an admin can update any avatar
    const isAdmin = currentUser.roles.some(role => role.role_name.toLowerCase() === 'admin');
    const canUpdate = currentUser.user_id === userId || isAdmin;

    if (!canUpdate) {
        return { success: false, error: 'Permission denied.' };
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
      'user_avatar' // Optional context name
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
    console.log(`[uploadUserAvatar] New avatar URL: ${avatarUrl}`);

    return {
      success: true,
      message: 'Avatar uploaded successfully.',
      avatarUrl
    };

  } catch (error: any) {
    console.error('Error uploading user avatar:', error);
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

    const targetUser = await User.get(userId);

    if (!targetUser) {
      return { success: false, error: 'Target user not found.' };
    }

    // Ensure users are in the same tenant
    if (targetUser.tenant !== currentUser.tenant) {
        return { success: false, error: 'Permission denied: Cannot modify user in different tenant.' };
    }

    // Permission Check: User can delete their own avatar OR an admin can delete any avatar
    const isAdmin = currentUser.roles.some(role => role.role_name.toLowerCase() === 'admin');
    const canDelete = currentUser.user_id === userId || isAdmin;

    if (!canDelete) {
        return { success: false, error: 'Permission denied.' };
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
    console.error(`Error deleting user avatar for user ${userId}:`, error);
    return { success: false, error: error.message || 'An unexpected error occurred while deleting the avatar.' };
  }
}

export async function getClientUsersForCompany(companyId: string): Promise<IUser[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get all users associated with the company
    const users = await knex('users')
      .join('contacts', function() {
        this.on('users.contact_id', '=', 'contacts.contact_name_id')
            .andOn('contacts.tenant', '=', knex.raw('?', [tenant]));
      })
      .where({
        'contacts.company_id': companyId,
        'users.tenant': tenant,
        'users.user_type': 'client'
      })
      .select('users.*');

    return users;
  } catch (error) {
    console.error('Error getting client users:', error);
    throw error;
  }
}
