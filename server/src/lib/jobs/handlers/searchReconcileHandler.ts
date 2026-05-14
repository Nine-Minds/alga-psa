import logger from '@alga-psa/core/logger';
import { createTenantKnex, getConnection } from '@alga-psa/db';
import type { Knex } from 'knex';

import { allIndexers, getIndexer } from '../../search';
import { upsertSearchDoc } from '../../search/upsert';
import type { EntityIndexer } from '../../search/types';

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
    throw new Error(`Unknown search object_type "${data.type}"`);
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

export async function searchReconcileHandler(data: SearchReconcileJobData): Promise<void> {
  const tenants = await resolveReconcileTenants(data);
  const indexers = resolveReconcileIndexers(data);

  for (const tenant of tenants) {
    const { knex } = await createTenantKnex(tenant);
    for (const indexer of indexers) {
      const counts = await reindexRowsAfterWatermark(knex, tenant, indexer);
      logger.info('[SearchReconcileJob] Re-indexed rows after watermark', {
        tenant,
        objectType: indexer.objectType,
        ...counts,
      });
    }
  }
}
