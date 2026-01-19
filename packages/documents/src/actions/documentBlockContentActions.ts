'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import Document from '../models/document';
import DocumentAssociation from '@alga-psa/documents/models/documentAssociation';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import { CacheFactory } from '../cache/CacheFactory';
import type { IDocument, IDocumentAssociationInput } from '@alga-psa/types';
import { publishEvent } from '@alga-psa/event-bus/publishers';

interface BlockContentInput {
  block_data: any; // JSON data from block editor
  version_id?: string;
}

interface CreateBlockDocumentInput extends BlockContentInput {
  document_name: string;
  user_id: string;
  type_id?: string;
  entityId?: string;
  entityType?: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task' | 'contract';
  folder_path?: string | null;
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
      const documentData: IDocument = {
        document_id: documentId,
        document_name: input.document_name,
        user_id: input.user_id || currentUser.user_id,
        created_by: input.user_id || currentUser.user_id,
        tenant,
        type_id: input.type_id || null,
        folder_path: input.folder_path === null ? undefined : input.folder_path,
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
        const associationData: IDocumentAssociationInput = {
          document_id: documentResult.document_id,
          entity_id: input.entityId,
          entity_type: input.entityType,
          tenant
        };
        await DocumentAssociation.create(trx, associationData);
      }

      return {
        document_id: documentResult.document_id,
        document_name: input.document_name,
        content_id: blockContent.content_id,
        block_data: input.block_data
      };
    });

    // After transaction commits successfully, publish event for mention notifications
    const user = await knex('users')
      .select('first_name', 'last_name')
      .where({ user_id: input.user_id || currentUser.user_id, tenant })
      .first();

    const authorName = user ? `${user.first_name} ${user.last_name}` : 'Unknown User';

    // Publish USER_MENTIONED_IN_DOCUMENT event
    try {
      await publishEvent({
        eventType: 'USER_MENTIONED_IN_DOCUMENT',
        payload: {
          tenantId: tenant,
          documentId: result.document_id,
          documentName: result.document_name,
          userId: input.user_id || currentUser.user_id,
          content: typeof result.block_data === 'string' ? result.block_data : JSON.stringify(result.block_data)
        }
      });
      console.log(`[createBlockDocument] Published USER_MENTIONED_IN_DOCUMENT event for document:`, result.document_id);
    } catch (eventError) {
      console.error(`[createBlockDocument] Failed to publish USER_MENTIONED_IN_DOCUMENT event:`, eventError);
      // Don't throw - allow document creation to succeed even if event publishing fails
    }

    return {
      document_id: result.document_id,
      content_id: result.content_id
    };
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
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
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
        // Capture old content before updating
        const oldContent = existingContent.block_data;

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

        return { updatedContent, document, oldContent };
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

        return { updatedContent: newContent, document };
      }
    });

    // After transaction commits successfully, publish event
    // Get user details for event
    const user = await knex('users')
      .select('first_name', 'last_name')
      .where({ user_id: input.user_id, tenant })
      .first();

    const authorName = user ? `${user.first_name} ${user.last_name}` : 'Unknown User';

    // Publish USER_MENTIONED_IN_DOCUMENT event for mention notifications
    try {
      const newContent = typeof input.block_data === 'string' ? input.block_data : JSON.stringify(input.block_data);

      // Build event payload with old and new content for updates
      const eventPayload: any = {
        tenantId: tenant,
        documentId: documentId,
        documentName: result.document.document_name,
        userId: input.user_id,
        content: newContent
      };

      // If this is an update (oldContent exists), include comparison data
      if (result.oldContent !== undefined) {
        eventPayload.oldContent = result.oldContent;
        eventPayload.newContent = newContent;
        eventPayload.isUpdate = true;
      }

      await publishEvent({
        eventType: 'USER_MENTIONED_IN_DOCUMENT',
        payload: eventPayload
      });
      console.log(`[updateBlockContent] Published USER_MENTIONED_IN_DOCUMENT event for document:`, documentId);
    } catch (eventError) {
      console.error(`[updateBlockContent] Failed to publish USER_MENTIONED_IN_DOCUMENT event:`, eventError);
      // Don't throw - allow document update to succeed even if event publishing fails
    }

    return result.updatedContent;
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
