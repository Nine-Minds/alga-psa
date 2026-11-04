/**
 * The single upload core for REST/MCP document attachments.
 *
 * Takes bytes that are already in memory (multipart read, base64 decode or URL
 * fetch -- not this module's concern) and owns everything after that:
 * validation, storage, document type, the transaction, rollback cleanup,
 * previews, and events. `StorageService.validateFileUpload` runs here and
 * nowhere else for these paths.
 */
// LEVERAGE: pattern document-upload-core — packages/documents uploadDocument (web UI action) keeps its own copy of this pipeline; migrate it onto attachDocumentFromBytes later
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { generateDocumentPreviews } from '@alga-psa/documents/lib/documentPreviewGenerator';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildDocumentAssociatedPayload } from '@alga-psa/workflow-streams';
import type { IDocument } from 'server/src/interfaces/document.interface';
import { ConflictError, ValidationError } from '../../middleware/apiMiddleware';
import { ENTITY_ADAPTERS, type AttachHookOptions, type AttachableEntityType } from './entityAdapters';

export interface AttachDocumentInput {
  knex: Knex;
  tenant: string;
  actorUserId: string;
  target: { entityType: AttachableEntityType; entityId: string };
  file: { fileName: string; mimeType: string; bytes: Buffer };
  /** Where the bytes came from; used only in log lines. */
  source: 'multipart' | 'url' | 'base64';
  options?: AttachHookOptions;
  /** Read-model loader for the returned document (a service may return its own enriched shape). */
  loadDocument?: (documentId: string) => Promise<IDocument | null>;
}

/** Map storage-validator failures to a 400 on path `file`; anything else is unexpected. */
function uploadValidationMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.message.startsWith('File size exceeds limit') || error.message === 'File type not allowed') {
    return error.message;
  }
  return null;
}

export async function resolveDocumentTypeId(
  knex: Knex,
  tenant: string,
  mimeType: string,
): Promise<{ typeId: string; isShared: boolean }> {
  const db = tenantDb(knex, tenant);

  const tenantType = await db.table('document_types').where({ type_name: mimeType }).first();
  if (tenantType) return { typeId: tenantType.type_id, isShared: false };

  const sharedType = await db.table('shared_document_types').where({ type_name: mimeType }).first();
  if (sharedType) return { typeId: sharedType.type_id, isShared: true };

  const generalType = `${mimeType.split('/')[0]}/*`;

  const generalTenantType = await db.table('document_types').where({ type_name: generalType }).first();
  if (generalTenantType) return { typeId: generalTenantType.type_id, isShared: false };

  const generalSharedType = await db.table('shared_document_types').where({ type_name: generalType }).first();
  if (generalSharedType) return { typeId: generalSharedType.type_id, isShared: true };

  const unknownType = await db
    .table('shared_document_types')
    .where({ type_name: 'application/octet-stream' })
    .first();
  if (!unknownType) {
    throw new ConflictError('Unknown document type not found in shared document types');
  }
  return { typeId: unknownType.type_id, isShared: true };
}

/** Generate and persist thumbnail/preview files. Never throws: previews are best-effort. */
export async function persistDocumentPreviews(
  knex: Knex,
  document: IDocument,
  buffer: Buffer,
  tenant: string,
) {
  try {
    const result = await generateDocumentPreviews(document, buffer);
    await tenantDb(knex, tenant)
      .table('documents')
      .where({ document_id: document.document_id })
      .update({
        thumbnail_file_id: result.thumbnail_file_id,
        preview_file_id: result.preview_file_id,
        preview_generated_at: result.preview_generated_at,
      });
    return result;
  } catch (error) {
    console.error(`[documents] Preview generation failed for document ${document.document_id}:`, error);
    return null;
  }
}

async function loadDocument(knex: Knex, tenant: string, documentId: string): Promise<IDocument | null> {
  const db = tenantDb(knex, tenant);
  const query = db.table('documents as d');
  db.tenantJoin(query, 'users as u', 'd.created_by', 'u.user_id', { type: 'left' });
  db.tenantJoin(query, 'document_types as dt', 'd.type_id', 'dt.type_id', { type: 'left' });
  const document = await query
    .leftJoin('shared_document_types as sdt', 'd.shared_type_id', 'sdt.type_id')
    .where({ 'd.document_id': documentId })
    .select(
      'd.*',
      knex.raw("CONCAT(u.first_name, ' ', u.last_name) as created_by_full_name"),
      knex.raw('COALESCE(dt.type_name, sdt.type_name) as type_name'),
      knex.raw('COALESCE(dt.icon, sdt.icon) as type_icon'),
    )
    .first();
  return (document as IDocument | undefined) ?? null;
}

async function publishAfterCommit(
  tenant: string,
  actorUserId: string,
  associationId: string,
  document: IDocument,
  target: AttachDocumentInput['target'],
): Promise<void> {
  const occurredAt = new Date().toISOString();
  try {
    await publishWorkflowEvent({
      eventType: 'DOCUMENT_ASSOCIATED',
      payload: buildDocumentAssociatedPayload({
        documentId: document.document_id,
        entityType: target.entityType,
        entityId: target.entityId,
        associatedByUserId: actorUserId,
        associatedAt: occurredAt,
      }),
      ctx: { tenantId: tenant, occurredAt, actor: { actorType: 'USER', actorUserId } },
      idempotencyKey: `document_associated:${associationId}`,
    });
  } catch (eventError) {
    console.error('[documents] Failed to publish DOCUMENT_ASSOCIATED workflow event:', eventError);
  }

  try {
    await publishEvent({
      eventType: 'DOCUMENT_UPDATED',
      payload: {
        tenantId: tenant,
        occurredAt,
        documentId: document.document_id,
        updatedByUserId: actorUserId,
        updatedAt: occurredAt,
        changedFields: ['document_name', 'file_id', 'storage_path'],
      },
    });
  } catch (eventError) {
    console.error('[documents] Failed to publish DOCUMENT_UPDATED search event:', eventError);
  }
}

export async function attachDocumentFromBytes(input: AttachDocumentInput): Promise<IDocument> {
  const { knex, tenant, actorUserId, target, file } = input;
  const options = input.options ?? {};
  const adapter = ENTITY_ADAPTERS[target.entityType];

  try {
    await StorageService.validateFileUpload(tenant, file.mimeType, file.bytes.length);
  } catch (error) {
    const message = uploadValidationMessage(error);
    if (message) {
      throw new ValidationError('Validation failed', [{ path: ['file'], message }]);
    }
    throw error;
  }

  const uploadResult = await StorageService.uploadFile(tenant, file.bytes, file.fileName, {
    mime_type: file.mimeType,
    uploaded_by_id: actorUserId,
  });

  const documentId = uuidv4();
  const associationId = uuidv4();
  let document: IDocument;

  try {
    const folderPath = await adapter.resolveFolder(knex, tenant, target.entityId);
    const typeResult = await resolveDocumentTypeId(knex, tenant, file.mimeType);
    document = {
      document_id: documentId,
      document_name: file.fileName,
      type_id: typeResult.isShared ? null : typeResult.typeId,
      shared_type_id: typeResult.isShared ? typeResult.typeId : undefined,
      user_id: actorUserId,
      order_number: 0,
      created_by: actorUserId,
      tenant,
      file_id: uploadResult.file_id,
      storage_path: uploadResult.storage_path,
      mime_type: file.mimeType,
      file_size: file.bytes.length,
      folder_path: folderPath,
      ...(adapter.documentOverrides?.(options) ?? {}),
    };

    await withTransaction(knex, async (trx) => {
      await tenantDb(trx, tenant).table('documents').insert(document);
      await tenantDb(trx, tenant).table('document_associations').insert({
        association_id: associationId,
        document_id: documentId,
        entity_id: target.entityId,
        entity_type: target.entityType,
        tenant,
      });
      await adapter.inTransaction?.({
        trx,
        tenant,
        actorUserId,
        entityId: target.entityId,
        document,
        options,
      });
    });
  } catch (error) {
    // Nothing referenced the stored file (the transaction rolled back): remove it.
    try {
      await StorageService.deleteFile(uploadResult.file_id, actorUserId);
    } catch (cleanupError) {
      console.error('[documents] Unable to remove unclaimed upload from storage', cleanupError);
    }
    throw error;
  }

  // Committed from here on: never delete the stored file.
  await persistDocumentPreviews(knex, document, file.bytes, tenant);
  await publishAfterCommit(tenant, actorUserId, associationId, document, target);

  const created = await (input.loadDocument
    ? input.loadDocument(documentId)
    : loadDocument(knex, tenant, documentId));
  if (!created) {
    throw new Error('Uploaded document could not be loaded');
  }
  return created;
}
