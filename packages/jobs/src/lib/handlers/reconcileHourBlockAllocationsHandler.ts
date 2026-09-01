import { Job } from 'pg-boss';
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { reconcileClientAllocations } from '@alga-psa/shared/billingClients/hourBlockService';
import logger from '@alga-psa/core/logger';

// Export the interface, making it explicitly compatible with Record<string, unknown>
export interface ReconcileHourBlockAllocationsJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string;
}

/**
 * Nightly job that recomputes hour-block burn allocations for every client
 * that owns at least one block. Convergence is per client via
 * reconcileClientAllocations (reverse + re-allocate from current state), so
 * contract-signing after a burn, approval changes, and edited durations all
 * settle into the canonical FIFO state. Idempotent by construction.
 */
export async function handleReconcileHourBlockAllocations(
  job: Job<ReconcileHourBlockAllocationsJobData>,
): Promise<void> {
  const { tenantId, clientId } = job.data;
  logger.info(`Starting hour-block allocation reconciliation job for tenant: ${tenantId}`);

  try {
    const { knex } = await createTenantKnex();

    if (clientId) {
      await knex.transaction(async (trx: Knex.Transaction) => {
        if (!trx.client?.config?.tenant) {
          trx.client = trx.client || {};
          trx.client.config = trx.client.config || {};
          trx.client.config.tenant = tenantId;
        }
        const reconciled = await reconcileClientAllocations(trx, tenantId, clientId);
        logger.info(`Reconciled hour-block allocations for client ${clientId}: ${reconciled} entries`, {
          tenantId,
          clientId,
          reconciled,
        });
      });
      return;
    }

    const clientRows = await tenantDb(knex, tenantId)
      .table('hour_blocks')
      .where({ status: 'active' })
      .distinct('client_id')
      .select('client_id');

    logger.info(`Found ${clientRows.length} clients with hour blocks to reconcile for tenant ${tenantId}.`);

    let successCount = 0;
    let errorCount = 0;

    for (const row of clientRows) {
      const currentClientId = row.client_id;
      try {
        await knex.transaction(async (trx: Knex.Transaction) => {
          if (!trx.client?.config?.tenant) {
            trx.client = trx.client || {};
            trx.client.config = trx.client.config || {};
            trx.client.config.tenant = tenantId;
          }
          const reconciled = await reconcileClientAllocations(trx, tenantId, currentClientId);
          logger.info(`Reconciled hour-block allocations for client ${currentClientId}: ${reconciled} entries`);
        });
        successCount += 1;
      } catch (error) {
        logger.error(`Error reconciling hour-block allocations for client ${currentClientId}:`, error);
        errorCount += 1;
      }
    }

    logger.info(
      `Finished hour-block allocation reconciliation job for tenant ${tenantId}. Success: ${successCount}, Errors: ${errorCount}`,
    );
  } catch (error) {
    logger.error(`Fatal error during hour-block allocation reconciliation job for tenant ${tenantId}:`, error);
    throw error;
  }
}
