'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import type { IDocument, IDocumentAssociationInput } from '@alga-psa/types';

interface BlockContentInput {
  block_data: any;
  version_id?: string;
}

export interface CreateBlockDocumentInput extends BlockContentInput {
  document_name: string;
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
): Promise<{ document_id: string; content_id: string }> => {
  const { knex } = await createTenantKnex();

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const documentId = uuidv4();

    const documentData: Partial<IDocument> = {
      document_id: documentId,
      document_name: input.document_name,
      user_id: input.user_id || user.user_id,
      created_by: input.user_id || user.user_id,
      tenant,
      type_id: input.type_id || null,
      folder_path: input.folder_path === null ? undefined : input.folder_path,
      order_number: 0,
    };

    await trx('documents').insert(documentData);

    const contentId = uuidv4();
    await trx('document_block_content').insert({
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
      await trx('document_associations').insert({
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

  return result;
});

/**
 * Read block content for a document.
 */
export const getBlockContent = withAuth(async (
  _user,
  { tenant },
  documentId: string
) => {
  const { knex } = await createTenantKnex();

  const content = await knex('document_block_content')
    .where({ document_id: documentId, tenant })
    .select('content_id', 'block_data', 'version_id', 'created_at', 'updated_at')
    .first();

  return content || null;
});

/**
 * Update (or create) block content for an existing document.
 */
export const updateBlockContent = withAuth(async (
  _user,
  { tenant },
  documentId: string,
  input: BlockContentInput & { user_id: string }
) => {
  const { knex } = await createTenantKnex();

  const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const document = await trx('documents')
      .where({ document_id: documentId, tenant })
      .first();

    if (!document) {
      throw new Error('Document not found or access denied');
    }

    const blockDataValue = typeof input.block_data === 'string'
      ? input.block_data
      : JSON.stringify(input.block_data);

    const existing = await trx('document_block_content')
      .where({ document_id: documentId, tenant })
      .first();

    let updatedContent;
    if (existing) {
      [updatedContent] = await trx('document_block_content')
        .where({ document_id: documentId, tenant })
        .update({
          block_data: blockDataValue,
          version_id: input.version_id,
          updated_at: trx.fn.now(),
        })
        .returning(['content_id', 'block_data', 'version_id']);
    } else {
      [updatedContent] = await trx('document_block_content')
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

    await trx('documents')
      .where({ document_id: documentId, tenant })
      .update({ updated_at: trx.fn.now(), edited_by: input.user_id });

    return updatedContent;
  });

  return result;
});
