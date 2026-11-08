'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type { IDocument, IDocumentAssociationInput } from '@alga-psa/types';
import { getAuthorizedDocumentById } from '@alga-psa/documents/actions/documentActions';
import { canAuthorizeDocumentAssociation } from '@shared/lib/documentAuthorization';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

interface BlockContentInput {
  block_data: any;
  version_id?: string;
}

export interface CreateBlockDocumentInput extends BlockContentInput {
  document_name: string;
  /** Retained for caller compatibility; authorship always comes from withAuth. */
  user_id: string;
  type_id?: string;
  entityId?: string;
  entityType?: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task' | 'contract';
  folder_path?: string | null;
}

/**
 * Create a new document with block content atomically.
 *
 * This is the horizontal (infrastructure) version used by note actions across
 * packages.  It performs the core DB inserts (document + block_content +
 * optional entity association) but does NOT fire document-specific side-effects
 * (preview cache invalidation, mention-event publishing, etc.).
 *
 * The documents package retains its own full-featured `createBlockDocument`
 * which adds those concerns on top.
 */
export const createBlockDocument = withAuth(async (
  user,
  { tenant },
  input: CreateBlockDocumentInput
): Promise<{ document_id: string; content_id: string } | ActionPermissionError> => {
  if (!await hasPermission(user, 'document', 'create')) {
    return permissionError('Permission denied: Cannot create documents', 'documents:errors.permissions.create');
  }
  if (Boolean(input.entityId) !== Boolean(input.entityType)) {
    return permissionError('Permission denied: Cannot authorize document association', 'documents:errors.permissions.create');
  }
  const { knex } = await createTenantKnex();

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    if (input.entityId && input.entityType) {
      const associationTarget = ASSOCIATION_TARGETS[input.entityType];
      if (!associationTarget) {
        return permissionError('Permission denied: Unsupported document association', 'documents:errors.permissions.create');
      }
      const targetExists = await tenantDb(trx, tenant).table(associationTarget.table)
        .where(associationTarget.idColumn, input.entityId)
        .first(associationTarget.idColumn);
      if (!targetExists || !await hasPermission(user, associationTarget.permission, 'read', trx) ||
        !await canAuthorizeDocumentAssociation(trx, tenant, user, input.entityId, input.entityType)) {
        return permissionError('Permission denied: Cannot associate documents with this record', 'documents:errors.permissions.create');
      }
    }
    const documentId = uuidv4();

    const documentData: Partial<IDocument> = {
      document_id: documentId,
      document_name: input.document_name,
      user_id: user.user_id,
      created_by: user.user_id,
      tenant,
      type_id: input.type_id || null,
      folder_path: input.folder_path === null ? undefined : input.folder_path,
      order_number: 0,
    };

    await tenantDb(trx, tenant).table('documents').insert(documentData);

    const contentId = uuidv4();
    await tenantDb(trx, tenant).table('document_block_content').insert({
      content_id: contentId,
      document_id: documentId,
      block_data: typeof input.block_data === 'string'
        ? input.block_data
        : JSON.stringify(input.block_data),
      version_id: input.version_id,
      tenant,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    if (input.entityId && input.entityType) {
      await tenantDb(trx, tenant).table('document_associations').insert({
        association_id: uuidv4(),
        document_id: documentId,
        entity_id: input.entityId,
        entity_type: input.entityType,
        tenant,
        created_at: trx.fn.now(),
      });
    }

    return { document_id: documentId, content_id: contentId };
  });

  if ('permissionError' in result) {
    return result;
  }

  return result;
});

/**
 * Read block content for a document.
 */
export const getBlockContent = withAuth(async (
  user,
  { tenant },
  documentId: string
) => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'document', 'read')) {
    return permissionError('Permission denied: Cannot read documents', 'documents:errors.permissions.read');
  }

  const authorizedDocument = await withTransaction(knex, (trx: Knex.Transaction) =>
    getAuthorizedDocumentById(trx, tenant, user, documentId)
  );
  if (!authorizedDocument) {
    return permissionError('Permission denied: Cannot read documents', 'documents:errors.permissions.read');
  }
  if (!Object.prototype.hasOwnProperty.call(authorizedDocument, 'content')) {
    return null;
  }

  const content = await tenantDb(knex, tenant).table('document_block_content')
    .where({ document_id: documentId })
    .select('content_id', 'block_data', 'version_id', 'created_at', 'updated_at')
    .first();

  return content || null;
});

/**
 * Update (or create) block content for an existing document.
 */
export const updateBlockContent = withAuth(async (
  user,
  { tenant },
  documentId: string,
  input: BlockContentInput & { user_id: string }
) => {
  const { knex } = await createTenantKnex();

  if (!await hasPermission(user, 'document', 'update')) {
    return permissionError('Permission denied: Cannot update documents', 'documents:errors.permissions.update');
  }

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const document = await getAuthorizedDocumentById(trx, tenant, user, documentId);

    if (!document) {
      return permissionError('Permission denied: Cannot update documents', 'documents:errors.permissions.update');
    }

    const blockDataValue = typeof input.block_data === 'string'
      ? input.block_data
      : JSON.stringify(input.block_data);

    const existing = await tenantDb(trx, tenant).table('document_block_content')
      .where({ document_id: documentId })
      .first();

    let updatedContent;
    if (existing) {
      [updatedContent] = await tenantDb(trx, tenant).table('document_block_content')
        .where({ document_id: documentId })
        .update({
          block_data: blockDataValue,
          version_id: input.version_id,
          updated_at: trx.fn.now(),
        })
        .returning(['content_id', 'block_data', 'version_id']);
    } else {
      [updatedContent] = await tenantDb(trx, tenant).table('document_block_content')
        .insert({
          content_id: uuidv4(),
          document_id: documentId,
          block_data: blockDataValue,
          version_id: input.version_id,
          tenant,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning(['content_id', 'block_data', 'version_id']);
    }

    await tenantDb(trx, tenant).table('documents')
      .where({ document_id: documentId })
      .update({ updated_at: trx.fn.now(), edited_by: user.user_id });

    return updatedContent;
  });

  if (result && typeof result === 'object' && 'permissionError' in result) {
    return result;
  }
  return result;
});

const ASSOCIATION_TARGETS: Record<NonNullable<CreateBlockDocumentInput['entityType']>, { table: string; idColumn: string; permission: string }> = {
  ticket: { table: 'tickets', idColumn: 'ticket_id', permission: 'ticket' },
  client: { table: 'clients', idColumn: 'client_id', permission: 'client' },
  contact: { table: 'contacts', idColumn: 'contact_name_id', permission: 'contact' },
  asset: { table: 'assets', idColumn: 'asset_id', permission: 'asset' },
  project_task: { table: 'project_tasks', idColumn: 'task_id', permission: 'project_task' },
  contract: { table: 'client_contracts', idColumn: 'contract_id', permission: 'billing' },
};
