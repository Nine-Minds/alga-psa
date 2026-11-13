import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

import { CLIENT_SCOPE_SOURCES, resolveClientScopes, type ClientScopedObjectType } from '@alga-psa/search/clientScope';

export const SEARCH_CLIENT_SCOPE_REINDEX_JOB_NAME = 'search-client-scope-reindex';

export interface SearchClientScopeReindexJobData extends Record<string, unknown> {
  tenantId: string;
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;

function normalizeBatchSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(Math.floor(parsed), MAX_BATCH_SIZE));
}

/**
 * Fills `client_scope_id` on existing index rows of the types whose indexers now set it
 * (client, contact, interaction, document, time_entry).
 *
 * It does not rebuild documents: it asks the same manifest-driven resolver the indexers use for
 * the owning client of each unscoped row and writes only that column. Rows that already carry a
 * scope are not read, so a second run finds only records that genuinely have no client and
 * changes nothing: the job is safe to repeat, and cheap to run on every deploy.
 */
export async function searchClientScopeReindexHandler(data: SearchClientScopeReindexJobData): Promise<void> {
  const { tenantId } = data;
  if (!tenantId) {
    logger.warn('[SearchClientScopeReindexJob] Missing tenantId');
    return;
  }

  const batchSize = normalizeBatchSize(data.batchSize);
  const { knex } = await createTenantKnex(tenantId);
  const counts: Record<string, { scanned: number; scoped: number }> = {};

  for (const objectType of Object.keys(CLIENT_SCOPE_SOURCES) as ClientScopedObjectType[]) {
    const tally = (counts[objectType] = { scanned: 0, scoped: 0 });
    let cursor: string | undefined;

    while (true) {
      const query = tenantDb(knex, tenantId).table<{ object_id: string }>('app_search_index')
        .select('object_id')
        .where('object_type', objectType)
        .whereNull('client_scope_id')
        .orderBy('object_id', 'asc')
        .limit(batchSize);
      if (cursor) query.andWhere('object_id', '>', cursor);

      const rows = await query;
      if (rows.length === 0) break;

      const objectIds = rows.map((row) => row.object_id);
      const scopes = await resolveClientScopes(knex, tenantId, objectType, objectIds);
      const idsByScope = new Map<string, string[]>();
      for (const [objectId, clientId] of scopes) {
        if (!clientId) continue;
        idsByScope.set(clientId, [...(idsByScope.get(clientId) ?? []), objectId]);
      }

      for (const [clientId, ids] of idsByScope) {
        await tenantDb(knex, tenantId).table('app_search_index')
          .where('object_type', objectType)
          .whereIn('object_id', ids)
          .whereNull('client_scope_id')
          .update({ client_scope_id: clientId });
        tally.scoped += ids.length;
      }

      tally.scanned += rows.length;
      cursor = rows[rows.length - 1].object_id;
      if (rows.length < batchSize) break;
    }
  }

  logger.info('[SearchClientScopeReindexJob] Completed client-scope search re-index', { tenantId, counts });
}
