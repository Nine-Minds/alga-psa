'use server';

import { v4 as uuidv4 } from 'uuid';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getCurrentUserAsync } from '../lib/authHelpers';
import { DUPLICATE_RECURRING_INVOICE_CODE, generateInvoice } from './invoiceGeneration';
import {
  buildRecurringRunSelectionIdentity,
  buildClientBillingCycleExecutionWindow,
  listRecurringRunExecutionWindowKinds,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import type {
  IRecurringRunExecutionWindowIdentity,
  RecurringRunExecutionWindowKind,
} from '@alga-psa/types';
import {
  buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload,
  buildRecurringBillingRunStartedPayload,
} from '@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders';

export type RecurringBillingRunInvoiceFailure = {
  billingCycleId: string;
  executionIdentityKey?: string;
  executionWindowKind?: RecurringRunExecutionWindowKind;
  errorMessage: string;
};

export type RecurringBillingRunTarget = {
  billingCycleId: string;
  executionWindow: IRecurringRunExecutionWindowIdentity;
};

export type RecurringBillingRunResult = {
  runId: string;
  selectionKey: string;
  retryKey: string;
  invoicesCreated: number;
  failedCount: number;
  failures: RecurringBillingRunInvoiceFailure[];
};

function normalizeRecurringBillingRunTargets(params: {
  billingCycleIds?: string[];
  targets?: RecurringBillingRunTarget[];
}): RecurringBillingRunTarget[] {
  if (params.targets?.length) {
    return params.targets.filter(
      (target) => Boolean(target?.billingCycleId && target.executionWindow?.identityKey),
    );
  }

  return (params.billingCycleIds ?? [])
    .filter(Boolean)
    .map((billingCycleId) => ({
      billingCycleId,
      executionWindow: buildClientBillingCycleExecutionWindow({ billingCycleId }),
    }));
}

function isDuplicateRecurringInvoiceError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === DUPLICATE_RECURRING_INVOICE_CODE
  );
}

export async function generateInvoicesAsRecurringBillingRun(params: {
  billingCycleIds?: string[];
  targets?: RecurringBillingRunTarget[];
  allowPoOverage?: boolean;
}): Promise<RecurringBillingRunResult> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    throw new Error('Unauthorized: No authenticated user found');
  }

  const targets = normalizeRecurringBillingRunTargets(params);
  if (targets.length === 0) {
    throw new Error('No recurring execution windows selected');
  }

  const tenantId = currentUser.tenant;
  const actorUserId = currentUser.user_id;
  const runId = uuidv4();
  const executionWindowKinds = listRecurringRunExecutionWindowKinds(
    targets.map((target) => target.executionWindow),
  );
  const selectionIdentity = buildRecurringRunSelectionIdentity(
    targets.map((target) => target.executionWindow),
  );

  const startedAt = new Date().toISOString();
  await publishWorkflowEvent({
    eventType: 'RECURRING_BILLING_RUN_STARTED',
    payload: buildRecurringBillingRunStartedPayload({
      runId,
      startedAt,
      initiatedByUserId: actorUserId,
      selectionKey: selectionIdentity.selectionKey,
      retryKey: selectionIdentity.retryKey,
      selectionMode: 'due_service_periods',
      windowIdentity: 'billing_cycle_window',
      executionWindowKinds,
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
    for (const target of targets) {
      const { billingCycleId, executionWindow } = target;
      try {
        const invoice = await generateInvoice(billingCycleId, { allowPoOverage: params.allowPoOverage });
        if (invoice) {
          invoicesCreated += 1;
        }
      } catch (err) {
        if (isDuplicateRecurringInvoiceError(err)) {
          continue;
        }

        failures.push({
          billingCycleId,
          executionIdentityKey: executionWindow.identityKey,
          executionWindowKind: executionWindow.kind,
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
        selectionKey: selectionIdentity.selectionKey,
        retryKey: selectionIdentity.retryKey,
        invoicesCreated,
        failedCount: failures.length,
        selectionMode: 'due_service_periods',
        windowIdentity: 'billing_cycle_window',
        executionWindowKinds,
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
      selectionKey: selectionIdentity.selectionKey,
      retryKey: selectionIdentity.retryKey,
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
        selectionKey: selectionIdentity.selectionKey,
        retryKey: selectionIdentity.retryKey,
        selectionMode: 'due_service_periods',
        windowIdentity: 'billing_cycle_window',
        executionWindowKinds,
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
