'use server';

/**
 * Asset Notes Actions
 *
 * Server actions for managing BlockNote-formatted notes on assets.
 * Uses the document system with a 1:1 relationship (asset.notes_document_id).
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.4.2
 */

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import type { IDocument } from '@alga-psa/types';
import { assertAssetAccess } from '../lib/assetReadAuthorization';
import {
  assetActionErrorFrom,
  type AssetActionError,
} from './assetActionErrors';

export interface AssetNoteContent {
  document: IDocument | null;
  blockData: unknown | null;
  lastUpdated: string | null;
}

function tenantScopedTable(conn: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

function encodeBlockData(blockData: unknown): string {
  return typeof blockData === 'string' ? blockData : JSON.stringify(blockData);
}

/**
 * Get note content for an asset
 * Returns the BlockNote content if the asset has a linked notes document
 */
export const getAssetNoteContent = withAuth(async (user, { tenant }, assetId: string): Promise<AssetNoteContent | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const asset = await assertAssetAccess(trx, tenant, user, assetId, 'read');
      const assetWithNotes = await tenantScopedTable(trx, tenant, 'assets')
        .where({ asset_id: asset.asset_id }).select('notes_document_id').first();
      if (!assetWithNotes?.notes_document_id) return { document: null, blockData: null, lastUpdated: null };

      const document = await tenantScopedTable(trx, tenant, 'documents')
        .where({ document_id: assetWithNotes.notes_document_id }).first() as IDocument | undefined;
      if (!document) return { document: null, blockData: null, lastUpdated: null };

      const blockContent = await tenantScopedTable(trx, tenant, 'document_block_content')
        .where({ document_id: assetWithNotes.notes_document_id })
        .select('block_data', 'updated_at').first();
      let parsedBlockData: unknown | null = null;
      if (blockContent?.block_data) {
        if (typeof blockContent.block_data === 'string') {
          try { parsedBlockData = JSON.parse(blockContent.block_data); }
          catch { parsedBlockData = blockContent.block_data; }
        } else parsedBlockData = blockContent.block_data;
      }
      return { document, blockData: parsedBlockData, lastUpdated: blockContent?.updated_at || document.updated_at || null };
    });
  } catch (error) {
    console.error('Error getting asset note content:', error);
    const expectedError = assetActionErrorFrom(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }
});

/**
 * Save note content for an asset
 * Creates a new document if one doesn't exist, or updates the existing one
 */
export const saveAssetNote = withAuth(async (
  user,
  { tenant },
  assetId: string,
  blockData: unknown
): Promise<{ document_id: string } | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const asset = await assertAssetAccess(trx, tenant, user, assetId, 'update');
      const details = await tenantScopedTable(trx, tenant, 'assets').where({ asset_id: asset.asset_id })
        .select('name', 'notes_document_id').first();
      const now = trx.fn.now();
      if (details?.notes_document_id) {
        const documentId = details.notes_document_id;
        const value = encodeBlockData(blockData);
        const existing = await tenantScopedTable(trx, tenant, 'document_block_content')
          .where({ document_id: documentId }).first();
        if (existing) {
          await tenantScopedTable(trx, tenant, 'document_block_content').where({ document_id: documentId })
            .update({ block_data: value, updated_at: now });
        } else {
          await tenantScopedTable(trx, tenant, 'document_block_content').insert({
            content_id: uuidv4(), document_id: documentId, block_data: value, tenant,
            created_at: now, updated_at: now,
          });
        }
        await tenantScopedTable(trx, tenant, 'documents').where({ document_id: documentId })
          .update({ updated_at: now, edited_by: user.user_id });
        return { document_id: documentId };
      }

      const documentId = uuidv4();
      await tenantScopedTable(trx, tenant, 'documents').insert({
        document_id: documentId, document_name: `${details.name} Notes`, user_id: user.user_id,
        created_by: user.user_id, tenant, type_id: null, order_number: 0,
      });
      await tenantScopedTable(trx, tenant, 'document_block_content').insert({
        content_id: uuidv4(), document_id: documentId, block_data: encodeBlockData(blockData), tenant,
        created_at: now, updated_at: now,
      });
      await tenantScopedTable(trx, tenant, 'document_associations').insert({
        association_id: uuidv4(), document_id: documentId, entity_id: assetId,
        entity_type: 'asset', tenant, created_at: now,
      });
      await tenantScopedTable(trx, tenant, 'assets').where({ asset_id: asset.asset_id })
        .update({ notes_document_id: documentId, updated_at: now });
      return { document_id: documentId };
    });
  } catch (error) {
    console.error('Error saving asset note:', error);
    const expectedError = assetActionErrorFrom(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }
});

/**
 * Delete notes for an asset
 * Removes the link and optionally deletes the document
 */
export const deleteAssetNote = withAuth(async (
  user,
  { tenant },
  assetId: string,
  deleteDocument: boolean = false
): Promise<void | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const asset = await assertAssetAccess(trx, tenant, user, assetId, 'delete');
      const current = await tenantScopedTable(trx, tenant, 'assets').where({ asset_id: asset.asset_id })
        .select('notes_document_id').first();
      if (!current?.notes_document_id) return;
      // Unlink the document from the asset
      await tenantScopedTable(trx, tenant, 'assets')
        .where({ asset_id: asset.asset_id })
        .update({
          notes_document_id: null,
          updated_at: trx.fn.now(),
        });

      // Optionally delete the document entirely
      if (deleteDocument) {
        // Delete block content first (due to FK)
        await tenantScopedTable(trx, tenant, 'document_block_content')
          .where({ document_id: current.notes_document_id })
          .delete();

        // Delete document associations
        await tenantScopedTable(trx, tenant, 'document_associations')
          .where({ document_id: current.notes_document_id })
          .delete();

        // Delete the document
        await tenantScopedTable(trx, tenant, 'documents')
          .where({ document_id: current.notes_document_id })
          .delete();
      }
    });
  } catch (error) {
    console.error('Error deleting asset note:', error);
    const expectedError = assetActionErrorFrom(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }
});
