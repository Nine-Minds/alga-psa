import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';

import { getIndexer } from '../../search';
import { deleteSearchDoc, upsertSearchDoc } from '../../search/upsert';

export const SEARCH_VISIBLE_USER_REINDEX_JOB_NAME = 'search-visible-user-reindex';

export interface SearchVisibleUserReindexJobData extends Record<string, unknown> {
  tenantId: string;
  userId: string;
  batchSize?: number;
}

interface SearchVisibilityRow {
  object_type: string;
  object_id: string;
}

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;

function normalizeBatchSize(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.max(1, Math.min(Math.floor(parsed), MAX_BATCH_SIZE));
}

export async function searchVisibleUserReindexHandler(
  data: SearchVisibleUserReindexJobData,
): Promise<void> {
  const { tenantId, userId } = data;
  if (!tenantId || !userId) {
    logger.warn('[SearchVisibleUserReindexJob] Missing tenantId or userId', { tenantId, userId });
    return;
  }

  const batchSize = normalizeBatchSize(data.batchSize);
  const { knex } = await createTenantKnex(tenantId);

  let cursorObjectType: string | undefined;
  let cursorObjectId: string | undefined;
  let scanned = 0;
  let reindexed = 0;
  let deleted = 0;
  let skipped = 0;

  while (true) {
    const query = knex<SearchVisibilityRow>('app_search_index')
      .select('object_type', 'object_id')
      .where('tenant', tenantId)
      .whereRaw('?::uuid = ANY(visible_to_user_ids)', [userId])
      .orderBy('object_type', 'asc')
      .orderBy('object_id', 'asc')
      .limit(batchSize);

    if (cursorObjectType && cursorObjectId) {
      const afterObjectType = cursorObjectType;
      const afterObjectId = cursorObjectId;
      query.andWhere(function() {
        this.where('object_type', '>', afterObjectType)
          .orWhere(function() {
            this.where('object_type', afterObjectType)
              .andWhere('object_id', '>', afterObjectId);
          });
      });
    }

    const rows = await query;
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      scanned += 1;
      const indexer = getIndexer(row.object_type);
      if (!indexer) {
        skipped += 1;
        continue;
      }

      const doc = await indexer.loadOne(knex, tenantId, row.object_id);
      if (doc) {
        await upsertSearchDoc(knex, doc);
        reindexed += 1;
      } else {
        await deleteSearchDoc(knex, tenantId, indexer.objectType, row.object_id);
        deleted += 1;
      }
    }

    cursorObjectType = rows[rows.length - 1]?.object_type;
    cursorObjectId = rows[rows.length - 1]?.object_id;

    if (rows.length < batchSize) {
      break;
    }
  }

  logger.info('[SearchVisibleUserReindexJob] Completed visible-user search re-index', {
    tenantId,
    userId,
    scanned,
    reindexed,
    deleted,
    skipped,
  });
}
