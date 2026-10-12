import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { withTimePeriodWriteAdmission } from '@alga-psa/co-managed';
import { createClientContractLineCycles } from '@alga-psa/billing/lib/billing/createBillingCycles';
import { createNextTimePeriodsAdmitted, NO_ACTIVE_TIME_PERIOD_SETTINGS } from '@alga-psa/scheduling/lib/timePeriodMaterialization';
import { getConnection } from 'server/src/lib/db/db';
import { runWithTenant } from 'server/src/lib/db';

/**
 * Bodies of the two nightly billing/time-period jobs, shared by the CE pg-boss
 * chain (initializeApp) and the EE Temporal maintenance fan-out
 * (registerServerMaintenanceJobs) so both editions run identical work.
 */

export async function createClientContractLineCyclesForAllTenants(): Promise<void> {
  const rootKnex = await getConnection(null);
  const tenants = await tenantDb(rootKnex, '__billing_cycle_tenant_enumeration__')
    .unscoped('tenants', 'billing cycle job enumerates all tenants to run per-tenant cycle jobs')
    .whereNull('suspended_at')
    .select('tenant');

  for (const { tenant } of tenants) {
    try {
      const tenantKnex = await getConnection(tenant);
      const clients = await tenantDb(tenantKnex, tenant).table('clients')
        .where({ is_inactive: false })
        .select('*');

      for (const client of clients) {
        try {
          await createClientContractLineCycles(tenantKnex, client);
        } catch (error) {
          logger.error(`Error creating billing cycles for client ${client.client_id} in tenant ${tenant}:`, error);
        }
      }
    } catch (error) {
      logger.error(`Error processing tenant ${tenant}:`, error);
    }
  }
}

export type NextTimePeriodOutcome =
  | { status: 'skipped'; details: string }
  | { status: 'completed'; details: string };

/** Horizon (days ahead) the nightly run fills periods through. */
const NEXT_TIME_PERIOD_HORIZON_DAYS = 5;

export async function createNextTimePeriodForTenant(tenantId: string): Promise<NextTimePeriodOutcome> {
  return runWithTenant(tenantId, async () => {
    const tenantKnex = await getConnection(tenantId);
    // Lifecycle admission, the stored-settings read and the period write share
    // ONE transaction (the same fence the queue-identity job uses): a co-managed
    // workspace whose sponsor goes read-only mid-run is either serialized behind
    // it or rolls every generated period back, instead of being checked and
    // then written in separate transactions.
    const outcome = await withTimePeriodWriteAdmission(tenantKnex, tenantId, (trx) =>
      createNextTimePeriodsAdmitted(trx, tenantId, NEXT_TIME_PERIOD_HORIZON_DAYS));

    if (outcome.status === 'skipped') {
      return { status: 'skipped', details: `Skipped - ${outcome.reason}` };
    }
    if (outcome.result.reason === NO_ACTIVE_TIME_PERIOD_SETTINGS) {
      logger.debug(`No time period settings configured for tenant ${tenantId}, skipping time period creation`);
      return { status: 'skipped', details: 'Skipped - no time period settings configured' };
    }
    const { period } = outcome.result;
    const details = period
      ? `Created new time period ${period.start_date} to ${period.end_date}`
      : 'No new time period needed';
    logger.info(`Time period creation completed for tenant ${tenantId}: ${details}`);
    return { status: 'completed', details };
  });
}
