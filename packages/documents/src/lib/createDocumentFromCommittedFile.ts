/**
 * The document-creation half of an upload, for bytes that are already stored and recorded.
 *
 * Shared by `uploadDocument` (the web action, which stores the bytes first) and the resumable
 * upload route (which stores them chunk by chunk): once a file is committed and has its
 * `external_files` row, filing it, creating the document row, associating it to its entity,
 * publishing events and queuing previews is the same job. Authorization is NOT done here; callers
 * run `assertDocumentUploadAllowed` before storing a byte.
 *
 * Deliberately not part of the `'use server'` action module: these helpers must never become
 * client-callable server actions.
 */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { isDocumentAssociationCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import { tenantDb, withTransaction } from '@alga-psa/db';
import DocumentAssociation from '@alga-psa/documents/models/documentAssociation';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildDocumentAssociatedPayload } from '@alga-psa/workflow-streams';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IDocument, IDocumentAssociation, IDocumentAssociationInput, IUser } from '@alga-psa/types';
import { INLINE_IMAGE_FOLDER_PATH } from './editorImageUpload';
import { ensureInlineImageFolder } from './inlineImageFiling';
import { authorizeAssetAssociationWrite } from './assetAssociationAuthorization';
import { scheduleDocumentPreviews } from './documentPreviewJob';
import type { DocumentUploadTarget } from './documentPermissions';

// LEVERAGE: pattern action-permission-error-guard — identical guard lives in documentActions.ts (not exportable from a 'use server' module); one shared export in @alga-psa/ui/lib/errorHandling would replace both.
export function isActionPermissionErrorResult(value: unknown): value is ActionPermissionError {
  return Boolean(value) && typeof value === 'object' && typeof (value as { permissionError?: unknown }).permissionError === 'string';
}

// LEVERAGE: pattern tenant-scoped-table — document actions and shared authorization repeat this typed facade.
function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function publishDocumentUpdatedSearchEvent(
  tenant: string,
  documentId: string,
  userId: string | undefined,
  changedFields: string[],
  source: string,
): Promise<void> {
  try {
    const occurredAt = new Date().toISOString();
    await publishEvent({
      eventType: 'DOCUMENT_UPDATED',
      payload: {
        tenantId: tenant,
        occurredAt,
        documentId,
        updatedByUserId: userId,
        updatedAt: occurredAt,
        changedFields,
      },
    });
  } catch (eventError) {
    console.error(`[${source}] Failed to publish DOCUMENT_UPDATED search event:`, eventError);
  }
}

export async function ensureEntityFoldersInitializedInternal(
  knex: Knex,
  tenant: string,
  entityId: string,
  entityType: string,
  createdBy: string | null | undefined
) {
  const existingFolders = await tenantScopedTable(knex, 'document_folders', tenant)
    .where('entity_id', entityId)
    .andWhere('entity_type', entityType)
    .select('folder_path', 'folder_id');

  const existingPaths = new Set(existingFolders.map((folder: { folder_path: string }) => folder.folder_path));

  const defaults = await tenantScopedTable(knex, 'document_default_folders', tenant)
    .where('entity_type', entityType)
    .select('folder_name', 'folder_path', 'is_client_visible', 'sort_order')
    .orderBy('sort_order', 'asc')
    .orderBy('folder_path', 'asc');

  if (defaults.length === 0) {
    return;
  }

  const pathToFolderId = new Map<string, string>();
  for (const folder of existingFolders as Array<{ folder_path: string; folder_id: string }>) {
    pathToFolderId.set(folder.folder_path, folder.folder_id);
  }

  const foldersToInsert = defaults
    .filter((item: { folder_path: string }) => !existingPaths.has(item.folder_path))
    .map((item: { folder_name: string; folder_path: string; is_client_visible: boolean }) => {
      const folderId = uuidv4();
      pathToFolderId.set(item.folder_path, folderId);

      const segments = item.folder_path.split('/').filter(Boolean);
      const parentPath = segments.length > 1 ? '/' + segments.slice(0, -1).join('/') : null;

      return {
        tenant,
        folder_id: folderId,
        folder_path: item.folder_path,
        folder_name: item.folder_name,
        parent_folder_id: parentPath ? pathToFolderId.get(parentPath) ?? null : null,
        entity_id: entityId,
        entity_type: entityType,
        is_client_visible: item.is_client_visible,
        created_by: createdBy ?? null,
      };
    });

  if (foldersToInsert.length > 0) {
    await tenantScopedTable(knex, 'document_folders', tenant).insert(foldersToInsert);
  }
}

/** What `uploadDocument` accepts beyond the target entity. */
export interface DocumentUploadOptions extends DocumentUploadTarget {
  folder_path?: string | null;
  commentAttachmentDraft?: boolean;
  /** Forces client visibility — used for images embedded in client-facing content. */
  isClientVisible?: boolean;
}

export interface CreateDocumentFromCommittedFileInput {
  user: IUser;
  tenant: string;
  knex: Knex;
  /** The committed object, already recorded in `external_files`. */
  file: { file_id: string; storage_path: string };
  /** Display name, declared MIME type and size the document row carries. */
  name: string;
  mimeType: string;
  size: number;
  /** Result of the document-type lookup for `mimeType`. */
  documentType: { typeId: string; isShared: boolean };
  options: DocumentUploadOptions;
  /**
   * Runs inside the document transaction, after the document and its associations are written.
   * Throwing rolls the whole creation back (used to flip an upload session to `completed`
   * atomically with the document it produced).
   */
  withinTransaction?: (trx: Knex.Transaction, document: IDocument) => Promise<void>;
  /** Label for log lines. */
  source?: string;
}

export type CreateDocumentFromCommittedFileResult =
  | { success: true; document: IDocument }
  | ActionPermissionError;

export async function createDocumentFromCommittedFile(
  input: CreateDocumentFromCommittedFileInput,
): Promise<CreateDocumentFromCommittedFileResult> {
  const { user, tenant, knex, file: uploadResult, name, mimeType, size, options, documentType } = input;
  const source = input.source ?? 'createDocumentFromCommittedFile';
  const authenticatedUserId = user.user_id;
  const { typeId, isShared } = documentType;

  let createdAssociations: Array<{
    associationId: string;
    documentId: string;
    entityId: string;
    entityType: string;
  }> = [];

  // Auto-file into entity folder if folder_path not set and entity context exists
  // Best-effort: never fails the upload, wraps in try/catch
  let resolvedFolderPath: string | undefined = options.folder_path || undefined;

  // Inline editor images name a tenant-level folder that no wizard creates.
  // Provision it on first use so a customer never has to make it by hand,
  // and so a missing folder cannot quietly dump the image into the root.
  if (resolvedFolderPath === INLINE_IMAGE_FOLDER_PATH) {
    try {
      await ensureInlineImageFolder(knex, tenant, authenticatedUserId);
    } catch (folderError) {
      console.error(`[${source}] Failed to provision the inline image folder:`, folderError);
    }
  }

  if (!resolvedFolderPath) {
    try {
      const primaryEntity = options.ticketId ? { id: options.ticketId, type: 'ticket' }
        : options.projectTaskId ? { id: options.projectTaskId, type: 'project_task' }
        : options.contractId ? { id: options.contractId, type: 'contract' }
        : options.opportunityId ? { id: options.opportunityId, type: 'opportunity' }
        : options.clientId ? { id: options.clientId, type: 'client' }
        : options.assetId ? { id: options.assetId, type: 'asset' }
        : null;

      if (primaryEntity) {
        await ensureEntityFoldersInitializedInternal(
          knex,
          tenant,
          primaryEntity.id,
          primaryEntity.type,
          authenticatedUserId
        );

        const entityFolderQuery = () =>
          tenantScopedTable(knex, 'document_folders', tenant)
            .andWhere('entity_id', primaryEntity.id)
            .andWhere('entity_type', primaryEntity.type);

        if (primaryEntity.type === 'ticket') {
          const attachmentsFolder = await entityFolderQuery()
            .andWhere('folder_path', '/Tickets/Attachments')
            .select('folder_path')
            .first();

          if (attachmentsFolder) {
            resolvedFolderPath = attachmentsFolder.folder_path;
          }
        }

        if (!resolvedFolderPath) {
          // Fall back to the first entity-scoped folder for older setups.
          const entityFolder = await entityFolderQuery()
            .orderBy('folder_path', 'asc')
            .select('folder_path')
            .first();

          if (entityFolder) {
            resolvedFolderPath = entityFolder.folder_path;
          }
        }
      }
    } catch {
      // Silent failure — best-effort, never fails the upload
    }
  }

  // Create document record
  // Documents uploaded by client users are automatically client-visible.
  // For internal users, inherit visibility from the target folder.
  let isClientVisible = options.isClientVisible === true || user.user_type === 'client';
  if (!isClientVisible && options.isClientVisible !== false && resolvedFolderPath) {
    try {
      const folderVisibilityQuery = tenantScopedTable(knex, 'document_folders', tenant)
        .select('is_client_visible')
        .andWhere('folder_path', resolvedFolderPath);

      const entityId = options.ticketId || options.projectTaskId || options.contractId
        || options.opportunityId || options.clientId || options.assetId;
      const entityType = options.ticketId ? 'ticket'
        : options.projectTaskId ? 'project_task'
        : options.contractId ? 'contract'
        : options.opportunityId ? 'opportunity'
        : options.clientId ? 'client'
        : options.assetId ? 'asset'
        : null;

      if (entityId && entityType) {
        folderVisibilityQuery.andWhere('entity_id', entityId).andWhere('entity_type', entityType);
      }

      const targetFolder = await folderVisibilityQuery.first();
      if (targetFolder?.is_client_visible) {
        isClientVisible = true;
      }
    } catch {
      // Silent failure — best-effort, never fails the upload
    }
  }
  const document: IDocument = {
    document_id: uuidv4(),
    document_name: name,
    type_id: isShared ? null : typeId,
    shared_type_id: isShared ? typeId : undefined,
    user_id: authenticatedUserId,
    order_number: 0,
    created_by: authenticatedUserId,
    tenant,
    file_id: uploadResult.file_id,
    storage_path: uploadResult.storage_path,
    mime_type: mimeType,
    file_size: size,
    folder_path: resolvedFolderPath,
    is_client_visible: options.commentAttachmentDraft ? true : isClientVisible,
  };

  // Use transaction for document creation and associations
  const result: { success: true; document: IDocument } | ActionPermissionError = await withTransaction(knex, async (trx: Knex.Transaction): Promise<{ success: true; document: IDocument } | ActionPermissionError> => {
    if (options.assetId) {
      const assetAuthorization = await authorizeAssetAssociationWrite(trx, tenant, user, options.assetId);
      if (assetAuthorization) return assetAuthorization;
    }
    // Refused before anything is written: the document row is part of the same create.
    const associationTargets: Array<{ entityType: string; entityId: string | undefined }> = [
      { entityType: 'ticket', entityId: options.ticketId },
      { entityType: 'client', entityId: options.clientId },
      { entityType: 'contact', entityId: options.contactNameId },
      { entityType: 'asset', entityId: options.assetId },
      { entityType: 'project_task', entityId: options.projectTaskId },
      { entityType: 'contract', entityId: options.contractId },
      { entityType: 'opportunity', entityId: options.opportunityId },
    ];
    if (!await isDocumentAssociationCreateAllowed(trx, {
      tenant,
      user,
      targets: associationTargets.flatMap((target) => target.entityId
        ? [{ entityType: target.entityType, entityId: target.entityId }]
        : []),
    })) {
      return permissionError('Permission denied: Cannot associate documents', 'documents:errors.permissions.associate');
    }
    await tenantScopedTable(trx, 'documents', tenant).insert(document);
    if (options.commentAttachmentDraft) {
      await tenantDb(trx, tenant).table('ticket_comment_attachments').insert({
        tenant, ticket_id: options.ticketId, document_id: document.document_id,
        created_by: authenticatedUserId, state: 'draft',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }
    const documentWithId = document;

    // Create associations if any entity IDs are provided
    const associations: IDocumentAssociationInput[] = [];

    if (options.ticketId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.ticketId,
        entity_type: 'ticket',
        tenant
      });

    }

    if (options.clientId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.clientId,
        entity_type: 'client',
        tenant
      });
    }

    if (options.contactNameId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.contactNameId,
        entity_type: 'contact',
        tenant
      });
    }

    if (options.assetId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.assetId,
        entity_type: 'asset',
        tenant
      });
    }

    if (options.projectTaskId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.projectTaskId,
        entity_type: 'project_task',
        tenant
      });
    }

    if (options.parentDocumentId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.parentDocumentId,
        entity_type: 'document',
        tenant
      });
    }

    if (options.contractId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.contractId,
        entity_type: 'contract',
        tenant
      });
    }

    if (options.opportunityId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.opportunityId,
        entity_type: 'opportunity',
        tenant
      });
    }

    // Create all associations
    if (associations.length > 0) {
      const created = await Promise.all(
        associations.map((association): Promise<Pick<IDocumentAssociation, "association_id">> =>
          DocumentAssociation.create(trx, association)
        )
      );
      createdAssociations = created.map((row, index) => ({
        associationId: row.association_id,
        documentId: associations[index]!.document_id,
        entityId: associations[index]!.entity_id,
        entityType: associations[index]!.entity_type,
      }));
    }

    if (input.withinTransaction) {
      await input.withinTransaction(trx, documentWithId);
    }

    return {
      success: true as const,
      document: documentWithId
    };
  });

  if (isActionPermissionErrorResult(result)) return result;

  if (createdAssociations.length > 0) {
    const occurredAt = new Date().toISOString();
    await Promise.all(
      createdAssociations.map(async (association) => {
        try {
          await publishWorkflowEvent({
            eventType: 'DOCUMENT_ASSOCIATED',
            payload: buildDocumentAssociatedPayload({
              documentId: association.documentId,
              entityType: association.entityType,
              entityId: association.entityId,
              associatedByUserId: user.user_id,
              associatedAt: occurredAt,
            }),
            ctx: {
              tenantId: tenant,
              occurredAt,
              actor: { actorType: 'USER', actorUserId: user.user_id },
            },
            idempotencyKey: `document_associated:${association.associationId}`,
          });
        } catch (eventError) {
          console.error(`[${source}] Failed to publish DOCUMENT_ASSOCIATED workflow event:`, eventError);
        }
      })
    );
  }

  try {
    await publishDocumentUpdatedSearchEvent(
      tenant,
      document.document_id,
      user.user_id,
      ['document_name', 'file_id', 'storage_path'],
      source,
    );
  } catch (error) {
    console.error(`[${source}] Failed to publish search update:`, error);
  }

  // Previews are generated in the background from storage; the upload returns now and the UI
  // picks up thumbnail_file_id on its next refresh.
  await scheduleDocumentPreviews(tenant, document.document_id, user.user_id);

  return result;
}
