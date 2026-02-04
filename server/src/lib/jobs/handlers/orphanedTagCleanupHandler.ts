import logger from '@alga-psa/core/logger';
import { getConnection } from '../../db/db';

const DEFAULT_BATCH_SIZE = 100;

export interface OrphanedTagCleanupJobData {
  trigger?: 'cron' | 'manual';
  batchSize?: number;
  [key: string]: unknown;
}

/**
 * System-wide cleanup job for orphaned tag definitions.
 *
 * This job runs nightly to remove tag definitions that are no longer
 * referenced by any tag mappings. It iterates through all tenants
 * (required for Citus compatibility) and cleans up orphaned tags in batches.
 *
 * Orphaned tags can occur when:
 * - Entities with tags are deleted
 * - Tags are removed from entities
 * - Database inconsistencies occur
 *
 * The cleanup is safe because tag definitions without mappings are never
 * shown in the UI and serve no purpose.
 */
export async function orphanedTagCleanupHandler(data: OrphanedTagCleanupJobData): Promise<void> {
  const { trigger = 'cron', batchSize = DEFAULT_BATCH_SIZE } = data;

  logger.info('[orphanedTagCleanupHandler] Starting system-wide orphaned tag cleanup', {
    trigger,
    batchSize,
  });

  try {
    const knex = await getConnection(null);

    // Get all tenants
    const tenants = await knex('tenants').select('tenant');

    const results: Record<string, number> = {};
    let totalDeleted = 0;

    // Process each tenant (required for Citus compatibility)
    for (const { tenant } of tenants) {
      try {
        let tenantDeleted = 0;
        let batchDeleted: number;

        // Delete in batches to avoid long-running transactions
        do {
          const result = await knex.raw(`
            DELETE FROM tag_definitions
            WHERE tag_id IN (
              SELECT td.tag_id
              FROM tag_definitions td
              WHERE td.tenant = ?
              AND NOT EXISTS (
                SELECT 1
                FROM tag_mappings tm
                WHERE tm.tenant = td.tenant
                AND tm.tag_id = td.tag_id
              )
              LIMIT ?
            )
            AND tenant = ?
            RETURNING tag_id
          `, [tenant, batchSize, tenant]);

          batchDeleted = result.rows?.length ?? 0;
          tenantDeleted += batchDeleted;

          if (batchDeleted > 0) {
            logger.debug('[orphanedTagCleanupHandler] Deleted batch of orphaned tags', {
              tenant,
              batchDeleted,
              tenantTotal: tenantDeleted,
            });
          }
        } while (batchDeleted === batchSize);

        if (tenantDeleted > 0) {
          results[tenant] = tenantDeleted;
          totalDeleted += tenantDeleted;
        }
      } catch (tenantError) {
        logger.error('[orphanedTagCleanupHandler] Failed to clean up orphaned tags for tenant', {
          tenant,
          error: tenantError,
        });
        // Continue with other tenants
      }
    }

    if (totalDeleted > 0) {
      logger.info('[orphanedTagCleanupHandler] Cleaned up orphaned tag definitions', {
        totalDeleted,
        byTenant: results,
      });
    } else {
      logger.debug('[orphanedTagCleanupHandler] No orphaned tags found');
    }
  } catch (error) {
    logger.error('[orphanedTagCleanupHandler] Failed to clean up orphaned tags', { error });
    throw error;
  }
}
