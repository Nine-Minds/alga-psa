import { Job } from 'pg-boss';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { reconcileBucketUsageRecord } from '@alga-psa/billing/services/bucketUsageService';
import logger from '@alga-psa/core/logger';
import { Temporal } from '@js-temporal/polyfill';
import { toISODate } from '../handler-utils/dateTimeUtils';

// Export the interface, making it explicitly compatible with Record<string, unknown>
export interface ReconcileBucketUsageJobData extends Record<string, unknown> {
 tenantId: string;
}

/**
 * Job handler for reconciling bucket usage records for a specific tenant.
 * Fetches active bucket usage records and calls the reconciliation service function for each.
 */
export async function handleReconcileBucketUsage(job: Job<ReconcileBucketUsageJobData>): Promise<void> {
  const { tenantId } = job.data;
  logger.info(`Starting bucket usage reconciliation job for tenant: ${tenantId}`);

 let knex;
 try {
   // Create a Knex instance. Tenant filtering will be applied in queries.
   const { knex: baseKnex } = await createTenantKnex(); // No tenantId argument
   knex = baseKnex;

    const currentDateISO = toISODate(Temporal.Now.plainDateISO());

    // Find active bucket usage records for the tenant
    // Active means the current date falls within the period_start and period_end
    const recordsToReconcile = await tenantDb(knex, tenantId).table('bucket_usage')
      .andWhere('period_start', '<=', currentDateISO)
      .andWhere('period_end', '>=', currentDateISO)
      .select('usage_id');

    logger.info(`Found ${recordsToReconcile.length} active bucket usage records to reconcile for tenant ${tenantId}.`);

    let successCount = 0;
    let errorCount = 0;

    for (const record of recordsToReconcile) {
      const { usage_id } = record;
      try {
        // Use a separate transaction for each reconciliation attempt. Tenant is
        // passed explicitly to the service — never mutate the shared transaction
        // config (it is reused across tenants on a multi-tenant worker).
        await knex.transaction(async (trx) => {
          await reconcileBucketUsageRecord(trx, usage_id, tenantId);
        });
        logger.info(`Successfully reconciled bucket usage record ${usage_id} for tenant ${tenantId}.`);
        successCount++;
      } catch (error) {
        logger.error(`Error reconciling bucket usage record ${usage_id} for tenant ${tenantId}:`, error);
        errorCount++;
        // Continue processing other records even if one fails
      }
    }

    logger.info(`Finished bucket usage reconciliation job for tenant ${tenantId}. Success: ${successCount}, Errors: ${errorCount}`);

  } catch (error) {
    logger.error(`Fatal error during bucket usage reconciliation job for tenant ${tenantId}:`, error);
    // Re-throw the error to let pg-boss handle retries/failure marking
    throw error;
  } finally {
    // Ensure the Knex connection is destroyed if we created it here
    // Note: This might interfere with pg-boss connection pooling if not handled carefully.
    // Let the caller manage the lifecycle of the Knex instance if needed.
    // if (knex) {
    //   await knex.destroy();
    // }
  }
}
