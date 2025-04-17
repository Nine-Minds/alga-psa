
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
  contextName?: string // Optional context name override
): Promise<UploadResult> {
  const { knex } = await createTenantKnex();
  
  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const context = contextName || `${entityType}_image`;

    // Upload file using StorageService with isImageAvatar flag for consistent processing
    const externalFileRecord = await StorageService.uploadFile(
      tenant,
      fileBuffer,
      file.name,
      {
        mime_type: file.type,
        uploaded_by_id: userId,
        metadata: { context, entityId, entityType },
        isImageAvatar: true // Enable image processing for all entity types
      }
    );

    if (!externalFileRecord?.file_id) {
      throw new Error('File storage failed');
    }

    // Create document record
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
      // Clean up the uploaded file if document creation fails
      try {
        await StorageService.deleteFile(externalFileRecord.file_id, userId);
      } catch (deleteError) {
        console.error(`Failed to clean up file after document creation failure:`, deleteError);
      }
      throw new Error('Failed to create document record');
    }

    // Update document association using transaction
    let oldDocumentIdToDelete: string | null = null;
    
    await knex.transaction(async (trx) => {
      // Find existing association
      const existingAssociation = await trx('document_associations')
        .select('association_id', 'document_id')
        .where({
          entity_id: entityId,
          entity_type: entityType,
          tenant
        })
        .first();

      if (existingAssociation?.document_id) {
        oldDocumentIdToDelete = existingAssociation.document_id;
        
        // Delete only the association within the transaction
        await trx('document_associations')
          .where({
            entity_id: entityId,
            entity_type: entityType,
            tenant,
            document_id: oldDocumentIdToDelete
          })
          .delete();
      }

      // Create new association
      await DocumentAssociation.create({
        document_id: createdDocument.document_id,
        entity_id: entityId,
        entity_type: entityType,
        tenant
      });
    });

    // Delete old document after transaction completes
    if (oldDocumentIdToDelete) {
      try {
        await deleteDocument(oldDocumentIdToDelete, userId);
      } catch (deleteError) {
        console.error(`Error deleting old document:`, deleteError);
        // Continue since the main operation succeeded
      }
    }

    // Get the new image URL
    const imageUrl = await getEntityImageUrl(entityType, entityId, tenant);
    
    return { success: true, imageUrl };
  } catch (error) {
    console.error(`Error uploading ${entityType} image:`, error);
    const message = error instanceof Error ? error.message : `Failed to upload ${entityType} image`;
    return { success: false, message };
  }
}

/**
 * Generic function to delete an image for any entity type
 */
export async function deleteEntityImage(
  entityType: EntityType,
  entityId: string,
  userId: string,
  tenant: string
): Promise<{ success: boolean; message?: string }> {
  const { knex } = await createTenantKnex();
  
  try {
    // Find the association to get the document_id
    const association = await knex('document_associations')
      .select('association_id', 'document_id')
      .where({
        entity_id: entityId,
        entity_type: entityType,
        tenant
      })
      .first();

    if (!association?.document_id) {
      // No image to delete
      return { success: true, message: `No ${entityType} image found to delete.` };
    }

    // Call the generic deleteDocument action
    const deleteResult = await deleteDocument(association.document_id, userId);
    
    if (!deleteResult.success) {
      return { 
        success: false, 
        message: `Failed to delete ${entityType} image document.` // deleteDocument throws on error, no message property on success
      };
    }

    return { success: true, message: `${entityType} image deleted successfully.` };
  } catch (error) {
    console.error(`Error deleting ${entityType} image:`, error);
    const message = error instanceof Error ? error.message : `Failed to delete ${entityType} image`;
    return { success: false, message };
  }
}