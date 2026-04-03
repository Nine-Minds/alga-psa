import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getEntityImageUrl, type EntityType } from '@alga-psa/formatting/avatarUtils';
import { StorageService } from './StorageService';

export type { EntityType };

interface UploadResult {
  success: boolean;
  message?: string;
  imageUrl?: string | null;
}

function getImageFolderPath(entityType: EntityType): string {
  switch (entityType) {
    case 'client':
      return '/Clients/Logos';
    case 'team':
      return '/Teams/Logos';
    case 'tenant':
      return '/Logos';
    case 'user':
      return '/Users/Avatars';
    case 'contact':
      return '/Contacts/Avatars';
    default:
      return '/Avatars';
  }
}

function getImageFolderName(entityType: EntityType): string {
  switch (entityType) {
    case 'client':
    case 'team':
    case 'tenant':
      return 'Logos';
    case 'user':
    case 'contact':
      return 'Avatars';
    default:
      return 'Avatars';
  }
}

async function ensureImageFolder(
  trx: Knex.Transaction,
  tenant: string,
  entityType: EntityType,
  entityId: string,
): Promise<string> {
  const folderPath = getImageFolderPath(entityType);

  const existing = await trx('document_folders')
    .where({
      tenant,
      folder_path: folderPath,
      entity_id: entityId,
      entity_type: entityType,
    })
    .first();

  if (!existing) {
    await trx('document_folders').insert({
      tenant,
      folder_id: uuidv4(),
      folder_path: folderPath,
      folder_name: getImageFolderName(entityType),
      parent_folder_id: null,
      entity_id: entityId,
      entity_type: entityType,
      is_client_visible: false,
    });
  }

  return folderPath;
}

async function getDocumentTypeForMimeType(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  mimeType: string,
): Promise<{ typeId: string; isShared: boolean }> {
  const tenantType = await knexOrTrx('document_types')
    .where({ tenant, type_name: mimeType })
    .first();

  if (tenantType) {
    return { typeId: tenantType.type_id, isShared: false };
  }

  const sharedType = await knexOrTrx('shared_document_types')
    .where({ type_name: mimeType })
    .first();

  if (sharedType) {
    return { typeId: sharedType.type_id, isShared: true };
  }

  const generalType = `${mimeType.split('/')[0]}/*`;

  const generalTenantType = await knexOrTrx('document_types')
    .where({ tenant, type_name: generalType })
    .first();

  if (generalTenantType) {
    return { typeId: generalTenantType.type_id, isShared: false };
  }

  const generalSharedType = await knexOrTrx('shared_document_types')
    .where({ type_name: generalType })
    .first();

  if (generalSharedType) {
    return { typeId: generalSharedType.type_id, isShared: true };
  }

  const unknownType = await knexOrTrx('shared_document_types')
    .where({ type_name: 'application/octet-stream' })
    .first();

  if (!unknownType) {
    throw new Error('Unknown document type not found in shared document types');
  }

  return { typeId: unknownType.type_id, isShared: true };
}

async function deleteEntityImageDocument(
  knex: Knex,
  tenant: string,
  documentId: string,
  userId: string,
): Promise<boolean> {
  const document = await knex('documents')
    .where({ document_id: documentId, tenant })
    .first(['document_id', 'file_id', 'thumbnail_file_id', 'preview_file_id']);

  if (!document) {
    return false;
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx('document_associations')
      .where({ document_id: documentId, tenant })
      .delete();

    await trx('documents')
      .where({ document_id: documentId, tenant })
      .delete();
  });

  const fileIds = [document.file_id, document.thumbnail_file_id, document.preview_file_id]
    .filter((value): value is string => Boolean(value));

  await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        await StorageService.deleteFile(fileId, userId);
      } catch (error) {
        console.error('[EntityImageService] Failed to delete storage file for entity image', {
          tenant,
          documentId,
          fileId,
          userId,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    })
  );

  return true;
}

export async function uploadEntityImage(
  entityType: EntityType,
  entityId: string,
  file: File,
  userId: string,
  tenant: string,
  contextName?: string,
  isLogoUpload?: boolean,
): Promise<UploadResult> {
  const { knex } = await createTenantKnex(tenant);

  try {
    await StorageService.validateFileUpload(tenant, file.type, file.size);

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
        isImageAvatar: true,
      },
    );

    if (!externalFileRecord?.file_id) {
      throw new Error('File storage failed');
    }

    const { typeId, isShared } = await getDocumentTypeForMimeType(knex, tenant, file.type);
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
      let folderPath: string | undefined;

      try {
        folderPath = await ensureImageFolder(trx, tenant, entityType, entityId);
      } catch {
        folderPath = undefined;
      }

      const [document] = await trx('documents')
        .insert({ ...documentData, folder_path: folderPath })
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
        console.error('[EntityImageService] Failed to clean up orphaned storage file', {
          entityType,
          entityId,
          tenant,
          fileId: externalFileRecord.file_id,
          errorMessage: deleteError instanceof Error ? deleteError.message : 'Unknown error',
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
      errorName: error instanceof Error ? error.name : undefined,
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
  documentIdToDelete?: string,
): Promise<{ success: boolean; message?: string }> {
  const { knex } = await createTenantKnex(tenant);

  try {
    const associationToDelete = documentIdToDelete
      ? await knex('document_associations')
          .select('association_id', 'document_id')
          .where({
            document_id: documentIdToDelete,
            entity_id: entityId,
            entity_type: entityType,
            tenant,
          })
          .first()
      : await knex('document_associations')
          .select('association_id', 'document_id')
          .where({
            entity_id: entityId,
            entity_type: entityType,
            tenant,
            is_entity_logo: true,
          })
          .first();

    if (!associationToDelete?.document_id) {
      return { success: true, message: `No ${entityType} image (or specified document) found to delete.` };
    }

    const deleted = await deleteEntityImageDocument(knex, tenant, associationToDelete.document_id, userId);

    if (!deleted) {
      return {
        success: false,
        message: `Failed to delete ${entityType} image document.`,
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
      errorName: error instanceof Error ? error.name : undefined,
    });
    const message = error instanceof Error ? error.message : `Failed to delete ${entityType} image`;
    return { success: false, message };
  }
}
