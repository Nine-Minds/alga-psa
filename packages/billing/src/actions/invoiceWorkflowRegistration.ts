import { getActionRegistry, TransactionIsolationLevel } from '@alga-psa/shared/workflow/core';

/**
 * Register invoice-specific actions with the action registry
 * This function should be called during application initialization
 */
export function registerInvoiceActions(): void {
  const registry = getActionRegistry();
  
  // Register action to update invoice status to approved
  registry.registerDatabaseAction(
    'UpdateInvoiceStatusToApproved',
    'Update invoice status to approved',
    [
      { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
      { name: 'approvedBy', type: 'string', required: true, description: 'User who approved the invoice' }
    ],
    TransactionIsolationLevel.REPEATABLE_READ,
    async (params, context) => {
      if (!context.transaction) {
        throw new Error('Transaction required for database action');
      }
      
      await context.transaction('invoices')
        .where({ 
          invoice_id: params.invoiceId,
          tenant: context.tenant 
        })
        .update({
          status: 'approved',
          approved_by: params.approvedBy,
          approved_at: context.transaction.fn.now(),
          updated_at: context.transaction.fn.now()
        });
    }
  );

  // Register action to update invoice status to rejected
  registry.registerDatabaseAction(
    'UpdateInvoiceStatusToRejected',
    'Update invoice status to rejected',
    [
      { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
      { name: 'reason', type: 'string', required: true, description: 'Reason for rejection' },
      { name: 'rejectedBy', type: 'string', required: true, description: 'User who rejected the invoice' }
    ],
    TransactionIsolationLevel.REPEATABLE_READ,
    async (params, context) => {
      if (!context.transaction) {
        throw new Error('Transaction required for database action');
      }
      
      await context.transaction('invoices')
        .where({ 
          invoice_id: params.invoiceId,
          tenant: context.tenant 
        })
        .update({
          status: 'rejected',
          rejection_reason: params.reason,
          rejected_by: params.rejectedBy,
          rejected_at: context.transaction.fn.now(),
          updated_at: context.transaction.fn.now()
        });
    }
  );
}
