import logger from '@alga-psa/core/logger';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { productTimeEntryMode } from '@alga-psa/types';
import { createClientContractLineCycles } from '@alga-psa/billing/lib/billing/createBillingCycles';
import { createNextTimePeriod } from '@alga-psa/scheduling/actions/timePeriodsActions';
import { TimePeriodSettings } from '@alga-psa/scheduling/models/timePeriodSettings';
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

export async function createNextTimePeriodForTenant(tenantId: string): Promise<NextTimePeriodOutcome> {
  return runWithTenant(tenantId, async () => {
    const tenantKnex = await getConnection(tenantId);
    // A workspace without time tracking, or a co-managed workspace whose
    // lifecycle no longer allows writes, gets no new periods.
    const blocked = await withTransaction(tenantKnex, async (trx) => {
      const workspace = await tenantDb(trx, tenantId).table('tenants').first('product_code');
      if (!workspace || !productTimeEntryMode(workspace.product_code)) return 'time tracking is unavailable for this product';
      const state = await getCoManagedOperationalState(trx, tenantId);
      return state.canWrite ? null : `co-management ${state.state}`;
    });
    if (blocked) {
      return { status: 'skipped', details: `Skipped - ${blocked}` };
    }

    const settings = await TimePeriodSettings.getActiveSettings(tenantKnex, tenantId);

    if (!settings || settings.length === 0) {
      logger.debug(`No time period settings configured for tenant ${tenantId}, skipping time period creation`);
      return { status: 'skipped', details: 'Skipped - no time period settings configured' };
    }

    const result = await createNextTimePeriod(settings);
    const details = result
      ? `Created new time period ${result.start_date} to ${result.end_date}`
      : 'No new time period needed';
    logger.info(`Time period creation completed for tenant ${tenantId}: ${details}`);
    return { status: 'completed', details };
  });
}
