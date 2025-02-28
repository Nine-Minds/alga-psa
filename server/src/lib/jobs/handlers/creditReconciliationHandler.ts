import { runScheduledCreditBalanceValidation } from '@/lib/actions/creditReconciliationActions';

export interface CreditReconciliationJobData extends Record<string, unknown> {
  tenantId: string;
  companyId?: string; // Optional: process only a specific company
}

/**
 * Job handler for running credit reconciliation
 * This job:
 * 1. Runs credit balance validation for all companies in a tenant or a specific company
 * 2. Creates reconciliation reports for any discrepancies found
 * 3. Also runs credit tracking validations to identify missing or inconsistent entries
 * 
 * @param data Job data containing tenant ID and optional company ID
 */
export async function creditReconciliationHandler(data: CreditReconciliationJobData): Promise<void> {
  const { tenantId, companyId } = data;
  
  if (!tenantId) {
    throw new Error('Tenant ID is required for credit reconciliation job');
  }
  
  console.log(`Running credit reconciliation for tenant ${tenantId}${companyId ? ` and company ${companyId}` : ''}`);
  
  try {
    const results = await runScheduledCreditBalanceValidation(companyId);
    
    console.log(`Credit reconciliation completed for tenant ${tenantId}`);
    console.log(`Results: ${results.balanceValidCount} valid balances, ${results.balanceDiscrepancyCount} balance discrepancies found`);
    console.log(`Credit tracking: ${results.missingTrackingCount} missing entries, ${results.inconsistentTrackingCount} inconsistent entries`);
    console.log(`Errors: ${results.errorCount}`);
  } catch (error) {
    console.error(`Error running credit reconciliation for tenant ${tenantId}:`, error);
    throw error; // Re-throw to let pg-boss handle the failure
  }
}