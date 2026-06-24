import logger from '@alga-psa/core/logger';
import { createTenantKnex, getConnection } from '@alga-psa/db';
import type { Knex } from 'knex';

import { allIndexers, getIndexer } from '@alga-psa/search';
import { deleteSearchDoc, upsertSearchDoc } from '@alga-psa/search/upsert';
import type { EntityIndexer } from '@alga-psa/types';

export const SEARCH_RECONCILE_JOB_NAME = 'search:reconcile';
const RECONCILE_BATCH_SIZE = 500;

export interface SearchReconcileJobData extends Record<string, unknown> {
  tenantId?: string;
  type?: string;
}

interface TenantRecord {
  tenant: string;
}

interface WatermarkRow {
  max_source_updated_at: Date | string | null;
}

interface IndexedObjectRow {
  object_id: string;
}

async function resolveReconcileTenants(data: SearchReconcileJobData): Promise<string[]> {
  if (data.tenantId) {
    return [data.tenantId];
  }

  const knex = await getConnection(null);
  const rows = await knex<TenantRecord>('tenants')
    .select('tenant')
    .orderBy('tenant', 'asc');

  return rows.map((row) => row.tenant);
}

function resolveReconcileIndexers(data: SearchReconcileJobData): EntityIndexer[] {
  if (!data.type) {
    return allIndexers();
  }

  const indexer = getIndexer(data.type);
  if (!indexer) {
    logger.info('[SearchReconcileJob] Skipping unregistered search object_type', {
      objectType: data.type,
    });
    return [];
  }

  return [indexer];
}

async function getIndexedWatermark(
  knex: Knex,
  tenant: string,
  indexer: EntityIndexer,
): Promise<Date | null> {
  const result = await knex.raw<{ rows: WatermarkRow[] }>(
    `
      SELECT max(source_updated_at) AS max_source_updated_at
      FROM app_search_index
      WHERE tenant = ?::uuid
        AND object_type = ?
    `,
    [tenant, indexer.objectType],
  );

  const value = result.rows[0]?.max_source_updated_at;
  return value ? new Date(value) : null;
}

function isNewerThanWatermark(sourceUpdatedAt: Date, watermark: Date | null): boolean {
  if (!watermark) {
    return true;
  }

  const sourceTime = sourceUpdatedAt.getTime();
  const watermarkTime = watermark.getTime();
  return Number.isFinite(sourceTime) && Number.isFinite(watermarkTime) && sourceTime > watermarkTime;
}

export async function reindexRowsAfterWatermark(
  knex: Knex,
  tenant: string,
  indexer: EntityIndexer,
): Promise<{ scanned: number; reindexed: number }> {
  const watermark = await getIndexedWatermark(knex, tenant, indexer);
  let cursor: string | null = null;
  let scanned = 0;
  let reindexed = 0;

  while (true) {
    const docs = await indexer.loadBatch(knex, tenant, cursor, RECONCILE_BATCH_SIZE);
    if (docs.length === 0) {
      break;
    }

    for (const doc of docs) {
      scanned += 1;
      if (isNewerThanWatermark(doc.sourceUpdatedAt, watermark)) {
        await upsertSearchDoc(knex, doc);
        reindexed += 1;
      }
    }

    cursor = docs[docs.length - 1]?.objectId ?? cursor;
    if (docs.length < RECONCILE_BATCH_SIZE) {
      break;
    }
  }

  return { scanned, reindexed };
}

export async function deleteRowsMissingFromSource(
  knex: Knex,
  tenant: string,
  indexer: EntityIndexer,
): Promise<{ checked: number; deleted: number }> {
  let cursor: string | null = null;
  let checked = 0;
  let deleted = 0;

  while (true) {
    const query = knex<IndexedObjectRow>('app_search_index')
      .select('object_id')
      .where('tenant', tenant)
      .andWhere('object_type', indexer.objectType)
      .orderBy('object_id', 'asc')
      .limit(RECONCILE_BATCH_SIZE);

    if (cursor) {
      query.andWhere('object_id', '>', cursor);
    }

    const rows = await query;
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      checked += 1;
      const doc = await indexer.loadOne(knex, tenant, row.object_id);
      if (!doc) {
        await deleteSearchDoc(knex, tenant, indexer.objectType, row.object_id);
        deleted += 1;
      }
    }

    cursor = rows[rows.length - 1]?.object_id ?? cursor;
    if (rows.length < RECONCILE_BATCH_SIZE) {
      break;
    }
  }

  return { checked, deleted };
}

export async function insertRowsMissingFromIndex(
  knex: Knex,
  tenant: string,
  indexer: EntityIndexer,
): Promise<{ scanned: number; inserted: number }> {
  let cursor: string | null = null;
  let scanned = 0;
  let inserted = 0;

  while (true) {
    const docs = await indexer.loadBatch(knex, tenant, cursor, RECONCILE_BATCH_SIZE);
    if (docs.length === 0) {
      break;
    }

    const objectIds = docs.map((doc) => doc.objectId);
    const existingRows = await knex<IndexedObjectRow>('app_search_index')
      .select('object_id')
      .where('tenant', tenant)
      .andWhere('object_type', indexer.objectType)
      .whereIn('object_id', objectIds);
    const existingIds = new Set(existingRows.map((row) => row.object_id));

    for (const doc of docs) {
      scanned += 1;
      if (!existingIds.has(doc.objectId)) {
        await upsertSearchDoc(knex, doc);
        inserted += 1;
      }
    }

    cursor = docs[docs.length - 1]?.objectId ?? cursor;
    if (docs.length < RECONCILE_BATCH_SIZE) {
      break;
    }
  }

  return { scanned, inserted };
}

export async function searchReconcileHandler(data: SearchReconcileJobData): Promise<void> {
  const tenants = await resolveReconcileTenants(data);
  const indexers = resolveReconcileIndexers(data);
  // When the job targets a single tenant (manual / targeted run) a failure
  // should surface so the operator sees it. When sweeping every tenant
  // (nightly cron) one poisoned tenant must NOT abort the rest or cause
  // pg-boss to perpetually retry the whole batch — reconcile is idempotent
  // and self-healing, so we isolate, log, and continue.
  const isSingleTenantRun = Boolean(data.tenantId);
  const failedTenants: Array<{ tenant: string; message: string }> = [];

  for (const tenant of tenants) {
    try {
      const { knex } = await createTenantKnex(tenant);
      for (const indexer of indexers) {
        try {
          const updatedCounts = await reindexRowsAfterWatermark(knex, tenant, indexer);
          const staleCounts = await deleteRowsMissingFromSource(knex, tenant, indexer);
          const missingCounts = await insertRowsMissingFromIndex(knex, tenant, indexer);
          logger.info('[SearchReconcileJob] Re-indexed rows after watermark', {
            tenant,
            objectType: indexer.objectType,
            ...updatedCounts,
            staleChecked: staleCounts.checked,
            staleDeleted: staleCounts.deleted,
            missingScanned: missingCounts.scanned,
            missingInserted: missingCounts.inserted,
          });
        } catch (error) {
          if (isSingleTenantRun) {
            throw error;
          }
          logger.error('[SearchReconcileJob] Indexer failed; continuing', {
            tenant,
            objectType: indexer.objectType,
            error: error instanceof Error ? error.message : String(error),
          });
          failedTenants.push({
            tenant,
            message: `${indexer.objectType}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    } catch (error) {
      if (isSingleTenantRun) {
        throw error;
      }
      logger.error('[SearchReconcileJob] Tenant failed; continuing', {
        tenant,
        error: error instanceof Error ? error.message : String(error),
      });
      failedTenants.push({
        tenant,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failedTenants.length > 0) {
    logger.error('[SearchReconcileJob] Completed with tenant failure(s)', {
      failedCount: failedTenants.length,
      totalTenants: tenants.length,
      failures: failedTenants,
    });
  }
}
