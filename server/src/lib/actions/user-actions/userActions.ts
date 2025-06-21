'use server';

import User from 'server/src/lib/models/user';
import { IUser, IRole, IUserWithRoles, IRoleWithPermissions, IUserRole } from 'server/src/interfaces/auth.interfaces';
import { getServerSession } from "next-auth/next";
import { options as authOptions } from 'server/src/app/api/auth/[...nextauth]/options';
import { revalidatePath } from 'next/cache';
import { createTenantKnex } from 'server/src/lib/db';
import { getAdminConnection } from 'server/src/lib/db/admin';
import { withAdminTransaction, withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import Tenant from 'server/src/lib/models/tenant';
import UserPreferences from 'server/src/lib/models/userPreferences';
import { verifyEmailSuffix, getCompanyByEmailSuffix } from 'server/src/lib/actions/company-settings/emailSettings';
import { getUserAvatarUrl } from 'server/src/lib/utils/avatarUtils';
import { uploadEntityImage, deleteEntityImage } from 'server/src/lib/services/EntityImageService';
import { hasPermission } from 'server/src/lib/auth/rbac';

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
    console.error('Error checking email existence globally:', error);
    throw new Error('Failed to check email existence');
  }
}

export async function addUser(userData: { firstName: string; lastName: string; email: string, password: string, roleId?: string }): Promise<IUser> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const {knex: db, tenant} = await createTenantKnex();

    return await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'create', trx)) {
        throw new Error('Permission denied: Cannot create user');
      }

      if (!userData.roleId) {
        throw new Error("Role is required");
      }

      // Check if email already exists globally
      const emailExists = await checkEmailExistsGlobally(userData.email);
      if (emailExists) {
        throw new Error("A user with this email address already exists");
      }

      const [user] = await trx('users')
        .insert({
          first_name: userData.firstName,
          last_name: userData.lastName,
          email: userData.email.toLowerCase(), // Store email in lowercase for consistency
          username: userData.email.toLowerCase(),
          is_inactive: false,
          hashed_password: await hashPassword(userData.password),
          tenant: tenant || undefined
        }).returning('*');

      await trx('user_roles').insert({
        user_id: user.user_id,
        role_id: userData.roleId,
        tenant: tenant || undefined
      });

      revalidatePath('/settings');
      return user;
    });
  } catch (error: any) {
    console.error('Error adding user:', error);
    // Pass through the specific error message if it's about duplicate email
    if (error.message === "A user with this email address already exists") {
      throw error;
    }
    // Pass through permission denied errors
    if (error.message === "Permission denied: Cannot create user") {
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

    const {knex: db, tenant} = await createTenantKnex();

    await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'delete', trx)) {
        throw new Error('Permission denied: Cannot delete user');
      }

      const assignedCompany = await trx('companies')
        .where({ account_manager_id: userId, tenant: tenant || undefined })
        .first();

      if (assignedCompany) {
        throw new Error('Cannot delete user: Assigned as Account Manager to one or more companies. Please reassign first.');
      }

      // Set completed_by to NULL in workflow_tasks where the user is the completer
      await trx('workflow_tasks')
        .where({ completed_by: userId, tenant: tenant || undefined })
        .update({ completed_by: null });

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

    const {knex} = await createTenantKnex();
    console.log(`Fetching roles for user ID: ${user.user_id}`);
    const roles = await User.getUserRoles(knex, user.user_id);

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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const {knex} = await createTenantKnex();
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user');
      }

      const user = await User.getUserWithRoles(trx, id);
      return user || null;
    });
  } catch (error) {
    console.error(`Failed to find user with id ${id}:`, error);
    throw new Error('Failed to find user');
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

    const {knex} = await createTenantKnex();
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read users');
      }

      const users = await User.getAll(trx, includeInactive);
      const usersWithRoles = await Promise.all(users.map(async (user: IUser): Promise<IUserWithRoles> => {
        const roles = await User.getUserRoles(trx, user.user_id);
        return { ...user, roles };
      }));

      // Filter by tenant and optionally by user_type
      return usersWithRoles.filter(user =>
        user.tenant === tenant &&
        (userType ? user.user_type === userType : true)
      );
    });
  } catch (error) {
    console.error('Failed to fetch users:', error);
    throw new Error('Failed to fetch users');
  }
}

export async function updateUser(userId: string, userData: Partial<IUser>): Promise<IUserWithRoles | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx) => {
      if (!await hasPermission(currentUser, 'user', 'update', trx)) {
        throw new Error('Permission denied: Cannot update user');
      }
      
      await User.update(trx, userId, userData);
      const updatedUser = await User.getUserWithRoles(trx, userId);
      return updatedUser || null;
    });
  } catch (error) {
    console.error(`Failed to update user with id ${userId}:`, error);
    throw new Error('Failed to update user');
  }
}

export async function updateUserRoles(userId: string, roleIds: string[]): Promise<void> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const {knex: db, tenant} = await createTenantKnex();

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
    console.error(`Failed to update roles for user with id ${userId}:`, error);
    throw new Error('Failed to update user roles');
  }
}

export async function getUserRoles(userId: string, knexConnection?: Knex | Knex.Transaction): Promise<IRole[]> {
  try {
    let knex: Knex | Knex.Transaction;
    if (knexConnection) {
      knex = knexConnection;
    } else {
      const result = await createTenantKnex();
      knex = result.knex;
    }
    const roles = await User.getUserRoles(knex, userId);
    return roles;
  } catch (error) {
    console.error(`Failed to fetch roles for user with id ${userId}:`, error);
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
    console.error('Failed to fetch all roles:', error);
    throw new Error('Failed to fetch all roles');
  }
}

export async function getUserRolesWithPermissions(userId: string, knexConnection?: Knex | Knex.Transaction): Promise<IRoleWithPermissions[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    let knex: Knex | Knex.Transaction;
    if (knexConnection) {
      knex = knexConnection;
      // If we have a connection passed in, check permissions directly
      if (!await hasPermission(currentUser, 'user', 'read', knex)) {
        throw new Error('Permission denied: Cannot read user roles with permissions');
      }
      const rolesWithPermissions = await User.getUserRolesWithPermissions(knex, userId);
      return rolesWithPermissions;
    } else {
      const result = await createTenantKnex();
      knex = result.knex;
      
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        if (!await hasPermission(currentUser, 'user', 'read', trx)) {
          throw new Error('Permission denied: Cannot read user roles with permissions');
        }
        
        const rolesWithPermissions = await User.getUserRolesWithPermissions(trx, userId);
        return rolesWithPermissions;
      });
    }
  } catch (error) {
    console.error(`Failed to fetch roles with permissions for user with id ${userId}:`, error);
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
      console.log('No current user found, returning empty permissions.');
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

    console.log(`User ${currentUser.user_id} has permissions: ${Array.from(allPermissions).join(', ')}`);
    return Array.from(allPermissions);
  } catch (error) {
    console.error('Failed to get current user permissions:', error);
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

    const {knex} = await createTenantKnex();
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read user with roles');
      }

      const user = await User.getUserWithRoles(trx, userId);
      return user || null;
    });
  } catch (error) {
    console.error(`Failed to fetch user with roles for id ${userId}:`, error);
    throw new Error('Failed to fetch user with roles');
  }
}

export async function getMultipleUsersWithRoles(userIds: string[]): Promise<IUserWithRoles[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const {knex} = await createTenantKnex();
    
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read multiple users with roles');
      }

      const users = await Promise.all(userIds.map((id: string): Promise<IUserWithRoles | undefined> => User.getUserWithRoles(trx, id)));
      return users.filter((user): user is IUserWithRoles => user !== undefined);
    });
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

    const {knex} = await createTenantKnex();
    const preference = await UserPreferences.get(knex, userId, settingName);
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

    const {knex} = await createTenantKnex();
    await UserPreferences.upsert(knex, {
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
    const contact = await withAdminTransaction(async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .join('companies', function() {
          this.on('companies.company_id', '=', 'contacts.company_id')
              .andOn('companies.tenant', '=', 'contacts.tenant');
        })
        .where({ 'contacts.email': email })
        .select('contacts.contact_name_id', 'contacts.company_id', 'contacts.is_inactive', 'contacts.tenant')
        .first();
    });

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
      console.log('Creating new user record...');
      const hashedPassword = await hashPassword(password);
      console.log('Password hashed successfully');

      const [user] = await trx('users')
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
      let clientRole = await trx('roles')
        .where({ tenant: contact.tenant })
        .whereRaw('LOWER(role_name) = ?', ['client'])
        .first();

      if (!clientRole) {
        // If role doesn't exist, create it. This is a fallback.
        // The primary mechanism should be the migration.
        [clientRole] = await trx('roles')
          .insert({
            role_name: 'Client', // Store with capitalization
            description: 'Default client user role',
            tenant: contact.tenant
          })
          .returning('*');
      }

      // Assign the role to the user
      if (clientRole) {
        await trx('user_roles').insert({
          user_id: user.user_id,
          role_id: clientRole.role_id,
          tenant: contact.tenant
        });
      } else {
        // This case should ideally not be reached if the migration and fallback work.
        console.error(`Critical: Could not find or create a client role for tenant ${contact.tenant}`);
        throw new Error('Client role could not be assigned.');
      }

      return { success: true };
    });
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

    // Verify current password
    const isValidPassword = await User.verifyPassword(currentUser.user_id, currentPassword);
    if (!isValidPassword) {
      return { success: false, error: 'Current password is incorrect' };
    }

    // Hash the new password and update
    const hashedPassword = await hashPassword(newPassword);
    await User.updatePassword(currentUser.email, hashedPassword);

    return { success: true };
  } catch (error) {
    console.error('Error changing password:', error);
    return { success: false, error: 'Failed to change password' };
  }
}

// Function for admins to change user passwords
export async function getUserCompanyId(userId: string): Promise<string | null> {
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
        throw new Error('Permission denied: Cannot read user company ID');
      }

      const user = await User.get(trx, userId); // Use User.get which includes tenant context
      if (!user) return null;

      // First try to get company ID from contact if user is contact-based
      if (user.contact_id) {
        const contact = await trx('contacts')
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

      const emailSetting = await trx('company_email_settings')
        .where({
          email_suffix: emailDomain,
          tenant: tenant
        })
        .select('company_id')
        .first();

      return emailSetting?.company_id || null;
    });
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

    const {knex} = await createTenantKnex();
    const targetUser = await User.get(knex, userId); // Use existing User model

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
    console.log(`[uploadUserAvatar] New avatar URL: ${avatarUrl}`);

    return {
      success: true,
      message: 'Avatar uploaded successfully.',
      avatarUrl
    };

  } catch (error: any) {
    console.error('[UserActions] Failed to upload user avatar:', {
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
    console.error(`[UserActions] Failed to delete user avatar:`, {
      operation: 'deleteUserAvatar',
      userId,
      errorMessage: error.message || 'Unknown error',
      errorStack: error.stack,
      errorName: error.name
    });
    return { success: false, error: error.message || 'An unexpected error occurred while deleting the avatar.' };
  }
}

export async function getClientUsersForCompany(companyId: string): Promise<IUser[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get all users associated with the company
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (!await hasPermission(currentUser, 'user', 'read', trx)) {
        throw new Error('Permission denied: Cannot read client users for company');
      }

      const users = await trx('users')
        .join('contacts', function() {
          this.on('users.contact_id', '=', 'contacts.contact_name_id')
              .andOn('contacts.tenant', '=', trx.raw('?', [tenant]));
        })
        .where({
          'contacts.company_id': companyId,
          'users.tenant': tenant,
          'users.user_type': 'client'
        })
        .select('users.*');

      return users;
    });
  } catch (error) {
    console.error('Error getting client users:', error);
    throw error;
  }
}
