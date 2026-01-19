import { StorageService } from '@alga-psa/documents/storage/StorageService';
import { deleteDocument, getDocumentTypeId } from '@alga-psa/documents/actions/documentActions';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getEntityImageUrl, EntityType } from '../lib/avatarUtils';

interface UploadResult {
  success: boolean;
  message?: string;
  imageUrl?: string | null;
}

export async function uploadEntityImage(
  entityType: EntityType,
  entityId: string,
  file: File,
  userId: string,
  tenant: string,
  contextName?: string,
  isLogoUpload?: boolean
): Promise<UploadResult> {
  const { knex } = await createTenantKnex(tenant);

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const context = contextName || `${entityType}_image`;

    const externalFileRecord = await StorageService.uploadFile(
      tenant,
      fileBuffer,
      file.name,
      {
        mime_type: file.type,
        uploaded_by_id: userId,
        metadata: { context, entityId, entityType },
        isImageAvatar: true
      }
    );

    if (!externalFileRecord?.file_id) {
      throw new Error('File storage failed');
    }

    const { typeId, isShared } = await getDocumentTypeId(file.type);
    const newDocumentId = uuidv4();

    const documentData = {
      document_id: newDocumentId,
      document_name: file.name,
      type_id: isShared ? null : typeId,
      shared_type_id: isShared ? typeId : undefined,
      user_id: userId,
      order_number: 0,
      created_by: userId,
      tenant,
      file_id: externalFileRecord.file_id,
      storage_path: externalFileRecord.storage_path,
      mime_type: file.type,
      file_size: file.size,
    };

    const createdDocument = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const [document] = await trx('documents')
        .insert(documentData)
        .returning(['document_id']);

      if (!document?.document_id) {
        throw new Error('Failed to create document record');
      }

      if (isLogoUpload) {
        await trx('document_associations')
          .where({
            entity_id: entityId,
            entity_type: entityType,
            tenant,
            is_entity_logo: true,
          })
          .update({ is_entity_logo: false });
      }

      await trx('document_associations').insert({
        document_id: document.document_id,
        entity_id: entityId,
        entity_type: entityType,
        tenant,
        is_entity_logo: isLogoUpload || false,
      });

      return document;
    });

    if (!createdDocument?.document_id) {
      try {
        await StorageService.deleteFile(externalFileRecord.file_id, userId);
      } catch (deleteError) {
        console.error(`[EntityImageService] Failed to clean up file after document creation failure:`, {
          operation: 'cleanupAfterFailure',
          fileId: externalFileRecord.file_id,
          entityType,
          entityId,
          tenant,
          errorMessage: deleteError instanceof Error ? deleteError.message : 'Unknown error',
          errorStack: deleteError instanceof Error ? deleteError.stack : undefined,
          errorName: deleteError instanceof Error ? deleteError.name : undefined
        });
      }
      throw new Error('Failed to create document record');
    }

    const imageUrl = await getEntityImageUrl(entityType, entityId, tenant);

    return { success: true, imageUrl };
  } catch (error) {
    console.error(`[EntityImageService] Failed to upload image for ${entityType} (ID: ${entityId}):`, {
      operation: 'uploadEntityImage',
      entityType,
      entityId,
      tenant,
      fileName: file.name,
      fileSize: file.size,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    });
    const message = error instanceof Error ? error.message : `Failed to upload ${entityType} image`;
    return { success: false, message };
  }
}

export async function deleteEntityImage(
  entityType: EntityType,
  entityId: string,
  userId: string,
  tenant: string,
  documentIdToDelete?: string
): Promise<{ success: boolean; message?: string }> {
  const { knex } = await createTenantKnex(tenant);

  try {
    let associationToDelete;

    if (documentIdToDelete) {
      associationToDelete = await knex('document_associations')
        .select('association_id', 'document_id')
        .where({
          document_id: documentIdToDelete,
          entity_id: entityId,
          entity_type: entityType,
          tenant
        })
        .first();
    } else {
      associationToDelete = await knex('document_associations')
        .select('association_id', 'document_id')
        .where({
          entity_id: entityId,
          entity_type: entityType,
          tenant,
          is_entity_logo: true
        })
        .first();
    }

    if (!associationToDelete?.document_id) {
      return { success: true, message: `No ${entityType} image (or specified document) found to delete.` };
    }

    const deleteResult = await deleteDocument(associationToDelete.document_id, userId);

    if (!deleteResult.success) {
      return {
        success: false,
        message: `Failed to delete ${entityType} image document.`
      };
    }

    return { success: true, message: `${entityType} image deleted successfully.` };
  } catch (error) {
    console.error(`[EntityImageService] Failed to delete image for ${entityType} (ID: ${entityId}):`, {
      operation: 'deleteEntityImage',
      entityType,
      entityId,
      documentIdToDelete,
      tenant,
      userId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    });
    const message = error instanceof Error ? error.message : `Failed to delete ${entityType} image`;
    return { success: false, message };
  }
}

/**
 * Link an existing document as an entity's avatar/logo
 * Useful for reusing already-uploaded documents without duplicate uploads
 *
 * @param entityType - The type of entity (user, contact, client, tenant)
 * @param entityId - The ID of the entity
 * @param documentId - The ID of the existing document to link
 * @param userId - The user performing the action
 * @param tenant - The tenant ID
 * @returns UploadResult with success status and image URL
 */
export async function linkExistingDocumentAsEntityImage(
  entityType: EntityType,
  entityId: string,
  documentId: string,
  userId: string,
  tenant: string
): Promise<UploadResult> {
  const { knex } = await createTenantKnex(tenant);

  try {
    // Verify the document exists and is an image
    const document = await knex('documents')
      .where({ document_id: documentId, tenant })
      .first();

    if (!document) {
      return { success: false, message: 'Document not found' };
    }

    if (!document.mime_type?.startsWith('image/')) {
      return { success: false, message: 'Document must be an image' };
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Step 1: Unmark any existing logo/avatar for this entity
      await trx('document_associations')
        .where({
          entity_id: entityId,
          entity_type: entityType,
          tenant: tenant,
          is_entity_logo: true,
        })
        .update({ is_entity_logo: false });

      // Step 2: Check if an association already exists
      const existingAssociation = await trx('document_associations')
        .where({
          document_id: documentId,
          entity_id: entityId,
          entity_type: entityType,
          tenant,
        })
        .first();

      if (existingAssociation) {
        // Update existing association to mark as logo
        await trx('document_associations')
          .where({ association_id: existingAssociation.association_id })
          .update({ is_entity_logo: true });
      } else {
        // Create new association
        await trx('document_associations').insert({
          document_id: documentId,
          entity_id: entityId,
          entity_type: entityType,
          tenant,
          is_entity_logo: true,
        });
      }

      // Get the image URL for the response
      const imageUrl = await getEntityImageUrl(entityType, entityId, tenant);

      return {
        success: true,
        message: `Document linked as ${entityType} image successfully`,
        imageUrl,
      };
    });
  } catch (error) {
    console.error(`[EntityImageService] Failed to link document as ${entityType} image:`, {
      operation: 'linkExistingDocumentAsEntityImage',
      entityType,
      entityId,
      documentId,
      tenant,
      userId,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    const message = error instanceof Error ? error.message : `Failed to link document as ${entityType} image`;
    return { success: false, message };
  }
}

