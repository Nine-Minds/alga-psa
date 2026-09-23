import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getEntityImageUrl, type EntityLogoVariant, type EntityType } from '@alga-psa/formatting/avatarUtils';
import { StorageService } from './StorageService';
import type { LogoCropRect } from './imageCrop';

export type { EntityLogoVariant, EntityType };

interface UploadResult {
  success: boolean;
  message?: string;
  imageUrl?: string | null;
  /** URL of the uncropped source written under `sourceVariant`, when one was. */
  sourceImageUrl?: string | null;
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

function tenantScopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

async function ensureImageFolder(
  trx: Knex.Transaction,
  tenant: string,
  entityType: EntityType,
  entityId: string,
): Promise<string> {
  const folderPath = getImageFolderPath(entityType);

  const existing = await tenantScopedTable(trx, 'document_folders', tenant)
    .where({
      folder_path: folderPath,
      entity_id: entityId,
      entity_type: entityType,
    })
    .first();

  if (!existing) {
    await tenantScopedTable(trx, 'document_folders', tenant).insert({
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
  const db = tenantDb(knexOrTrx, tenant);
  const tenantType = await tenantScopedTable(knexOrTrx, 'document_types', tenant)
    .where({ type_name: mimeType })
    .first();

  if (tenantType) {
    return { typeId: tenantType.type_id, isShared: false };
  }

  const sharedType = await db.table('shared_document_types')
    .where({ type_name: mimeType })
    .first();

  if (sharedType) {
    return { typeId: sharedType.type_id, isShared: true };
  }

  const generalType = `${mimeType.split('/')[0]}/*`;

  const generalTenantType = await tenantScopedTable(knexOrTrx, 'document_types', tenant)
    .where({ type_name: generalType })
    .first();

  if (generalTenantType) {
    return { typeId: generalTenantType.type_id, isShared: false };
  }

  const generalSharedType = await db.table('shared_document_types')
    .where({ type_name: generalType })
    .first();

  if (generalSharedType) {
    return { typeId: generalSharedType.type_id, isShared: true };
  }

  const unknownType = await db.table('shared_document_types')
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
  const document = await tenantScopedTable(knex, 'documents', tenant)
    .where({ document_id: documentId })
    .first(['document_id', 'file_id', 'thumbnail_file_id', 'preview_file_id']);

  if (!document) {
    return false;
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await tenantScopedTable(trx, 'document_associations', tenant)
      .where({ document_id: documentId })
      .delete();

    await tenantScopedTable(trx, 'documents', tenant)
      .where({ document_id: documentId })
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

export interface UploadEntityImageOptions {
  /**
   * Square zone to cut for `logoVariant`. The uploaded file is then the whole
   * wordmark and the variant stores only the chosen mark.
   */
  crop?: LogoCropRect;
  /**
   * Variant that keeps the uncropped upload alongside the mark (clients use
   * 'wide'). An upload without a crop replaces the mark alone and clears this
   * variant, so a stale wordmark never outlives the mark it was cut from.
   */
  sourceVariant?: EntityLogoVariant;
}

interface ImageBytes {
  buffer: Buffer;
  name: string;
  mimeType: string;
  size: number;
}

interface StoreVariantParams {
  knex: Knex;
  entityType: EntityType;
  entityId: string;
  userId: string;
  tenant: string;
  context: string;
  isLogoUpload: boolean;
  logoVariant: EntityLogoVariant;
  bytes: ImageBytes;
  processing: { isEntityLogo?: boolean; isFavicon?: boolean; cropRect?: LogoCropRect };
}

// "Logo.png" -> "Logo (mark).png" so the two documents tell apart in listings.
const markFileName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (mark)${name.slice(dot)}` : `${name} (mark)`;
};

/**
 * Stores one image variant end to end: processed file, document row, and the
 * logo association (unmarking the previous one for the same variant). Throws
 * on failure after cleaning up the orphaned file.
 */
async function storeEntityImageVariant({
  knex,
  entityType,
  entityId,
  userId,
  tenant,
  context,
  isLogoUpload,
  logoVariant,
  bytes,
  processing,
}: StoreVariantParams): Promise<string> {
  const externalFileRecord = await StorageService.uploadFile(
    tenant,
    bytes.buffer,
    bytes.name,
    {
      mime_type: bytes.mimeType,
      uploaded_by_id: userId,
      metadata: { context, entityId, entityType },
      isImageAvatar: true,
      // Logos preserve aspect ratio (avatars keep the square cover-crop). See
      // StorageService.uploadFile image-processing branch (alga0002162).
      isEntityLogo: processing.isEntityLogo || false,
      isFavicon: processing.isFavicon || false,
      cropRect: processing.cropRect,
    },
  );

  if (!externalFileRecord?.file_id) {
    throw new Error('File storage failed');
  }

  const { typeId, isShared } = await getDocumentTypeForMimeType(knex, tenant, bytes.mimeType);
  const newDocumentId = uuidv4();

  const documentData = {
    document_id: newDocumentId,
    document_name: bytes.name,
    type_id: isShared ? null : typeId,
    shared_type_id: isShared ? typeId : undefined,
    user_id: userId,
    order_number: 0,
    created_by: userId,
    tenant,
    file_id: externalFileRecord.file_id,
    storage_path: externalFileRecord.storage_path,
    mime_type: bytes.mimeType,
    file_size: bytes.size,
  };

  const createdDocument = await withTransaction(knex, async (trx: Knex.Transaction) => {
    let folderPath: string | undefined;

    try {
      folderPath = await ensureImageFolder(trx, tenant, entityType, entityId);
    } catch {
      folderPath = undefined;
    }

    const [document] = await tenantScopedTable(trx, 'documents', tenant)
      .insert({ ...documentData, folder_path: folderPath })
      .returning(['document_id']);

    if (!document?.document_id) {
      throw new Error('Failed to create document record');
    }

    if (isLogoUpload) {
      // Scoped to the same variant so uploading a dark logo never unmarks the
      // light one (and vice versa).
      await tenantScopedTable(trx, 'document_associations', tenant)
        .where({
          entity_id: entityId,
          entity_type: entityType,
          is_entity_logo: true,
          entity_logo_variant: logoVariant,
        })
        .update({ is_entity_logo: false });
    }

    await tenantScopedTable(trx, 'document_associations', tenant).insert({
      document_id: document.document_id,
      entity_id: entityId,
      entity_type: entityType,
      tenant,
      is_entity_logo: isLogoUpload,
      entity_logo_variant: logoVariant,
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

  return createdDocument.document_id;
}

export async function uploadEntityImage(
  entityType: EntityType,
  entityId: string,
  file: File,
  userId: string,
  tenant: string,
  contextName?: string,
  isLogoUpload?: boolean,
  logoVariant: EntityLogoVariant = 'default',
  options: UploadEntityImageOptions = {},
): Promise<UploadResult> {
  const { knex } = await createTenantKnex(tenant);

  try {
    await StorageService.validateFileUpload(tenant, file.type, file.size);

    const bytes: ImageBytes = {
      buffer: Buffer.from(await file.arrayBuffer()),
      name: file.name,
      mimeType: file.type,
      size: file.size,
    };
    const context = contextName || `${entityType}_image`;
    const { crop, sourceVariant } = options;
    const common = { knex, entityType, entityId, userId, tenant, context, isLogoUpload: isLogoUpload || false };

    if (sourceVariant && crop) {
      await storeEntityImageVariant({
        ...common,
        logoVariant: sourceVariant,
        bytes,
        processing: { isEntityLogo: true },
      });
    } else if (sourceVariant) {
      await deleteEntityImage(entityType, entityId, userId, tenant, undefined, sourceVariant);
    }

    await storeEntityImageVariant({
      ...common,
      logoVariant,
      bytes: crop ? { ...bytes, name: markFileName(bytes.name) } : bytes,
      processing: crop
        ? { cropRect: crop }
        : { isEntityLogo: isLogoUpload || false, isFavicon: logoVariant === 'favicon' },
    });

    const imageUrl = await getEntityImageUrl(entityType, entityId, tenant, logoVariant);
    const sourceImageUrl = sourceVariant && crop
      ? await getEntityImageUrl(entityType, entityId, tenant, sourceVariant)
      : undefined;

    return { success: true, imageUrl, sourceImageUrl };
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

export interface RecropEntityLogoParams {
  /** Variant holding the uncropped wordmark to cut from. */
  sourceVariant: EntityLogoVariant;
  /** Variant that receives the new square mark. */
  targetVariant: EntityLogoVariant;
  crop: LogoCropRect;
  contextName?: string;
}

/**
 * Cuts a new square mark out of an already stored logo, so the zone can be
 * adjusted later without re-uploading the file.
 */
export async function recropEntityLogo(
  entityType: EntityType,
  entityId: string,
  userId: string,
  tenant: string,
  { sourceVariant, targetVariant, crop, contextName }: RecropEntityLogoParams,
): Promise<UploadResult> {
  const { knex } = await createTenantKnex(tenant);

  try {
    const association = await tenantScopedTable(knex, 'document_associations', tenant)
      .select('document_id')
      .where({
        entity_id: entityId,
        entity_type: entityType,
        is_entity_logo: true,
        entity_logo_variant: sourceVariant,
      })
      .first();
    const document = association?.document_id
      ? await tenantScopedTable(knex, 'documents', tenant)
          .select('file_id', 'document_name', 'mime_type')
          .where({ document_id: association.document_id })
          .first()
      : null;

    if (!document?.file_id) {
      return { success: false, message: `No ${sourceVariant} logo to crop from.` };
    }

    const { buffer, metadata } = await StorageService.downloadFile(document.file_id);

    await storeEntityImageVariant({
      knex,
      entityType,
      entityId,
      userId,
      tenant,
      context: contextName || `${entityType}_image`,
      isLogoUpload: true,
      logoVariant: targetVariant,
      bytes: {
        buffer,
        name: markFileName(document.document_name || metadata.original_name),
        mimeType: document.mime_type || metadata.mime_type,
        size: buffer.length,
      },
      processing: { cropRect: crop },
    });

    const imageUrl = await getEntityImageUrl(entityType, entityId, tenant, targetVariant);
    return { success: true, imageUrl };
  } catch (error) {
    console.error(`[EntityImageService] Failed to recrop logo for ${entityType} (ID: ${entityId}):`, {
      operation: 'recropEntityLogo',
      entityType,
      entityId,
      tenant,
      sourceVariant,
      targetVariant,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    const message = error instanceof Error ? error.message : `Failed to update ${entityType} image`;
    return { success: false, message };
  }
}

export async function deleteEntityImage(
  entityType: EntityType,
  entityId: string,
  userId: string,
  tenant: string,
  documentIdToDelete?: string,
  logoVariant: EntityLogoVariant = 'default',
): Promise<{ success: boolean; message?: string }> {
  const { knex } = await createTenantKnex(tenant);

  try {
    const associationToDelete = documentIdToDelete
      ? await tenantScopedTable(knex, 'document_associations', tenant)
          .select('association_id', 'document_id')
          .where({
            document_id: documentIdToDelete,
            entity_id: entityId,
            entity_type: entityType,
          })
          .first()
      : await tenantScopedTable(knex, 'document_associations', tenant)
          .select('association_id', 'document_id')
          .where({
            entity_id: entityId,
            entity_type: entityType,
            is_entity_logo: true,
            entity_logo_variant: logoVariant,
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
