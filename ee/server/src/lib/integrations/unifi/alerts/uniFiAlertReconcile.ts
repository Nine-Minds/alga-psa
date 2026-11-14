import { createTenantKnex } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import { registerRmmAlertFetcher, runRmmAlertReconciliation } from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { unifiAlertFetcher } from './reconciliationFetcher';

/**
 * One reconciliation cycle for the tenant's UniFi integration, run on demand
 * (after connect, and from "Check Offline Devices Now") instead of waiting for
 * the next scheduled poll. Goes through the same shared pipeline as the job.
 */
export async function reconcileUniFiAlertsNow(tenant: string) {
  const { knex } = await createTenantKnex();
  const integration = await tenantDb(knex, tenant).table('rmm_integrations').where({ provider: 'unifi' }).first('integration_id');
  if (!integration?.integration_id) {
    throw new Error('UniFi integration is not configured.');
  }
  registerRmmAlertFetcher('unifi', unifiAlertFetcher);
  return runRmmAlertReconciliation(
    { knex, deps: buildRmmAlertPipelineDeps() },
    { tenantId: tenant, integrationId: String(integration.integration_id), provider: 'unifi' }
  );
}
