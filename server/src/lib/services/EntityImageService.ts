import { StorageService } from 'server/src/lib/storage/StorageService';
import { deleteDocument, getDocumentTypeId } from 'server/src/lib/actions/document-actions/documentActions';
import { getEntityImageUrl } from 'server/src/lib/utils/avatarUtils';
import Document from 'server/src/lib/models/document';
import DocumentAssociation from 'server/src/lib/models/document-association';
import { createTenantKnex } from 'server/src/lib/db';
import { v4 as uuidv4 } from 'uuid';

export type EntityType = 'user' | 'contact' | 'company';

interface UploadResult {
  success: boolean;
  message?: string;
  imageUrl?: string | null;
}

/**
 * Generic function to upload an image for any entity type
 */
export async function uploadEntityImage(
  entityType: EntityType,
  entityId: string,
  file: File,
  userId: string,
  tenant: string,
  contextName?: string,
  isLogoUpload?: boolean
): Promise<UploadResult> {
  const { knex } = await createTenantKnex();
  
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

    const createdDocument = await Document.insert({
      ...documentData,
      document_id: newDocumentId
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
    
    await knex.transaction(async (trx) => {
      if (isLogoUpload) {
        // Step 1: Unconditionally unmark any existing logo for this entity.
        await trx('document_associations')
          .where({
            entity_id: entityId,
            entity_type: entityType,
            tenant: tenant,
            is_entity_logo: true,
          })
          .update({ is_entity_logo: false });
      }

      // Step 2: Create the new association, marking it as the logo if applicable.
      await trx('document_associations').insert({
        document_id: createdDocument.document_id,
        entity_id: entityId,
        entity_type: entityType,
        tenant,
        is_entity_logo: isLogoUpload || false,
      });
    });


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

/**
 * Generic function to delete an image for an entity type.
 * Note: This function might need refinement to specify *which* document to delete if multiple are associated,
 * e.g., by passing a document_id or association_id.
 * If deleting a logo, it should target the association with is_entity_logo = true.
 */
export async function deleteEntityImage(
  entityType: EntityType,
  entityId: string,
  userId: string,
  tenant: string,
  documentIdToDelete?: string
): Promise<{ success: boolean; message?: string }> {
  const { knex } = await createTenantKnex();
  
  try {
    let associationToDelete;

    if (documentIdToDelete) {
      associationToDelete = await knex('document_associations')
        .select('association_id', 'document_id')
        .where({
          document_id: documentIdToDelete,
          entity_id: entityId, // Ensure it's for the correct entity
          entity_type: entityType, // and type
          tenant: tenant
        })
        .first();
    } else {
      // If no specific document_id is provided, look for the entity's logo/avatar
      console.log(`[EntityImageService] deleteEntityImage called without specific documentIdToDelete for ${entityType} ${entityId}. Looking for entity logo/avatar.`);
      associationToDelete = await knex('document_associations')
        .select('association_id', 'document_id')
        .where({
          entity_id: entityId,
          entity_type: entityType,
          tenant: tenant,
          is_entity_logo: true  // Specifically look for the entity logo/avatar
        })
        .first();
    }

    if (!associationToDelete?.document_id) {
      return { success: true, message: `No ${entityType} image (or specified document) found to delete.` };
    }

    // deleteDocument action should handle deleting the document record and its file storage,
    // and also its associations.
    const deleteResult = await deleteDocument(associationToDelete.document_id, userId); 
    
    if (!deleteResult.success) {
      // deleteDocument should throw on error, but to be safe:
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
