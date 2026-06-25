import { createTenantKnex, createTenantScopedQuery, runWithTenant, withTransaction } from '@alga-psa/db';
import { CacheFactory } from '../cache/CacheFactory';

export interface PersistCollabResult {
  success: boolean;
  message?: string;
}

/**
 * Session-less core of the collaborative snapshot save: writes the ProseMirror
 * JSON for an already-authorized document room to document_block_content and
 * invalidates the preview cache. Shared by the browser server action
 * (syncCollabSnapshot) and the internal Hocuspocus persistence route.
 */
export async function persistCollabSnapshot(
  tenant: string,
  documentId: string,
  json: unknown
): Promise<PersistCollabResult> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();

    const updated = await withTransaction(knex, async (trx) => {
      const tenantScopedTable = (table: string) => createTenantScopedQuery(trx, {
        table,
        tenant,
      }).builder;

      const existing = await tenantScopedTable('document_block_content')
        .where({ document_id: documentId })
        .first();

      if (!existing) {
        return null;
      }

      const [result] = await tenantScopedTable('document_block_content')
        .where({ document_id: documentId })
        .update({
          block_data: JSON.stringify(json),
          updated_at: trx.fn.now(),
        })
        .returning(['content_id']);

      return result;
    });

    if (!updated) {
      return { success: false, message: 'Document not found.' };
    }

    // Invalidate preview cache so the grid thumbnail regenerates
    const cache = CacheFactory.getPreviewCache(tenant);
    await cache.delete(documentId);

    return { success: true };
  });
}
