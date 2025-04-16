'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { hashPassword } from 'server/src/utils/encryption/encryption';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { revalidatePath } from 'next/cache';
import { deleteDocument } from 'server/src/lib/actions/document-actions/documentActions';
import { getContactAvatarUrl } from 'server/src/lib/utils/avatarUtils';
import { v4 as uuidv4 } from 'uuid';
import Document from 'server/src/lib/models/document';
import DocumentAssociation from 'server/src/lib/models/document-association';
import { getCurrentUser, getUserRolesWithPermissions, getUserCompanyId } from 'server/src/lib/actions/user-actions/userActions';
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
): Promise<{ success: boolean; message?: string; logoUrl?: string | null }> {
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
    // Client users can only modify their own linked contact's avatar
    if (currentUser.contact_id === contactId) {
      canModify = true;
    }
  } else if (currentUser.user_type === 'msp') {
    // MSP users need appropriate permission
    try {
      // Get user roles with permissions
      const rolesWithPermissions = await getUserRolesWithPermissions(currentUser.user_id);
      
      // Check if user has MANAGE_CONTACTS permission
      canModify = rolesWithPermissions.some(role =>
        role.permissions.some(permission =>
          `${permission.resource}.${permission.action}` === 'contacts.manage' ||
          `${permission.resource}.${permission.action}` === 'contacts.update'
        )
      );
    } catch (error) {
      console.error('Error checking permissions:', error);
      return { success: false, message: 'Permission check failed' };
    }
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
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Upload file using StorageService with isImageAvatar flag for processing
    const externalFileRecord = await StorageService.uploadFile(
      tenant,
      fileBuffer,
      file.name,
      {
        mime_type: file.type,
        uploaded_by_id: currentUser.user_id,
        metadata: { context: 'contact_avatar', contactId: contactId },
        isImageAvatar: true // This flag enables image processing in StorageService
      }
    );

    if (!externalFileRecord?.file_id) {
      console.error('StorageService.uploadFile failed to return a valid external_files record:', externalFileRecord);
      throw new Error('File storage failed.');
    }

    // Create a corresponding 'documents' record
    const { typeId, isShared } = await getDocumentTypeId(file.type);
    const newDocumentId = uuidv4();

    const documentData = {
      document_name: file.name,
      type_id: isShared ? null : typeId,
      shared_type_id: isShared ? typeId : undefined,
      user_id: currentUser.user_id,
      order_number: 0,
      created_by: currentUser.user_id,
      tenant,
      file_id: externalFileRecord.file_id,
      storage_path: externalFileRecord.storage_path,
      mime_type: file.type,
      file_size: file.size,
    };

    const createdDocument = await Document.insert({
      ...documentData,
      document_id: newDocumentId
    });

    if (!createdDocument?.document_id) {
      console.error('Failed to create document record in documents table:', createdDocument);
      // Clean up the uploaded external file if document creation fails
      try {
        await StorageService.deleteFile(externalFileRecord.file_id, currentUser.user_id);
      } catch (deleteError) {
        console.error(`Failed to clean up external file ${externalFileRecord.file_id} after document creation failure:`, deleteError);
      }
      throw new Error('Failed to create document record.');
    }

    const finalDocumentId = createdDocument.document_id;

    // Update document association in the database using the new document_id
    let oldDocumentIdToDelete: string | null = null;
    console.log(`[uploadContactAvatar] Starting association update for new document: ${finalDocumentId}`);
    
    await knex.transaction(async (trx) => {
      // Find existing avatar association
      const existingAssociation = await trx('document_associations')
        .select('association_id', 'document_id')
        .where({
          entity_id: contactId,
          entity_type: 'contact',
          tenant: tenant,
        })
        .first();

      if (existingAssociation?.document_id) {
        oldDocumentIdToDelete = existingAssociation.document_id;
        console.log(`Removing previous avatar association within transaction: ${oldDocumentIdToDelete}`);

        // Delete only the association within the transaction
        await trx('document_associations')
          .where({
            entity_id: contactId,
            entity_type: 'contact',
            tenant: tenant,
            document_id: oldDocumentIdToDelete
          })
          .delete();
      }

      // Create new avatar association
      await DocumentAssociation.create({
        document_id: finalDocumentId,
        entity_id: contactId,
        entity_type: 'contact',
        tenant: tenant,
      });
    });
    console.log(`[uploadContactAvatar] Transaction committed for new association: ${finalDocumentId}`);

    // Delete the old document after the transaction has successfully committed
    if (oldDocumentIdToDelete) {
      console.log(`[uploadContactAvatar] Attempting to delete old document AFTER transaction: ${oldDocumentIdToDelete}`);
      try {
        // Call deleteDocument outside the transaction
        await deleteDocument(oldDocumentIdToDelete, currentUser.user_id);
        console.log(`[uploadContactAvatar] Successfully deleted old document: ${oldDocumentIdToDelete}`);
      } catch (deleteError) {
        console.error(`[uploadContactAvatar] Exception during deleteDocument for old document ${oldDocumentIdToDelete}:`, deleteError);
        // Log the error but continue, as the main goal (uploading new avatar) succeeded
      }
    }

    // Invalidate cache for relevant paths
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    // Generate the URL for the newly uploaded avatar
    const newAvatarUrl = await getContactAvatarUrl(contactId, tenant);
    console.log(`[uploadContactAvatar] Generated new avatar URL: ${newAvatarUrl}`);

    return { success: true, logoUrl: newAvatarUrl };
  } catch (error) {
    console.error('[uploadContactAvatar] Error during upload process:', error);
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
    if (currentUser.contact_id === contactId) {
      canDelete = true;
    }
  } else if (currentUser.user_type === 'msp') {
    try {
      // Get user roles with permissions
      const rolesWithPermissions = await getUserRolesWithPermissions(currentUser.user_id);
      
      // Check if user has MANAGE_CONTACTS permission
      canDelete = rolesWithPermissions.some(role =>
        role.permissions.some(permission =>
          `${permission.resource}.${permission.action}` === 'contacts.manage' ||
          `${permission.resource}.${permission.action}` === 'contacts.update'
        )
      );
    } catch (error) {
      console.error('Error checking permissions:', error);
      return { success: false, message: 'Permission check failed' };
    }
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
    // Find the association to get the document_id
    const association = await knex('document_associations')
      .select('association_id', 'document_id')
      .where({
        entity_id: contactId,
        entity_type: 'contact',
        tenant: tenant,
      })
      .first();

    if (association?.document_id) {
      const documentIdToDelete = association.document_id;
      console.log(`Attempting to delete document ${documentIdToDelete} associated with contact avatar for contact ${contactId}`);
      
      // Use the existing deleteDocument action which handles deleting the document record,
      // its associations, and the underlying file via deleteFile action.
      const deleteResult = await deleteDocument(documentIdToDelete, currentUser.user_id);
      
      if (!deleteResult.success) {
        // If deleteDocument failed, return its error message
        throw new Error(`Failed to delete associated document: ${documentIdToDelete}`);
      }
    } else {
      console.log(`No contact avatar association found for contact ${contactId} to delete.`);
      // If no association, consider it a success as there's nothing to remove
      return { success: true };
    }

    // Invalidate cache for relevant paths
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    return { success: true };
  } catch (error) {
    console.error('Error deleting contact avatar:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete contact avatar';
    return { success: false, message };
  }
}

/**
 * Helper function to get document type ID based on MIME type
 * This is a copy of the function from documentActions.ts to avoid circular dependencies
 */
async function getDocumentTypeId(mimeType: string): Promise<{ typeId: string, isShared: boolean }> {
  const { knex, tenant } = await createTenantKnex();

  // First try to find a tenant-specific type
  const tenantType = await knex('document_types')
    .where({ tenant, type_name: mimeType })
    .first();

  if (tenantType) {
    return { typeId: tenantType.type_id, isShared: false };
  }

  // Then try to find a shared type
  const sharedType = await knex('shared_document_types')
    .where({ type_name: mimeType })
    .first();

  if (sharedType) {
    return { typeId: sharedType.type_id, isShared: true };
  }

  // If no exact match, try to find a match for the general type (e.g., "image/*" for "image/png")
  const generalType = mimeType.split('/')[0] + '/*';

  // Check tenant-specific general type first
  const generalTenantType = await knex('document_types')
    .where({ tenant, type_name: generalType })
    .first();

  if (generalTenantType) {
    return { typeId: generalTenantType.type_id, isShared: false };
  }

  // Then check shared general type
  const generalSharedType = await knex('shared_document_types')
    .where({ type_name: generalType })
    .first();

  if (generalSharedType) {
    return { typeId: generalSharedType.type_id, isShared: true };
  }

  // If no match found, return the unknown type (application/octet-stream) from shared types
  const unknownType = await knex('shared_document_types')
    .where({ type_name: 'application/octet-stream' })
    .first();

  if (!unknownType) {
    throw new Error('Unknown document type not found in shared document types');
  }

  return { typeId: unknownType.type_id, isShared: true };
}
