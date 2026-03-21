'use server';

import { v4 as uuidv4 } from 'uuid';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getCurrentUserAsync } from '../lib/authHelpers';
import {
  generateInvoiceForSelectionInput,
  generateInvoiceForSelectionInputs,
} from './invoiceGeneration';
import { DUPLICATE_RECURRING_INVOICE_CODE } from './invoiceGeneration.constants';
import {
  buildRecurringRunSelectionIdentity,
  listRecurringRunExecutionWindowKinds,
} from '@alga-psa/shared/billingClients/recurringRunExecutionIdentity';
import {
  getAvailableRecurringDueWork,
  type FetchRecurringDueWorkOptions,
} from './billingAndTax';
import {
  mapClientCadenceInvoiceCandidatesToRecurringRunTargets,
  type ClientCadenceRecurringRunTarget,
  type RecurringBillingRunGroupedTarget,
  type RecurringBillingRunInvoiceFailure,
  type RecurringBillingRunResult,
  type RecurringBillingRunTarget,
} from './recurringBillingRunActions.shared';
import {
  buildRecurringBillingRunCompletedPayload,
  buildRecurringBillingRunFailedPayload,
  buildRecurringBillingRunStartedPayload,
  type RecurringBillingRunWindowIdentity,
} from '@shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders';

function normalizeRecurringBillingRunTargets(params: {
  targets?: RecurringBillingRunTarget[];
}): RecurringBillingRunTarget[] {
  return (params.targets ?? []).filter(
    (target) => Boolean(
      target?.executionWindow?.identityKey &&
        target?.selectorInput?.executionWindow?.identityKey,
    ),
  );
}

function normalizeRecurringBillingRunGroupedTargets(params: {
  groupedTargets?: RecurringBillingRunGroupedTarget[];
}): RecurringBillingRunGroupedTarget[] {
  return (params.groupedTargets ?? [])
    .map((group) => ({
      groupKey: group.groupKey,
      selectorInputs: (group.selectorInputs ?? []).filter(
        (selectorInput) => Boolean(selectorInput?.executionWindow?.identityKey),
      ),
    }))
    .filter((group) => group.selectorInputs.length > 0);
}

function resolveRecurringBillingRunWindowIdentity(
  executionWindowKinds: ReturnType<typeof listRecurringRunExecutionWindowKinds>,
): RecurringBillingRunWindowIdentity {
  if (executionWindowKinds.length === 1 && executionWindowKinds[0] === 'contract_cadence_window') {
    return 'contract_cadence_window';
  }

  if (executionWindowKinds.length === 1 && executionWindowKinds[0] === 'client_cadence_window') {
    return 'client_cadence_window';
  }

  return 'mixed_execution_windows';
}

export async function selectClientCadenceRecurringRunTargets(
  options: FetchRecurringDueWorkOptions = {},
): Promise<{
  targets: ClientCadenceRecurringRunTarget[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const recurringDueWork = await getAvailableRecurringDueWork(options);
  const targets = mapClientCadenceInvoiceCandidatesToRecurringRunTargets(
    recurringDueWork.invoiceCandidates,
  );

  return {
    targets,
    total: recurringDueWork.total,
    page: recurringDueWork.page,
    pageSize: recurringDueWork.pageSize,
    totalPages: recurringDueWork.totalPages,
  };
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
  const windowIdentity = resolveRecurringBillingRunWindowIdentity(executionWindowKinds);
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
      windowIdentity,
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
      const { executionWindow, selectorInput } = target;
      try {
        const invoice = await generateInvoiceForSelectionInput(selectorInput, {
          allowPoOverage: params.allowPoOverage,
        });
        if (invoice) {
          invoicesCreated += 1;
        }
      } catch (err) {
        if (isDuplicateRecurringInvoiceError(err)) {
          continue;
        }

        failures.push({
          billingCycleId: null,
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
        windowIdentity,
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
        windowIdentity,
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

export async function generateGroupedInvoicesAsRecurringBillingRun(params: {
  groupedTargets?: RecurringBillingRunGroupedTarget[];
  allowPoOverage?: boolean;
}): Promise<RecurringBillingRunResult> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    throw new Error('Unauthorized: No authenticated user found');
  }

  const groupedTargets = normalizeRecurringBillingRunGroupedTargets(params);
  if (groupedTargets.length === 0) {
    throw new Error('No recurring execution windows selected');
  }

  const flattenedExecutionWindows = groupedTargets.flatMap((group) =>
    group.selectorInputs.map((selectorInput) => selectorInput.executionWindow),
  );
  const tenantId = currentUser.tenant;
  const actorUserId = currentUser.user_id;
  const runId = uuidv4();
  const executionWindowKinds = listRecurringRunExecutionWindowKinds(flattenedExecutionWindows);
  const windowIdentity = resolveRecurringBillingRunWindowIdentity(executionWindowKinds);
  const selectionIdentity = buildRecurringRunSelectionIdentity(flattenedExecutionWindows);

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
      windowIdentity,
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
    for (const group of groupedTargets) {
      const executionWindow = group.selectorInputs[0]?.executionWindow;
      if (!executionWindow) {
        continue;
      }

      try {
        const invoice = await generateInvoiceForSelectionInputs(group.selectorInputs, {
          allowPoOverage: params.allowPoOverage,
        });
        if (invoice) {
          invoicesCreated += 1;
        }
      } catch (err) {
        if (isDuplicateRecurringInvoiceError(err)) {
          continue;
        }

        failures.push({
          billingCycleId: null,
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
        windowIdentity,
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
        windowIdentity,
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
