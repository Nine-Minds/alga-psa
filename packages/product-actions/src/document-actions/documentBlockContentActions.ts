'use server';

import { createTenantKnex } from '@server/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import Document from '@server/lib/models/document';
import DocumentAssociation from '@server/lib/models/document-association';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { CacheFactory } from '@server/lib/cache/CacheFactory';

interface BlockContentInput {
  block_data: any; // JSON data from block editor
  version_id?: string;
}

interface CreateBlockDocumentInput extends BlockContentInput {
  document_name: string;
  user_id: string;
  type_id?: string;
  entityId?: string;
  entityType?: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task';
}

// Create a new document with block content
export async function createBlockDocument(
  input: CreateBlockDocumentInput
): Promise<{ document_id: string; content_id: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Get current user
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  try {
    // Start transaction to ensure both document and block content are created atomically
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documentId = uuidv4();
      
      // Create the document directly in the transaction
      const documentData = {
        document_id: documentId,
        document_name: input.document_name,
        user_id: input.user_id || currentUser.user_id,
        created_by: input.user_id || currentUser.user_id,
        tenant,
        type_id: input.type_id || null,
        order_number: 0
      };

      const documentResult = await Document.insert(trx, documentData);

      // Create the block content
      const [blockContent] = await trx('document_block_content')
        .insert({
          content_id: uuidv4(),
          document_id: documentResult.document_id,
          block_data: typeof input.block_data === 'string' ? input.block_data : JSON.stringify(input.block_data),
          version_id: input.version_id,
          tenant,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('content_id');

      // If entity information is provided, create association
      if (input.entityId && input.entityType) {
        await DocumentAssociation.create({
          document_id: documentResult.document_id,
          entity_id: input.entityId,
          entity_type: input.entityType,
          tenant
        }, trx);
      }

      return {
        document_id: documentResult.document_id,
        content_id: blockContent.content_id
      };
    });

    return result;
  } catch (error) {
    console.error('Error creating block document:', error);
    throw new Error('Failed to create block document');
  }
}

// Get document block content
export async function getBlockContent(documentId: string) {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    const content = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('document_block_content')
        .where({
          document_id: documentId,
          tenant
        })
        .select('content_id', 'block_data', 'version_id', 'created_at', 'updated_at')
        .first();
    });

    return content || null;
  } catch (error) {
    console.error('Error getting block content:', error);
    throw new Error('Failed to get block content');
  }
}

// Update or create document block content
export async function updateBlockContent(
  documentId: string,
  input: BlockContentInput & { user_id: string }
) {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Verify document exists and belongs to tenant
      const document = await trx('documents')
        .where({
          document_id: documentId,
          tenant
        })
        .first();

      if (!document) {
        throw new Error('Document not found or access denied');
      }

      // Check if block content exists
      const existingContent = await trx('document_block_content')
        .where({
          document_id: documentId,
          tenant
        })
        .first();

      if (existingContent) {
        // Update existing content
        const [updatedContent] = await trx('document_block_content')
          .where({
            document_id: documentId,
            tenant
          })
          .update({
            block_data: typeof input.block_data === 'string' ? input.block_data : JSON.stringify(input.block_data),
            version_id: input.version_id,
            updated_at: trx.fn.now()
          })
          .returning(['content_id', 'block_data', 'version_id']);

        // Update document's updated_at and edited_by
        await trx('documents')
          .where({
            document_id: documentId,
            tenant
          })
          .update({
            updated_at: trx.fn.now(),
            edited_by: input.user_id
          });

        // Invalidate the preview cache for this document
        const cache = CacheFactory.getPreviewCache(tenant);
        await cache.delete(documentId);
        console.log(`[updateBlockContent] Invalidated preview cache for document ${documentId}`);

        return updatedContent;
      } else {
        // Create new block content record
        const [newContent] = await trx('document_block_content')
          .insert({
            content_id: uuidv4(),
            document_id: documentId,
            block_data: typeof input.block_data === 'string' ? input.block_data : JSON.stringify(input.block_data),
            version_id: input.version_id,
            tenant,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now()
          })
          .returning(['content_id', 'block_data', 'version_id']);

        return newContent;
      }
    });
  } catch (error) {
    console.error('Error updating block content:', error);
    throw new Error('Failed to update block content');
  }
}

// Delete document block content
export async function deleteBlockContent(documentId: string): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('document_block_content')
        .where({
          document_id: documentId,
          tenant
        })
        .delete();
    });
  } catch (error) {
    console.error('Error deleting block content:', error);
    throw new Error('Failed to delete block content');
  }
}
