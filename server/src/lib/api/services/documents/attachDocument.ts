/**
 * The single upload core for REST/MCP document attachments.
 *
 * Takes the file as a stream (multipart part, URL response) or, for base64 only, a Buffer, and
 * owns everything after that: storage through the streaming ingest (size, content type and hash
 * checks happen in `StorageService.uploadFile`, nowhere else for these paths), document type,
 * the transaction, rollback cleanup, previews, and events.
 */
// LEVERAGE: pattern document-upload-core — packages/documents uploadDocument (web UI action) keeps its own copy of this pipeline; migrate it onto attachDocument later
import type { Knex } from 'knex';
import { Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { scheduleDocumentPreviews } from '@alga-psa/documents/lib/documentPreviewJob';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildDocumentAssociatedPayload } from '@alga-psa/workflow-streams';
import type { IDocument } from 'server/src/interfaces/document.interface';
import { isUploadContentTypeError, isUploadSizeLimitError } from '@alga-psa/storage/ingest/errors';
import { ConflictError, PayloadTooLargeError, ValidationError } from '../../middleware/apiMiddleware';
import { ENTITY_ADAPTERS, type AttachHookOptions, type AttachableEntityType } from './entityAdapters';

export interface AttachDocumentInput {
  knex: Knex;
  tenant: string;
  actorUserId: string;
  viaPrincipalUserId?: string | null;
  target: { entityType: AttachableEntityType; entityId: string };
  file: {
    fileName: string;
    /** The declared type; the ingest sniffs the bytes and the stored type may differ. */
    mimeType: string;
    /** A Buffer is only for sources that inherently buffer (base64). */
    body: Buffer | Readable;
    /** Maps an error raised by the source stream mid-transfer (e.g. a URL timeout) to the API error. */
    mapSourceError?: (error: unknown) => unknown;
  };
  /** Where the bytes came from; used only in log lines. */
  source: 'multipart' | 'url' | 'base64';
  options?: AttachHookOptions;
  /** Read-model loader for the returned document (a service may return its own enriched shape). */
  loadDocument?: (documentId: string) => Promise<IDocument | null>;
}

/** Map the ingest pipeline's refusals: size is a 413, a refused type a 400 on path `file`. */
function translateUploadError(error: unknown): unknown {
  if (isUploadSizeLimitError(error)) {
    return new PayloadTooLargeError(error.message, [{ path: ['file'], message: error.message }]);
  }
  if (isUploadContentTypeError(error)) {
    return new ValidationError('Validation failed', [{ path: ['file'], message: error.message }]);
  }
  return error;
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

/**
 * Attach one file to one entity. Owns the source stream from the moment it is handed in: on every
 * outcome (including a failure before the upload starts) the stream is destroyed, so a URL
 * download never stays open past the request.
 */
export async function attachDocument(input: AttachDocumentInput): Promise<IDocument> {
  try {
    return await attachDocumentOwningStream(input);
  } finally {
    if (input.file.body instanceof Readable && !input.file.body.destroyed) input.file.body.destroy();
  }
}

async function attachDocumentOwningStream(input: AttachDocumentInput): Promise<IDocument> {
  const { knex, tenant, actorUserId, target, file } = input;
  const options = input.options ?? {};
  const adapter = ENTITY_ADAPTERS[target.entityType];
  if (!adapter) {
    throw new ValidationError('Validation failed', [
      { path: ['entity_type'], message: `Unsupported entity type: ${String(target.entityType)}` },
    ]);
  }

  // An error inside the source stream (a URL timeout) reaches us wrapped by uploadFile; keep the original.
  let sourceError: unknown;
  if (file.body instanceof Readable) file.body.once('error', (error) => { sourceError ??= error; });

  let uploadResult: Awaited<ReturnType<typeof StorageService.uploadFile>>;
  try {
    uploadResult = await StorageService.uploadFile(tenant, file.body, file.fileName, {
      mime_type: file.mimeType,
      uploaded_by_id: actorUserId,
    });
  } catch (error) {
    // A refusal before the first byte leaves the source unread: stop the transfer.
    if (file.body instanceof Readable) file.body.destroy();
    // Without a mapper an ingest refusal still surfaces as its API error (413/400), never raw.
    if (sourceError !== undefined) throw translateUploadError(file.mapSourceError ? file.mapSourceError(sourceError) : sourceError);
    throw translateUploadError(error);
  }
  // The ingest may have stored a sniffed type rather than the declared one.
  const mimeType = uploadResult.mime_type;

  const documentId = uuidv4();
  const associationId = uuidv4();
  let document: IDocument;

  try {
    const folderPath = await adapter.resolveFolder(knex, tenant, target.entityId);
    const typeResult = await resolveDocumentTypeId(knex, tenant, mimeType);
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
      mime_type: mimeType,
      file_size: uploadResult.file_size,
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
        viaPrincipalUserId: input.viaPrincipalUserId,
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
  await scheduleDocumentPreviews(tenant, documentId, actorUserId);
  await publishAfterCommit(tenant, actorUserId, associationId, document, target);

  const created = await (input.loadDocument
    ? input.loadDocument(documentId)
    : loadDocument(knex, tenant, documentId));
  if (!created) {
    throw new Error('Uploaded document could not be loaded');
  }
  return created;
}
