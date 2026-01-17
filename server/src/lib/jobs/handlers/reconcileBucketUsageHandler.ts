import { Job } from 'pg-boss';
import { createTenantKnex } from 'server/src/lib/db';
import { reconcileBucketUsageRecord } from 'server/src/lib/services/bucketUsageService';
import logger from '@alga-psa/core/logger';
import { Temporal } from '@js-temporal/polyfill';
import { toISODate } from 'server/src/lib/utils/dateTimeUtils';

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
    const recordsToReconcile = await knex('bucket_usage')
      .where('tenant', tenantId)
      .andWhere('period_start', '<=', currentDateISO)
      .andWhere('period_end', '>=', currentDateISO)
      .select('usage_id');

    logger.info(`Found ${recordsToReconcile.length} active bucket usage records to reconcile for tenant ${tenantId}.`);

    let successCount = 0;
    let errorCount = 0;

    for (const record of recordsToReconcile) {
      const { usage_id } = record;
      try {
        // Use a separate transaction for each reconciliation attempt
        await knex.transaction(async (trx) => {
          // Manually set tenant context on the transaction object if needed by the service
          // This depends on how createTenantKnex and the service interact with transactions
          // If createTenantKnex already configures the trx object, this might not be necessary.
          // Assuming reconcileBucketUsageRecord can derive tenant from trx or uses its own logic.

          // Ensure the transaction object has the tenant context if required by the service
          if (!trx.client?.config?.tenant) {
             trx.client = trx.client || {}; // Ensure client exists
             trx.client.config = trx.client.config || {}; // Ensure config exists
             trx.client.config.tenant = tenantId;
          }

          await reconcileBucketUsageRecord(trx, usage_id);
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