import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getActionRegistry, TransactionIsolationLevel } from '@alga-psa/shared/workflow/core';
import { getWorkflowRuntime } from '@alga-psa/shared/workflow/core';
import { submitWorkflowEventAction } from '@alga-psa/workflows/actions/workflow-event-actions';



/**
 * Process an invoice approval or rejection event
 */
export async function processInvoiceEvent(executionId: string | undefined, eventName: string, payload: any): Promise<any> {
  // Validate executionId
  if (!executionId) {
    throw new Error('Execution ID is required');
  }
  
  // Submit the event using the workflow event action
  const result = await submitWorkflowEventAction({
    execution_id: executionId,
    event_name: eventName,
    payload
  });
  
  return result;
}

/**
 * Approve an invoice
 * This is a convenience method for the approve action
 */
export async function approveInvoice(invoiceId: string, executionId?: string): Promise<any> {
  const { knex } = await createTenantKnex();
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('No current user found');
  }  
  
  // If execution ID is not provided, look it up
  if (!executionId) {
    const workflowExecution = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('workflow_executions')
      .where('context_data->invoice.id', invoiceId)
      .andWhere('tenant', currentUser.tenant)
      .first('execution_id');
    });
    
    if (!workflowExecution) {
      throw new Error(`No workflow found for invoice ${invoiceId}`);
    }
    
    executionId = workflowExecution.execution_id;
  }
  
  const userId = currentUser.user_id;
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  if (!invoiceId) {
    throw new Error('Invoice ID is required');
  }

  // Process the approval event
  return processInvoiceEvent(executionId, 'Approve', {
    invoiceId, // Now guaranteed to be non-undefined
    approvedBy: userId,
    approval_date: toPlainDate(new Date()).toString()
  });
}

/**
 * Reject an invoice
 * This is a convenience method for the reject action
 */
export async function rejectInvoice(invoiceId: string, reason: string, executionId?: string): Promise<any> {
  const { knex } = await createTenantKnex();
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('No current user found');
  }  
  
  // If execution ID is not provided, look it up
  if (!executionId) {
    const workflowExecution = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('workflow_executions')
      .where('context_data->invoice.id', invoiceId)
      .andWhere('tenant', currentUser.tenant)
      .first('execution_id');
    });
    
    if (!workflowExecution) {
      throw new Error(`No workflow found for invoice ${invoiceId}`);
    }
    
    executionId = workflowExecution.execution_id;
  }
  
  const userId = currentUser.user_id;
  if (!userId) {
    throw new Error('User ID is required');
  }
  
  if (!invoiceId) {
    throw new Error('Invoice ID is required');
  }

  // Process the rejection event
  return processInvoiceEvent(executionId, 'Reject', {
    invoiceId, // Now guaranteed to be non-undefined
    rejectedBy: userId,
    rejection_date: toPlainDate(new Date()).toString(),
    reason: reason || 'No reason provided'
  });
}

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
    TransactionIsolationLevel.REPEATABLE_READ, // Use the enum value for isolation level
    async (params, context) => {
      // Make sure we have a transaction
      if (!context.transaction) {
        throw new Error('Transaction required for database action');
      }
      
      // Update the invoice status
      await context.transaction('invoices')
        .where({ 
          id: params.invoiceId,
          tenant: context.tenant 
        })
        .update({ 
          status: 'approved',
          approved_by: params.approvedBy,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      return { 
        updated: true,
        invoiceId: params.invoiceId,
        status: 'approved'
      };
    }
  );
  
  // Register action to update invoice status to rejected
  registry.registerDatabaseAction(
    'UpdateInvoiceStatusToRejected',
    'Update invoice status to rejected',
    [
      { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
      { name: 'rejectedBy', type: 'string', required: true, description: 'User who rejected the invoice' },
      { name: 'reason', type: 'string', required: false, description: 'Reason for rejection' }
    ],
    TransactionIsolationLevel.REPEATABLE_READ, // Use the enum value for isolation level
    async (params, context) => {
      // Make sure we have a transaction
      if (!context.transaction) {
        throw new Error('Transaction required for database action');
      }
      
      // Update the invoice status
      await context.transaction('invoices')
        .where({ 
          id: params.invoiceId,
          tenant: context.tenant 
        })
        .update({ 
          status: 'rejected',
          rejected_by: params.rejectedBy,
          rejection_reason: params.reason || null,
          rejected_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      return { 
        updated: true,
        invoiceId: params.invoiceId,
        status: 'rejected'
      };
    }
  );
  
  // Register action to send notification
  registry.registerSimpleAction(
    'SendInvoiceNotification',
    'Send notification about invoice status change',
    [
      { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
      { name: 'recipientId', type: 'string', required: true, description: 'User ID of recipient' },
      { name: 'status', type: 'string', required: true, description: 'New invoice status' },
      { name: 'message', type: 'string', required: false, description: 'Custom message' }
    ],
    async (params) => {
      // In a real implementation, this would send an email or notification
      console.log(`[NOTIFICATION] Invoice ${params.invoiceId} status changed to ${params.status}`);
      console.log(`To: ${params.recipientId}, Message: ${params.message || 'No message'}`);
      
      // Return success
      return {
        sent: true,
        timestamp: new Date().toISOString(),
        recipient: params.recipientId
      };
    }
  );
  
  // Register action to log audit event
  registry.registerSimpleAction(
    'LogInvoiceAuditEvent',
    'Log an audit event for invoice operations',
    [
      { name: 'invoiceId', type: 'string', required: true, description: 'Invoice ID' },
      { name: 'action', type: 'string', required: true, description: 'Action performed' },
      { name: 'userId', type: 'string', required: true, description: 'User who performed the action' },
      { name: 'details', type: 'object', required: false, description: 'Additional details' }
    ],
    async (params) => {
      // In a real implementation, this would log to a database
      console.log(`[AUDIT] Invoice ${params.invoiceId} - ${params.action} by ${params.userId}`);
      if (params.details) {
        console.log(`Details: ${JSON.stringify(params.details)}`);
      }
      
      // Return success
      return {
        logged: true,
        timestamp: new Date().toISOString()
      };
    }
  );
}

// Initialize the invoice actions during module import
registerInvoiceActions();
