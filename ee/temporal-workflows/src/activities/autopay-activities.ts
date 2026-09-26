import { ApplicationFailure } from '@temporalio/common';
import { AutopayService } from '@ee/lib/payments/AutopayService';
import { getConnection } from 'server/src/lib/db/db';
import { getTemporalClient } from '@ee/lib/temporal/client';

function failValidation(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/does not exist|not found|not configured|not eligible|currency is unsupported/i.test(message)) {
    throw ApplicationFailure.nonRetryable(message, 'AutopayValidationError');
  }
  throw error;
}

export async function prepareInvoiceAutopay(input: { tenantId: string; invoiceId: string }) {
  try { return await (await AutopayService.create(input.tenantId)).prepareInvoiceAutopay(input.invoiceId); }
  catch (error) { return failValidation(error); }
}

export async function executeAutopayAttempt(input: { tenantId: string; invoiceId: string; attemptId: string }) {
  try { return await (await AutopayService.create(input.tenantId)).executeAttempt(input.attemptId); }
  catch (error) { return failValidation(error); }
}

export async function reconcileAutopayAttempt(input: { tenantId: string; invoiceId: string; attemptId: string; noIntentFound?: boolean }) {
  return (await AutopayService.create(input.tenantId)).reconcileAttempt(input.attemptId, input.noIntentFound === true);
}

export async function evaluateEnrollmentForInvoice(input: { tenantId: string; invoiceId: string; attemptId: string }) {
  return (await AutopayService.create(input.tenantId)).evaluateEnrollmentForInvoice(input.attemptId);
}

export async function createRetryAttempt(input: { tenantId: string; invoiceId: string; previousAttemptId: string; retryAt: string }) {
  return (await AutopayService.create(input.tenantId)).createRetryAttempt(input.previousAttemptId, input.retryAt);
}

export async function finishAutopayWithFallback(input: { tenantId: string; invoiceId: string; attemptId?: string; reason: string }) {
  return (await AutopayService.create(input.tenantId)).finishAutopayWithFallback(input.invoiceId, input.attemptId, input.reason);
}

export async function cancelAutopayAttempt(input: { tenantId: string; invoiceId: string; attemptId: string }) {
  return (await AutopayService.create(input.tenantId)).cancelAttemptById(input.attemptId);
}

export async function listAutopayReconcileWork() {
  const knex = await getConnection();
  const tenants = await knex('tenants').select('tenant');
  const results = await Promise.all(tenants.map(async ({ tenant }: { tenant: string }) =>
    (await AutopayService.create(tenant)).listAutopayReconcileWork().then((items: any[]) => items.map((item) => ({ ...item, tenantId: tenant })))
  ));
  const candidates = results.flat();
  const client = await getTemporalClient();
  const filtered = await Promise.all(candidates.map(async (item) => {
    if (!item.hasOpenAttempt) return item;
    try {
      const description = await client.workflow.getHandle(`invoice-autopay:${item.tenantId}:${item.invoiceId}`).describe();
      const status = String(description.status);
      return ['FAILED', 'TERMINATED', 'NOT_FOUND'].includes(status) ? item : null;
    } catch (error) {
      if ((error as any)?.name === 'WorkflowNotFoundError') return item;
      throw error;
    }
  }));
  return filtered.filter(Boolean);
}

export async function startInvoiceAutopayWorkflow(input: { tenantId: string; invoiceId: string }): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.workflow.start('invoiceAutopayWorkflow', {
      workflowId: `invoice-autopay:${input.tenantId}:${input.invoiceId}`,
      taskQueue: 'tenant-workflows',
      args: [input],
      workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
    });
  } catch (error) {
    if ((error as any)?.name === 'WorkflowExecutionAlreadyStartedError') return;
    throw error;
  }
}
