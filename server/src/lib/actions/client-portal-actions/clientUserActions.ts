'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import { IUser } from 'server/src/interfaces/auth.interfaces';;
import { revalidatePath } from 'next/cache';
import { getCurrentUser, getUserRolesWithPermissions, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
import { uploadEntityImage, deleteEntityImage } from 'server/src/lib/services/EntityImageService';
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

    const [updatedUser] = await knex('users')
      .where({ user_id: userId, tenant })
      .update({
        ...userData,
        updated_at: new Date().toISOString()
      })
      .returning('*');

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
    
    await knex('users')
      .where({ user_id: userId, tenant })
      .update(updateData);

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

    const user = await knex('users')
      .where({ user_id: userId, tenant, user_type: 'client' })
      .first();

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
  companyId,
  firstName,
  lastName
}: {
  email: string;
  password: string;
  contactId: string;
  companyId: string;
  firstName?: string;
  lastName?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get all roles for tenant and find client role (case-insensitive)
    const roles = await knex('roles').where({ tenant });
    const clientRole = roles.find(role => 
      role.role_name && role.role_name.toLowerCase().includes('client')
    );

    if (!clientRole) {
      throw new Error(`Client role not found among ${roles.length} tenant roles`);
    }

    // Hash the password
    const hashedPassword = await hashPassword(password);

    // Check if the password field exists in the users table
    const hasPasswordField = await knex.schema.hasColumn('users', 'password');
    const passwordField = hasPasswordField ? 'password' : 'hashed_password';
    
    console.log(`Using password field: ${passwordField}`);
    
    // Create the user with dynamic password field
    const userData: any = {
      tenant,
      email,
      username: email,
      contact_id: contactId,
      user_type: 'client',
      is_inactive: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // Add first and last name if provided
    if (firstName) userData.first_name = firstName;
    if (lastName) userData.last_name = lastName;
    
    userData[passwordField] = hashedPassword;
    
    const [user] = await knex('users')
      .insert(userData)
      .returning('*');

    // Assign the client role
    await knex('user_roles')
      .insert({
        user_id: user.user_id,
        role_id: clientRole.role_id,
        tenant
      });

    return { success: true };
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
      const userContact = await knex('contacts')
        .where({
          contact_name_id: contactId,
          tenant
        })
        .first();
      
      if (userContact) {
        // Check if there's a user with this contact_id
        const contactUser = await knex('users')
          .where({
            contact_id: contactId,
            user_id: currentUser.user_id,
            tenant
          })
          .first();
        
        if (contactUser) {
          canModify = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    // Internal users can modify any contact's avatar by default
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
  const contact = await knex('contacts')
    .where({ contact_name_id: contactId, tenant })
    .first();
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
      const userContact = await knex('contacts')
        .where({
          contact_name_id: contactId,
          tenant
        })
        .first();
      
      if (userContact) {
        // Check if there's a user with this contact_id
        const contactUser = await knex('users')
          .where({
            contact_id: contactId,
            user_id: currentUser.user_id,
            tenant
          })
          .first();
        
        if (contactUser) {
          canDelete = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    // Internal users can delete any contact's avatar by default
    console.log(`[deleteContactAvatar] Internal user ${currentUser.user_id} granted permission to delete contact avatar`);
    canDelete = true;
  }

  if (!canDelete) {
    return { success: false, message: 'You do not have permission to delete this contact\'s avatar' };
  }

  // Verify contact exists
  const contact = await knex('contacts')
    .where({ contact_name_id: contactId, tenant })
    .first();
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
