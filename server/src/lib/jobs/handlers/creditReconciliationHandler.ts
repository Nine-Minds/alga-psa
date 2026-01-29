import { runScheduledCreditBalanceValidation } from '@alga-psa/billing/actions/creditReconciliationActions';
import { runWithTenant } from 'server/src/lib/db';

export interface CreditReconciliationJobData extends Record<string, unknown> {
  tenantId: string;
  clientId?: string; // Optional: process only a specific client
}

/**
 * Job handler for running credit reconciliation
 * This job:
 * 1. Runs credit balance validation for all clients in a tenant or a specific client
 * 2. Creates reconciliation reports for any discrepancies found
 * 3. Also runs credit tracking validations to identify missing or inconsistent entries
 *
 * @param data Job data containing tenant ID and optional client ID
 */
export async function creditReconciliationHandler(data: CreditReconciliationJobData): Promise<void> {
  const { tenantId, clientId } = data;

  if (!tenantId) {
    throw new Error('Tenant ID is required for credit reconciliation job');
  }

  console.log(`Running credit reconciliation for tenant ${tenantId}${clientId ? ` and client ${clientId}` : ''}`);

  try {
    // Set tenant context for the background job
    const results = await runWithTenant(tenantId, () =>
      runScheduledCreditBalanceValidation(clientId, 'system')
    );

    console.log(`Credit reconciliation completed for tenant ${tenantId}`);
    console.log(`Results: ${results.balanceValidCount} valid balances, ${results.balanceDiscrepancyCount} balance discrepancies found`);
    console.log(`Credit tracking: ${results.missingTrackingCount} missing entries, ${results.inconsistentTrackingCount} inconsistent entries`);
    console.log(`Errors: ${results.errorCount}`);
  } catch (error) {
    console.error(`Error running credit reconciliation for tenant ${tenantId}:`, error);
    throw error; // Re-throw to let pg-boss handle the failure
  }
}
