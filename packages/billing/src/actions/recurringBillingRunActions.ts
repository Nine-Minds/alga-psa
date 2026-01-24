'use server';

import { v4 as uuidv4 } from 'uuid';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getCurrentUserAsync } from '../lib/authHelpers';
import { generateInvoice } from './invoiceGeneration';
import {
  buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload,
  buildRecurringBillingRunStartedPayload,
} from '@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders';

export type RecurringBillingRunInvoiceFailure = {
  billingCycleId: string;
  errorMessage: string;
};

export type RecurringBillingRunResult = {
  runId: string;
  invoicesCreated: number;
  failedCount: number;
  failures: RecurringBillingRunInvoiceFailure[];
};

export async function generateInvoicesAsRecurringBillingRun(params: {
  billingCycleIds: string[];
  allowPoOverage?: boolean;
}): Promise<RecurringBillingRunResult> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    throw new Error('Unauthorized: No authenticated user found');
  }

  const billingCycleIds = params.billingCycleIds.filter(Boolean);
  if (billingCycleIds.length === 0) {
    throw new Error('No billing cycles selected');
  }

  const tenantId = currentUser.tenant;
  const actorUserId = currentUser.user_id;
  const runId = uuidv4();

  const startedAt = new Date().toISOString();
  await publishWorkflowEvent({
    eventType: 'RECURRING_BILLING_RUN_STARTED',
    payload: buildRecurringBillingRunStartedPayload({
      runId,
      startedAt,
      initiatedByUserId: actorUserId,
    }),
    ctx: {
      tenantId,
      occurredAt: startedAt,
      actor: { actorType: 'USER', actorUserId },
      correlationId: runId,
    },
    idempotencyKey: `recurring-billing-run:${runId}:started`,
  });

  const failures: RecurringBillingRunInvoiceFailure[] = [];
  let invoicesCreated = 0;

  try {
    for (const billingCycleId of billingCycleIds) {
      try {
        const invoice = await generateInvoice(billingCycleId, { allowPoOverage: params.allowPoOverage });
        if (invoice) {
          invoicesCreated += 1;
        }
      } catch (err) {
        failures.push({
          billingCycleId,
          errorMessage: err instanceof Error ? err.message : 'Unknown error occurred',
        });
      }
    }

    const completedAt = new Date().toISOString();
    await publishWorkflowEvent({
      eventType: 'RECURRING_BILLING_RUN_COMPLETED',
      payload: buildRecurringBillingRunCompletedPayload({
        runId,
        completedAt,
        invoicesCreated,
        failedCount: failures.length,
      }),
      ctx: {
        tenantId,
        occurredAt: completedAt,
        actor: { actorType: 'USER', actorUserId },
        correlationId: runId,
      },
      idempotencyKey: `recurring-billing-run:${runId}:completed`,
    });

    return {
      runId,
      invoicesCreated,
      failedCount: failures.length,
      failures,
    };
  } catch (fatalError) {
    const failedAt = new Date().toISOString();
    const errorMessage =
      fatalError instanceof Error ? fatalError.message : 'Unknown error occurred while generating invoices';

    await publishWorkflowEvent({
      eventType: 'RECURRING_BILLING_RUN_FAILED',
      payload: buildRecurringBillingRunFailedPayload({
        runId,
        failedAt,
        errorMessage,
        retryable: true,
      }),
      ctx: {
        tenantId,
        occurredAt: failedAt,
        actor: { actorType: 'USER', actorUserId },
        correlationId: runId,
      },
      idempotencyKey: `recurring-billing-run:${runId}:failed`,
    });

    throw fatalError;
  }
}

