import { WorkflowNotFoundError } from '@temporalio/client';
import logger from '@alga-psa/core/logger';
import { getTemporalClient } from './client';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export type InvoiceAutopaySignal = 'enrollmentChanged' | 'paymentIntentSettled' | 'invoiceSettled' | 'chargeNow';

export async function signalInvoiceAutopay(tenant: string, invoiceId: string, signal: InvoiceAutopaySignal, arg?: unknown): Promise<void> {
  const workflowId = `invoice-autopay:${tenant}:${invoiceId}`;
  try {
    const client = await getTemporalClient();
    await client.workflow.getHandle(workflowId).signal(signal, ...(arg === undefined ? [] : [arg]));
  } catch (error) {
    if (error instanceof WorkflowNotFoundError || (error as any)?.name === 'WorkflowNotFoundError') {
      logger.debug('[autopay] Workflow not found while signalling', { tenant, invoiceId, signal });
      return;
    }
    logger.warn('[autopay] Failed to signal invoice workflow', { tenant, invoiceId, signal, error });
  }
}

export async function startInvoiceAutopay(tenantId: string, invoiceId: string): Promise<void> {
  const workflowId = `invoice-autopay:${tenantId}:${invoiceId}`;
  try {
    const client = await getTemporalClient();
    await client.workflow.start('invoiceAutopayWorkflow', {
      taskQueue: 'tenant-workflows', workflowId, args: [{ tenantId, invoiceId }],
      workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
    });
  } catch (error) {
    if ((error as any)?.name === 'WorkflowExecutionAlreadyStartedError') return;
    throw error;
  }
}

export async function signalProfileAutopayChanged(knex: Knex, tenantId: string, billingProfileId: string): Promise<void> {
  const attempts = await tenantDb(knex, tenantId).table('invoice_autopay_attempts')
    .where({ billing_profile_id: billingProfileId }).whereIn('status', ['scheduled', 'processing']).select('invoice_id');
  await Promise.all([...new Set(attempts.map((row: any) => row.invoice_id))]
    .map((invoiceId) => signalInvoiceAutopay(tenantId, invoiceId, 'enrollmentChanged')));
}
