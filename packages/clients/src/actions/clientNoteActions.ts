'use server';

/**
 * Client Notes Actions
 *
 * Server actions for managing BlockNote-formatted notes on clients.
 * Uses the document system with a 1:1 relationship (companies.notes_document_id).
 */

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import {
  createBlockDocument,
  getBlockContent,
  updateBlockContent,
} from '@alga-psa/documents/actions/documentBlockContentActions';
import type { IDocument } from '@alga-psa/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildNoteCreatedPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/crmInteractionNoteEventBuilders';

export interface ClientNoteContent {
  document: IDocument | null;
  blockData: unknown | null;
  lastUpdated: string | null;
}

/**
 * Get note content for a client
 * Returns the BlockNote content if the client has a linked notes document
 */
export const getClientNoteContent = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientNoteContent> => {
  const { knex } = await createTenantKnex();

  try {
    // Get the client to find notes_document_id
    const client = await knex('clients')
      .where({ tenant, client_id: clientId })
      .select('notes_document_id')
      .first();

    if (!client) {
      throw new Error('Client not found');
    }

    // If no notes document exists yet, return empty content
    if (!client.notes_document_id) {
      return {
        document: null,
        blockData: null,
        lastUpdated: null,
      };
    }

    // Get the document
    const document = await knex('documents')
      .where({ tenant, document_id: client.notes_document_id })
      .first() as IDocument | undefined;

    if (!document) {
      return {
        document: null,
        blockData: null,
        lastUpdated: null,
      };
    }

    // Get the block content
    const blockContent = await getBlockContent(client.notes_document_id);

    let parsedBlockData: unknown | null = null;
    if (blockContent?.block_data) {
      if (typeof blockContent.block_data === 'string') {
        try {
          parsedBlockData = JSON.parse(blockContent.block_data);
        } catch (parseError) {
          // If parsing fails, return the raw string so the editor can still display something.
          parsedBlockData = blockContent.block_data;
        }
      } else {
        parsedBlockData = blockContent.block_data;
      }
    }

    return {
      document,
      blockData: parsedBlockData,
      lastUpdated: blockContent?.updated_at || document.updated_at || null,
    };
  } catch (error) {
    console.error('Error getting client note content:', error);
    throw new Error('Failed to get client note content');
  }
});

/**
 * Save note content for a client
 * Creates a new document if one doesn't exist, or updates the existing one
 */
export const saveClientNote = withAuth(async (
  user,
  { tenant },
  clientId: string,
  blockData: unknown
): Promise<{ document_id: string }> => {
  const { knex } = await createTenantKnex();

  try {
    // Get the client
    const client = await knex('clients')
      .where({ tenant, client_id: clientId })
      .select('client_id', 'client_name', 'notes_document_id')
      .first();

    if (!client) {
      throw new Error('Client not found');
    }

    if (client.notes_document_id) {
      // Update existing document
      await updateBlockContent(client.notes_document_id, {
        block_data: blockData,
        user_id: user.user_id,
      });

      return { document_id: client.notes_document_id };
    } else {
      // Create new document and link to client
      const { document_id } = await createBlockDocument({
        document_name: `${client.client_name} Notes`,
        user_id: user.user_id,
        block_data: blockData,
        entityId: clientId,
        entityType: 'client',
      });

      // Update client with notes_document_id
      await knex('clients')
        .where({ tenant, client_id: clientId })
        .update({
          notes_document_id: document_id,
          updated_at: knex.fn.now(),
        });

      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'NOTE_CREATED',
        payload: buildNoteCreatedPayload({
          noteId: document_id,
          entityType: 'client',
          entityId: clientId,
          createdByUserId: currentUser.user_id,
          createdAt: occurredAt,
          visibility: 'internal',
          bodyPreview: blockData,
        }),
        ctx: { tenantId: tenant, occurredAt, actor: { actorType: 'USER' as const, actorUserId: currentUser.user_id } },
        idempotencyKey: `note_created:client:${clientId}:${document_id}`,
      });

      return { document_id };
    }
  } catch (error) {
    console.error('Error saving client note:', error);
    throw new Error('Failed to save client note');
  }
});

/**
 * Delete notes for a client
 * Removes the link and optionally deletes the document
 */
export const deleteClientNote = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  deleteDocument: boolean = false
): Promise<void> => {
  const { knex } = await createTenantKnex();

  try {
    // Get the client
    const client = await knex('clients')
      .where({ tenant, client_id: clientId })
      .select('notes_document_id')
      .first();

    if (!client || !client.notes_document_id) {
      return; // No notes to delete
    }

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Unlink the document from the client
      await trx('clients')
        .where({ tenant, client_id: clientId })
        .update({
          notes_document_id: null,
          updated_at: trx.fn.now(),
        });

      // Optionally delete the document entirely
      if (deleteDocument) {
        // Delete block content first (due to FK)
        await trx('document_block_content')
          .where({ tenant, document_id: client.notes_document_id })
          .delete();

        // Delete document associations
        await trx('document_associations')
          .where({ tenant, document_id: client.notes_document_id })
          .delete();

        // Delete the document
        await trx('documents')
          .where({ tenant, document_id: client.notes_document_id })
          .delete();
      }
    });
  } catch (error) {
    console.error('Error deleting client note:', error);
    throw new Error('Failed to delete client note');
  }
});
