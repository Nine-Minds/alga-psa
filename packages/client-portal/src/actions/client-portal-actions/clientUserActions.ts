'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';
import { revalidatePath } from 'next/cache';
import { getCurrentUser, getUserRolesWithPermissions, getUserClientId } from '@alga-psa/users/actions';
import { uploadEntityImage, deleteEntityImage } from '@alga-psa/media';
import { hasPermission } from '@alga-psa/auth';
import { getRoles, assignRoleToUser, removeRoleFromUser, getUserRoles } from '@alga-psa/auth/actions';
import { 
  createPortalUserInDB, 
  getClientPortalRoles as getClientPortalRolesFromDB,
  CreatePortalUserInput
} from '@shared/models/userModel';
import { IUser, IRole } from '@shared/interfaces/user.interfaces';

/**
 * Get available client portal roles
 */
export async function getClientPortalRoles(): Promise<IRole[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    
    return await getClientPortalRolesFromDB(knex, tenant);
  } catch (error) {
    console.error('Error fetching client portal roles:', error);
    return [];
  }
}

/**
 * Assign a role to a client user
 */
export async function assignClientUserRole(userId: string, roleId: string): Promise<void> {
  try {
    await assignRoleToUser(userId, roleId);
  } catch (error) {
    console.error('Error assigning role to client user:', error);
    throw error;
  }
}

/**
 * Remove a role from a client user
 */
export async function removeClientUserRole(userId: string, roleId: string): Promise<void> {
  try {
    await removeRoleFromUser(userId, roleId);
  } catch (error) {
    console.error('Error removing role from client user:', error);
    throw error;
  }
}

/**
 * Get roles for a specific client user
 */
export async function getClientUserRoles(userId: string): Promise<IRole[]> {
  try {
    return await getUserRoles(userId);
  } catch (error) {
    console.error('Error getting client user roles:', error);
    return [];
  }
}

/**
 * Update a client user
 */
export async function updateClientUser(
  userId: string,
  userData: Partial<IUser>
): Promise<IUser | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const [updatedUser] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('users')
      .where({ user_id: userId, tenant })
      .update({
        ...userData,
        updated_at: new Date().toISOString()
      })
      .returning('*');
    });

    return updatedUser || null;
  } catch (error) {
    console.error('Error updating client user:', error);
    throw error;
  }
}

/**
 * Reset client user password
 */
export async function resetClientUserPassword(
  userId: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Check if the password field exists in the users table
    const hasPasswordField = await knex.schema.hasColumn('users', 'password');
    const passwordField = hasPasswordField ? 'password' : 'hashed_password';
    
    console.log(`Using password field: ${passwordField}`);
    
    const hashedPassword = await hashPassword(newPassword);
    
    const updateData: any = {
      updated_at: new Date().toISOString()
    };
    updateData[passwordField] = hashedPassword;
    
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await trx('users')
      .where({ user_id: userId, tenant })
      .update(updateData);
    });

    return { success: true };
  } catch (error) {
    console.error('Error resetting client user password:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Get client user by ID
 */
export async function getClientUserById(userId: string): Promise<IUser | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const user = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('users')
      .where({ user_id: userId, tenant, user_type: 'client' })
      .first();
    });

    return user || null;
  } catch (error) {
    console.error('Error getting client user:', error);
    throw error;
  }
}

/**
 * Create a client user 
 */
export async function createClientUser({
  email,
  password,
  contactId,
  clientId,
  firstName,
  lastName,
  roleId
}: {
  email: string;
  password: string;
  contactId: string;
  clientId: string;
  firstName?: string;
  lastName?: string;
  roleId?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Enforce RBAC: require permission to create users
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { success: false, error: 'User not authenticated' };
    }
    const allowed = await hasPermission(currentUser, 'user', 'create', knex);
    if (!allowed) {
      return { success: false, error: 'Permission denied: Cannot create client user' };
    }

    // Use the shared model to create the portal user
    const input: CreatePortalUserInput = {
      email,
      password,
      contactId,
      clientId,
      tenantId: tenant,
      firstName,
      lastName,
      roleId
    };

    const result = await createPortalUserInDB(knex, input);
    
    // Revalidate paths after successful creation
    if (result.success) {
      revalidatePath('/client/settings/users');
      revalidatePath('/contacts');
    }

    return {
      success: result.success,
      error: result.error
    };
  } catch (error) {
    console.error('Error creating client user:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}


/**
 * Upload a contact avatar image
 *
 * Allows an authenticated client user to upload an avatar for their own linked contact record,
 * or an MSP user with appropriate permissions to manage contact avatars.
 */
export async function uploadContactAvatar(
  contactId: string,
  formData: FormData
): Promise<{ success: boolean; message?: string; imageUrl?: string | null }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, message: 'Tenant not found' };
  }

  // Get current user
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, message: 'User not authenticated' };
  }

  // Permission check
  let canModify = false;
  if (currentUser.user_type === 'client') {
    // For client users, we need to check if they're trying to modify their own contact's avatar
    // This can happen in two ways:
    // 1. The contactId matches their contact_id (direct match)
    // 2. They're trying to modify a contact that's associated with their user account
    if (currentUser.contact_id === contactId) {
      canModify = true;
    } else {
      // Check if this contact is associated with the current user
      const userContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('contacts')
          .where({
            contact_name_id: contactId,
            tenant
          })
          .first();
      });
      
      if (userContact) {
        // Check if there's a user with this contact_id
        const contactUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('users')
            .where({
              contact_id: contactId,
              user_id: currentUser.user_id,
              tenant
            })
            .first();
        });
        
        if (contactUser) {
          canModify = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    // MSP (internal) users can modify any contact's avatar by default
    console.log(`[uploadContactAvatar] Internal user ${currentUser.user_id} granted permission to modify contact avatar`);
    canModify = true;
  }

  if (!canModify) {
    return { success: false, message: 'You do not have permission to modify this contact\'s avatar' };
  }

  const file = formData.get('avatar') as File;
  if (!file) {
    return { success: false, message: 'No avatar file provided' };
  }

  // Verify contact exists
  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first();
  });
  if (!contact) {
    return { success: false, message: 'Contact not found' };
  }

  try {
    // Call the generic entity image upload service
    const uploadResult = await uploadEntityImage(
      'contact',
      contactId,
      file,
      currentUser.user_id,
      tenant,
      'contact_avatar',
      true
    );

    if (!uploadResult.success) {
      return { success: false, message: uploadResult.message || 'Failed to upload contact avatar' };
    }

    // Invalidate cache for relevant paths
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    // Generate the URL for the newly uploaded avatar
    return { success: true, imageUrl: uploadResult.imageUrl };
  } catch (error) {
    console.error('[ClientUserActions] Failed to upload contact avatar:', {
      operation: 'uploadContactAvatar',
      contactId,
      userId: currentUser.user_id,
      tenant,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    });
    const message = error instanceof Error ? error.message : 'Failed to upload contact avatar';
    return { success: false, message };
  }
}

/**
 * Delete a contact's avatar
 *
 * Allows an authenticated client user to delete the avatar for their own linked contact record,
 * or an MSP user with appropriate permissions to manage contact avatars.
 */
export async function deleteContactAvatar(
  contactId: string
): Promise<{ success: boolean; message?: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    return { success: false, message: 'Tenant not found' };
  }

  // Get current user
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return { success: false, message: 'User not authenticated' };
  }

  // Permission check
  let canDelete = false;
  if (currentUser.user_type === 'client') {
    // For client users, we need to check if they're trying to delete their own contact's avatar
    // This can happen in two ways:
    // 1. The contactId matches their contact_id (direct match)
    // 2. They're trying to delete a contact that's associated with their user account
    if (currentUser.contact_id === contactId) {
      canDelete = true;
    } else {
      // Check if this contact is associated with the current user
      const userContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('contacts')
          .where({
            contact_name_id: contactId,
            tenant
          })
          .first();
      });
      
      if (userContact) {
        // Check if there's a user with this contact_id
        const contactUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('users')
            .where({
              contact_id: contactId,
              user_id: currentUser.user_id,
              tenant
            })
            .first();
        });
        
        if (contactUser) {
          canDelete = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    // MSP (internal) users can delete any contact's avatar by default
    console.log(`[deleteContactAvatar] Internal user ${currentUser.user_id} granted permission to delete contact avatar`);
    canDelete = true;
  }

  if (!canDelete) {
    return { success: false, message: 'You do not have permission to delete this contact\'s avatar' };
  }

  // Verify contact exists
  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first();
  });
  if (!contact) {
    return { success: false, message: 'Contact not found' };
  }

  try {
    // Call the generic entity image delete service
    const deleteResult = await deleteEntityImage(
      'contact',
      contactId,
      currentUser.user_id,
      tenant
    );

    if (!deleteResult.success) {
      // The service function already logs errors, just return success: true if no image was found (as per original logic)
      // or if the deletion was successful. If it failed, the service returns success: false.
      // We return success: true here to match the original logic where finding no association was considered success.
      // The service handles the case where deletion fails internally.
      // Let's adjust slightly: if the service says success: false, we should probably return that.
      // If the service says success: true (meaning deleted or not found), we return success: true.
      // The original logic returned success: true if no association was found. deleteEntityImage returns success: true in that case too.
      // So, we just need to check if deleteResult.success is false.
       if (deleteResult.message && deleteResult.message.includes("No contact image found to delete")) {
         // If no image was found, it's considered a success in this context
         return { success: true };
       }
       // Otherwise, return the result from the service
       return { success: deleteResult.success, message: deleteResult.message };
    }

    // Invalidate cache for relevant paths
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    return { success: true };
  } catch (error) {
    console.error('[ClientUserActions] Failed to delete contact avatar:', {
      operation: 'deleteContactAvatar',
      contactId,
      userId: currentUser.user_id,
      tenant,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    });
    const message = error instanceof Error ? error.message : 'Failed to delete contact avatar';
    return { success: false, message };
  }
}

/**
 * Check client portal permissions for navigation
 * Returns permissions for billing, user management, client settings, and account
 */
export async function checkClientPortalPermissions(): Promise<{
  hasBillingAccess: boolean;
  hasUserManagementAccess: boolean;
  hasClientSettingsAccess: boolean;
  hasAccountAccess: boolean;
}> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return {
        hasBillingAccess: false,
        hasUserManagementAccess: false,
        hasClientSettingsAccess: false,
        hasAccountAccess: false
      };
    }

    const { knex } = await createTenantKnex();

    // Check if this is a hosted tenant (has Stripe customer record)
    const isHosted = await knex('stripe_customers')
      .where({ tenant: currentUser.tenant })
      .first()
      .then(result => !!result)
      .catch(() => false);

    // Check permissions using the hasPermission function from rbac
    const [hasBilling, hasUser, hasClient, hasSettings] = await Promise.all([
      hasPermission(currentUser, 'billing', 'read'),
      hasPermission(currentUser, 'user', 'read'),
      hasPermission(currentUser, 'client', 'read'),
      hasPermission(currentUser, 'settings', 'read')
    ]);

    return {
      hasBillingAccess: hasBilling,
      hasUserManagementAccess: hasUser,
      hasClientSettingsAccess: hasClient,
      // Account access requires both hosted tenant and settings permission
      hasAccountAccess: isHosted && hasSettings
    };
  } catch (error) {
    console.error('Error checking client portal permissions:', error);
    return {
      hasBillingAccess: false,
      hasUserManagementAccess: false,
      hasClientSettingsAccess: false,
      hasAccountAccess: false
    };
  }
}
