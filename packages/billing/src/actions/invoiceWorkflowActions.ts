'use server';

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import { toPlainDate } from '@alga-psa/core';
import { v4 as uuidv4 } from 'uuid';

import { getActionRegistry, TransactionIsolationLevel } from '@alga-psa/shared/workflow/core';
import { getWorkflowRuntime } from '@alga-psa/shared/workflow/core';
import { submitWorkflowEventAction } from '@alga-psa/workflows/actions/workflow-event-actions';
import { withAuth } from '@alga-psa/auth';



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
export const approveInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  executionId?: string
): Promise<any> => {
  const { knex } = await createTenantKnex();

  // If execution ID is not provided, look it up
  if (!executionId) {
    const workflowExecution = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('workflow_executions')
      .where('context_data->invoice.id', invoiceId)
      .andWhere('tenant', tenant)
      .first('execution_id');
    });

    if (!workflowExecution) {
      throw new Error(`No workflow found for invoice ${invoiceId}`);
    }

    executionId = workflowExecution.execution_id;
  }

  const userId = user.user_id;
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
});

/**
 * Reject an invoice
 * This is a convenience method for the reject action
 */
export const rejectInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  reason: string,
  executionId?: string
): Promise<any> => {
  const { knex } = await createTenantKnex();

  // If execution ID is not provided, look it up
  if (!executionId) {
    const workflowExecution = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('workflow_executions')
      .where('context_data->invoice.id', invoiceId)
      .andWhere('tenant', tenant)
      .first('execution_id');
    });

    if (!workflowExecution) {
      throw new Error(`No workflow found for invoice ${invoiceId}`);
    }

    executionId = workflowExecution.execution_id;
  }

  const userId = user.user_id;
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
});

