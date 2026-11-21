'use server';

/**
 * Asset Notes Actions
 *
 * Server actions for managing BlockNote-formatted notes on assets. Authorization
 * and note persistence share one transaction so API routes and direct callers
 * receive the same record-level protection.
 */

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';
import type { IDocument } from '@alga-psa/types';
import { authorizeAndRedactDocuments } from '@shared/lib/documentAuthorization';
import { createAssetReadContext, isAssetActionAllowed } from '../lib/assetReadAuthorization';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
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

type AssetNoteOperation = 'read' | 'update' | 'delete';

function denied(message: string): AssetActionError {
  return permissionError(message);
}

async function authorizeAssetNoteOperation(
  trx: Knex.Transaction,
  tenant: string,
  user: any,
  asset: { asset_id: string; client_id?: string | null },
  action: AssetNoteOperation,
): Promise<boolean> {
  if (!await hasPermission(user, 'asset', action, trx)) return false;
  const context = await createAssetReadContext(trx, tenant, user);
  return isAssetActionAllowed(trx, tenant, context, asset, action);
}

async function authorizedLinkedDocument(
  trx: Knex.Transaction,
  tenant: string,
  user: any,
  documentId: string,
): Promise<IDocument | null> {
  const document = await tenantScopedTable(trx, tenant, 'documents')
    .where({ document_id: documentId })
    .first() as IDocument | undefined;
  if (!document || !await hasPermission(user, 'document', 'read', trx)) return null;

  const [authorizedDocument] = await authorizeAndRedactDocuments(trx, tenant, user, [document]);
  return authorizedDocument ?? null;
}

/**
 * Get note content for an asset. Asset and document authorization are checked
 * before any note data is returned.
 */
export const getAssetNoteContent = withAuth(async (user, { tenant }, assetId: string): Promise<AssetNoteContent | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const asset = await tenantScopedTable(trx, tenant, 'assets')
        .where({ asset_id: assetId })
        .select('asset_id', 'client_id', 'notes_document_id')
        .first();

      if (!asset) {
        return assetActionErrorFrom(new Error('Asset not found'))!;
      }
      if (!await authorizeAssetNoteOperation(trx, tenant, user, asset, 'read')) {
        return denied('Permission denied: Cannot read asset notes');
      }
      if (!asset.notes_document_id) {
        return { document: null, blockData: null, lastUpdated: null };
      }

      const document = await authorizedLinkedDocument(trx, tenant, user, asset.notes_document_id);
      if (!document) return denied('Permission denied: Cannot read asset note document');

      const blockContent = await tenantScopedTable(trx, tenant, 'document_block_content')
        .where({ document_id: document.document_id })
        .select('block_data', 'updated_at')
        .first();
      let parsedBlockData: unknown | null = null;
      if (blockContent?.block_data) {
        if (typeof blockContent.block_data === 'string') {
          try {
            parsedBlockData = JSON.parse(blockContent.block_data);
          } catch {
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
    });
  } catch (error) {
    console.error('Error getting asset note content:', error);
    const expectedError = assetActionErrorFrom(error);
    if (expectedError) return expectedError;
    throw error;
  }
});

/** Create a note or overwrite the document already linked to this asset. */
export const saveAssetNote = withAuth(async (
  user,
  { tenant },
  assetId: string,
  blockData: unknown
): Promise<{ document_id: string } | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const asset = await tenantScopedTable(trx, tenant, 'assets')
        .where({ asset_id: assetId })
        .select('asset_id', 'name', 'client_id', 'notes_document_id')
        .first();
      if (!asset) return assetActionErrorFrom(new Error('Asset not found'))!;
      if (!await authorizeAssetNoteOperation(trx, tenant, user, asset, 'update')) {
        return denied('Permission denied: Cannot update asset notes');
      }

      if (asset.notes_document_id) {
        if (!await hasPermission(user, 'document', 'update', trx)) {
          return denied('Permission denied: Cannot update asset note document');
        }
        const document = await authorizedLinkedDocument(trx, tenant, user, asset.notes_document_id);
        if (!document) return denied('Permission denied: Cannot update asset note document');

        const serialized = typeof blockData === 'string' ? blockData : JSON.stringify(blockData);
        const existingContent = await tenantScopedTable(trx, tenant, 'document_block_content')
          .where({ document_id: document.document_id }).first('content_id');
        if (existingContent) {
          await tenantScopedTable(trx, tenant, 'document_block_content')
            .where({ document_id: document.document_id })
            .update({ block_data: serialized, updated_at: trx.fn.now() });
        } else {
          await tenantScopedTable(trx, tenant, 'document_block_content').insert({
            content_id: uuidv4(), document_id: document.document_id, block_data: serialized,
            tenant, created_at: trx.fn.now(), updated_at: trx.fn.now(),
          });
        }
        await tenantScopedTable(trx, tenant, 'documents')
          .where({ document_id: document.document_id })
          .update({ updated_at: trx.fn.now(), edited_by: user.user_id });
        return { document_id: document.document_id };
      }

      if (!await hasPermission(user, 'document', 'create', trx)) {
        return denied('Permission denied: Cannot create asset note document');
      }
      const documentId = uuidv4();
      await tenantScopedTable(trx, tenant, 'documents').insert({
        document_id: documentId,
        document_name: `${asset.name} Notes`,
        user_id: user.user_id,
        created_by: user.user_id,
        tenant,
        type_id: null,
        order_number: 0,
      });
      await tenantScopedTable(trx, tenant, 'document_block_content').insert({
        content_id: uuidv4(), document_id: documentId,
        block_data: typeof blockData === 'string' ? blockData : JSON.stringify(blockData),
        tenant, created_at: trx.fn.now(), updated_at: trx.fn.now(),
      });
      await tenantScopedTable(trx, tenant, 'document_associations').insert({
        association_id: uuidv4(), document_id: documentId, entity_id: asset.asset_id,
        entity_type: 'asset', tenant, created_at: trx.fn.now(),
      });
      await tenantScopedTable(trx, tenant, 'assets')
        .where({ asset_id: asset.asset_id })
        .update({ notes_document_id: documentId, updated_at: trx.fn.now() });
      return { document_id: documentId };
    });
  } catch (error) {
    console.error('Error saving asset note:', error);
    const expectedError = assetActionErrorFrom(error);
    if (expectedError) return expectedError;
    throw error;
  }
});

/** Unlink a note; optionally delete its document and content as well. */
export const deleteAssetNote = withAuth(async (
  user,
  { tenant },
  assetId: string,
  deleteDocument: boolean = false
): Promise<void | AssetActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const asset = await tenantScopedTable(trx, tenant, 'assets')
        .where({ asset_id: assetId })
        .select('asset_id', 'client_id', 'notes_document_id')
        .first();
      if (!asset) return assetActionErrorFrom(new Error('Asset not found'))!;
      if (!await authorizeAssetNoteOperation(trx, tenant, user, asset, 'delete')) {
        return denied('Permission denied: Cannot delete asset notes');
      }
      if (!asset.notes_document_id) return;

      const document = await authorizedLinkedDocument(trx, tenant, user, asset.notes_document_id);
      if (!document) return denied('Permission denied: Cannot access asset note document');
      if (deleteDocument) {
        if (!await hasPermission(user, 'document', 'delete', trx)) {
          return denied('Permission denied: Cannot delete asset note document');
        }
      } else if (!await hasPermission(user, 'document', 'update', trx)) {
        return denied('Permission denied: Cannot unlink asset note document');
      }

      await tenantScopedTable(trx, tenant, 'assets')
        .where({ asset_id: asset.asset_id })
        .update({ notes_document_id: null, updated_at: trx.fn.now() });

      if (deleteDocument) {
        await tenantScopedTable(trx, tenant, 'document_block_content')
          .where({ document_id: document.document_id }).delete();
        await tenantScopedTable(trx, tenant, 'document_associations')
          .where({ document_id: document.document_id }).delete();
        await tenantScopedTable(trx, tenant, 'documents')
          .where({ document_id: document.document_id }).delete();
      } else {
        await tenantScopedTable(trx, tenant, 'document_associations')
          .where({ document_id: document.document_id, entity_id: asset.asset_id, entity_type: 'asset' }).delete();
      }
    });
  } catch (error) {
    console.error('Error deleting asset note:', error);
    const expectedError = assetActionErrorFrom(error);
    if (expectedError) return expectedError;
    throw error;
  }
});
