'use server';

/**
 * Asset Notes Actions
 *
 * Server actions for managing BlockNote-formatted notes on assets.
 * Uses the document system with a 1:1 relationship (asset.notes_document_id).
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.4.2
 */

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  createBlockDocument,
  getBlockContent,
  updateBlockContent,
} from 'server/src/lib/actions/document-actions/documentBlockContentActions';
import { IDocument } from 'server/src/interfaces/document.interface';

export interface AssetNoteContent {
  document: IDocument | null;
  blockData: unknown | null;
  lastUpdated: string | null;
}

/**
 * Get note content for an asset
 * Returns the BlockNote content if the asset has a linked notes document
 */
export async function getAssetNoteContent(assetId: string): Promise<AssetNoteContent> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Get the asset to find notes_document_id
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select('notes_document_id')
      .first();

    if (!asset) {
      throw new Error('Asset not found');
    }

    // If no notes document exists yet, return empty content
    if (!asset.notes_document_id) {
      return {
        document: null,
        blockData: null,
        lastUpdated: null,
      };
    }

    // Get the document
    const document = await knex('documents')
      .where({ tenant, document_id: asset.notes_document_id })
      .first() as IDocument | undefined;

    if (!document) {
      return {
        document: null,
        blockData: null,
        lastUpdated: null,
      };
    }

    // Get the block content
    const blockContent = await getBlockContent(asset.notes_document_id);

    return {
      document,
      blockData: blockContent?.block_data
        ? typeof blockContent.block_data === 'string'
          ? JSON.parse(blockContent.block_data)
          : blockContent.block_data
        : null,
      lastUpdated: blockContent?.updated_at || document.updated_at || null,
    };
  } catch (error) {
    console.error('Error getting asset note content:', error);
    throw new Error('Failed to get asset note content');
  }
}

/**
 * Save note content for an asset
 * Creates a new document if one doesn't exist, or updates the existing one
 */
export async function saveAssetNote(
  assetId: string,
  blockData: unknown
): Promise<{ document_id: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  // Get current user for audit trail
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  try {
    // Get the asset
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select('asset_id', 'name', 'notes_document_id')
      .first();

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.notes_document_id) {
      // Update existing document
      await updateBlockContent(asset.notes_document_id, {
        block_data: blockData,
        user_id: currentUser.user_id,
      });

      return { document_id: asset.notes_document_id };
    } else {
      // Create new document and link to asset
      const { document_id } = await createBlockDocument({
        document_name: `${asset.name} Notes`,
        user_id: currentUser.user_id,
        block_data: blockData,
        entityId: assetId,
        entityType: 'asset',
      });

      // Update asset with notes_document_id
      await knex('assets')
        .where({ tenant, asset_id: assetId })
        .update({
          notes_document_id: document_id,
          updated_at: knex.fn.now(),
        });

      return { document_id };
    }
  } catch (error) {
    console.error('Error saving asset note:', error);
    throw new Error('Failed to save asset note');
  }
}

/**
 * Delete notes for an asset
 * Removes the link and optionally deletes the document
 */
export async function deleteAssetNote(
  assetId: string,
  deleteDocument: boolean = false
): Promise<void> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Get the asset
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select('notes_document_id')
      .first();

    if (!asset || !asset.notes_document_id) {
      return; // No notes to delete
    }

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Unlink the document from the asset
      await trx('assets')
        .where({ tenant, asset_id: assetId })
        .update({
          notes_document_id: null,
          updated_at: trx.fn.now(),
        });

      // Optionally delete the document entirely
      if (deleteDocument) {
        // Delete block content first (due to FK)
        await trx('document_block_content')
          .where({ tenant, document_id: asset.notes_document_id })
          .delete();

        // Delete document associations
        await trx('document_associations')
          .where({ tenant, document_id: asset.notes_document_id })
          .delete();

        // Delete the document
        await trx('documents')
          .where({ tenant, document_id: asset.notes_document_id })
          .delete();
      }
    });
  } catch (error) {
    console.error('Error deleting asset note:', error);
    throw new Error('Failed to delete asset note');
  }
}
