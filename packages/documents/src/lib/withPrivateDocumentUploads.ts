import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { withFileUploadTransaction } from '@alga-psa/storage/fileUploadTransaction';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildDocumentAssociatedPayload } from '@alga-psa/workflow-streams';
import type { IDocument, IDocumentAssociationInput, IUser } from '@alga-psa/types';
import { getDocumentTypeId } from '../actions/documentActions';
import { generateDocumentPreviews } from './documentPreviewGenerator';

type Target = Pick<IDocumentAssociationInput, 'entity_id' | 'entity_type'>;
type UploadedDocument = IDocument & Required<Pick<IDocument, 'file_id' | 'mime_type' | 'file_size' | 'storage_path'>>;

/**
 * Server-owned uploads composed with a domain write. Documents and associations become visible only
 * when the domain write commits; storage ownership survives rollback, provider failures and crashes.
 * Callers authorize the target records before entering this function. There are no client-supplied IDs.
 */
export async function withPrivateDocumentUploads<T>(
  knex: Knex,
  tenant: string,
  user: IUser,
  files: File[],
  targets: Target[],
  run: (trx: Knex.Transaction, documents: IDocument[]) => Promise<T>
): Promise<T> {
  if (
    files.length &&
    (user.user_type === 'client' ||
      !(await hasPermission(user, 'document', 'create')) ||
      !(await hasPermission(user, 'document', 'read')))
  ) {
    throw new Error('Permission denied: Cannot upload private documents');
  }
  const documents: UploadedDocument[] = [];
  const result = await withFileUploadTransaction(knex, tenant, async (trx) => {
    const db = tenantDb(trx, tenant);
    for (const file of files) {
      const type = await getDocumentTypeId(file.type);
      if ('permissionError' in type) throw new Error('Permission denied: Cannot read document types');
      const buffer = Buffer.from(await file.arrayBuffer());
      const stored = await StorageService.uploadFile(tenant, buffer, file.name, {
        mime_type: file.type,
        uploaded_by_id: user.user_id,
      });
      const target = targets[0];
      const folder = target
        ? await db.table('document_folders').where(target).orderBy('folder_path').first('folder_path')
        : undefined;
      const document = {
        tenant,
        document_id: randomUUID(),
        document_name: file.name,
        type_id: type.isShared ? null : type.typeId,
        shared_type_id: type.isShared ? type.typeId : null,
        user_id: user.user_id,
        created_by: user.user_id,
        order_number: 0,
        file_id: stored.file_id,
        storage_path: stored.storage_path,
        mime_type: file.type,
        file_size: file.size,
        folder_path: folder?.folder_path,
        // Private uploads never inherit a target folder's client visibility.
        is_client_visible: false,
      } as UploadedDocument;
      const previews = await generateDocumentPreviews(document, buffer);
      Object.assign(document, previews);
      await db.table('documents').insert(document);
      if (targets.length) {
        await db
          .table('document_associations')
          .insert(
            targets.map((target) => ({
              tenant,
              ...target,
              document_id: document.document_id,
            }))
          )
          .onConflict(['tenant', 'document_id', 'entity_id', 'entity_type'])
          .ignore();
      }
      documents.push(document);
    }
    const value = await run(trx, documents);
    return {
      value,
      fileIds: documents.flatMap((document) =>
        [document.file_id, document.thumbnail_file_id, document.preview_file_id].filter((id): id is string =>
          Boolean(id)
        )
      ),
    };
  });
  // Indexing is a post-commit effect; failure must never turn a committed receive into a failed upload.
  for (const document of documents) {
    try {
      const occurredAt = new Date().toISOString();
      const ctx = { tenantId: tenant, occurredAt, actor: { actorType: 'USER' as const, actorUserId: user.user_id } };
      const associations = await tenantDb(knex, tenant)
        .table('document_associations')
        .where({ document_id: document.document_id });
      for (const association of associations) {
        await publishWorkflowEvent({
          eventType: 'DOCUMENT_ASSOCIATED',
          ctx,
          payload: buildDocumentAssociatedPayload({
            documentId: document.document_id,
            entityId: association.entity_id,
            entityType: association.entity_type,
            associatedByUserId: user.user_id,
            associatedAt: occurredAt,
          }),
          idempotencyKey: `document_associated:${association.association_id}`,
        });
      }
      await publishEvent({
        eventType: 'DOCUMENT_UPDATED',
        payload: {
          tenantId: tenant,
          documentId: document.document_id,
          occurredAt: new Date().toISOString(),
          updatedByUserId: user.user_id,
          updatedAt: new Date().toISOString(),
          changedFields: ['file_id'],
        },
      });
    } catch (error) {
      console.error('Could not publish uploaded document search update:', error);
    }
  }
  return result;
}
