import { delegateToTimeSource } from '@alga-psa/scheduling/lib/timeSource';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { createClientContractLineCycles } from '@alga-psa/billing/lib/billing/createBillingCycles';
import { createNextTimePeriod } from '@alga-psa/scheduling/lib/timePeriodAutomation';
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
    // Time-source seam: resolved once per tenant, not per period. A registered non-native source may
    // own this tenant's materialization; native falls through untouched (0 statements).
    const delegated = await delegateToTimeSource({ tenant: tenantId }, (source, ctx) =>
      source.periods.materialize(ctx, tenantKnex, tenantId));
    if (delegated.handled) {
      const { settingsConfigured, period } = delegated.value;
      if (!settingsConfigured) return { status: 'skipped', details: 'Skipped - no time period settings configured' };
      return {
        status: 'completed',
        details: period ? `Created new time period ${period.start_date} to ${period.end_date}` : 'No new time period needed',
      };
    }
    // The settings are loaded from the tenant's own rows inside createNextTimePeriod;
    // this job cannot supply them.
    const { settingsConfigured, period: result } = await createNextTimePeriod(tenantKnex, tenantId);

    if (!settingsConfigured) {
      logger.debug(`No time period settings configured for tenant ${tenantId}, skipping time period creation`);
      return { status: 'skipped', details: 'Skipped - no time period settings configured' };
    }

    const details = result
      ? `Created new time period ${result.start_date} to ${result.end_date}`
      : 'No new time period needed';
    logger.info(`Time period creation completed for tenant ${tenantId}: ${details}`);
    return { status: 'completed', details };
  });
}
