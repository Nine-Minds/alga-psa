'use server';

import { v4 as uuidv4 } from 'uuid';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  actionError,
  isActionMessageError,
  isActionPermissionError,
  permissionError,
  type ActionMessageErrorShape,
  type ActionPermissionErrorShape,
} from '@alga-psa/ui/lib/errorHandling';
import { localizeActionError } from '@alga-psa/auth';
import { getCurrentUserAsync, hasPermissionAsync } from '../lib/authHelpers';
import {
  generateInvoiceForSelectionInput,
  generateInvoiceForSelectionInputs,
} from './invoiceGeneration';
import { DUPLICATE_RECURRING_INVOICE_CODE, DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY } from './invoiceGeneration.constants';
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
} from '@alga-psa/workflow-streams';

// These actions do their own auth check rather than going through withAuth, so their
// payloads must still be built by the shared helpers: that is what carries the
// messageKey the localization boundary reads. Local clones would drop it silently.
export type RecurringBillingRunActionError =
  | ActionMessageErrorShape
  | ActionPermissionErrorShape;

function isRecurringBillingRunActionError(value: unknown): value is RecurringBillingRunActionError {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function getRecurringBillingRunActionErrorMessage(error: RecurringBillingRunActionError): string {
  return 'permissionError' in error ? error.permissionError : error.actionError;
}

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
} | RecurringBillingRunActionError> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return localizeActionError(permissionError('Unauthorized: No authenticated user found'));
  }

  if (!await hasPermissionAsync(currentUser, 'billing', 'read')) {
    return localizeActionError(permissionError('Permission denied: billing read required'));
  }

  const recurringDueWork = await getAvailableRecurringDueWork(options);
  if (isRecurringBillingRunActionError(recurringDueWork)) {
    return recurringDueWork;
  }
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

function isDuplicateRecurringInvoiceActionError(error: RecurringBillingRunActionError): boolean {
  // Keyed, not matched: the boundary rewrites the sentence into the caller's locale.
  return error.messageKey === DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY;
}

/**
 * Logs the actionable underlying invoice-generation exception for a recurring
 * run failure while the caller keeps the generic user-facing message. Only
 * safe identifiers already present in the run are included; no invoice
 * contents, customer data, or other sensitive payloads are logged.
 */
function logRecurringBillingRunInvoiceFailure(params: {
  runId: string;
  tenantId: string;
  error: unknown;
  billingCycleId?: string | null;
  executionIdentityKey: string;
  executionWindowKind: string;
}) {
  const {
    runId,
    tenantId,
    error,
    billingCycleId,
    executionIdentityKey,
    executionWindowKind,
  } = params;
  const normalizedError =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: 'Unknown', message: String(error), stack: undefined };
  console.error('[billing.recurringBillingRun.invoiceFailure]', {
    event: 'billing.recurringBillingRun.invoiceFailure',
    runId,
    tenantId,
    billingCycleId: billingCycleId ?? null,
    executionIdentityKey,
    executionWindowKind,
    error: normalizedError,
  });
}

export async function generateInvoicesAsRecurringBillingRun(params: {
  targets?: RecurringBillingRunTarget[];
  allowPoOverage?: boolean;
}): Promise<RecurringBillingRunResult | RecurringBillingRunActionError> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return localizeActionError(permissionError('Unauthorized: No authenticated user found'));
  }

  if (!await hasPermissionAsync(currentUser, 'invoice', 'create') && !await hasPermissionAsync(currentUser, 'invoice', 'generate')) {
    return localizeActionError(permissionError('Permission denied: invoice create or generate required'));
  }

  const targets = normalizeRecurringBillingRunTargets(params);
  if (targets.length === 0) {
    return localizeActionError(actionError('Select at least one recurring billing period to generate.'));
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
        const invoice = target.billingCycleId
          ? await generateInvoiceForSelectionInput(
              selectorInput,
              { allowPoOverage: params.allowPoOverage },
              { billingCycleId: target.billingCycleId },
            )
          : await generateInvoiceForSelectionInput(selectorInput, {
              allowPoOverage: params.allowPoOverage,
            });
        if (isRecurringBillingRunActionError(invoice)) {
          if (isDuplicateRecurringInvoiceActionError(invoice)) {
            continue;
          }
          failures.push({
            billingCycleId: target.billingCycleId ?? null,
            executionIdentityKey: executionWindow.identityKey,
            executionWindowKind: executionWindow.kind,
            errorMessage: getRecurringBillingRunActionErrorMessage(invoice),
          });
          continue;
        }
        if (invoice) {
          invoicesCreated += 1;
        }
      } catch (err) {
        if (isDuplicateRecurringInvoiceError(err)) {
          continue;
        }

        logRecurringBillingRunInvoiceFailure({
          runId,
          tenantId,
          error: err,
          billingCycleId: target.billingCycleId ?? null,
          executionIdentityKey: executionWindow.identityKey,
          executionWindowKind: executionWindow.kind,
        });

        failures.push({
          billingCycleId: target.billingCycleId ?? null,
          executionIdentityKey: executionWindow.identityKey,
          executionWindowKind: executionWindow.kind,
          errorMessage: 'Failed to generate invoice for this billing cycle.',
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
}): Promise<RecurringBillingRunResult | RecurringBillingRunActionError> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return localizeActionError(permissionError('Unauthorized: No authenticated user found'));
  }

  if (!await hasPermissionAsync(currentUser, 'invoice', 'create') && !await hasPermissionAsync(currentUser, 'invoice', 'generate')) {
    return localizeActionError(permissionError('Permission denied: invoice create or generate required'));
  }

  const groupedTargets = normalizeRecurringBillingRunGroupedTargets(params);
  if (groupedTargets.length === 0) {
    return localizeActionError(actionError('Select at least one recurring billing period to generate.'));
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
        const invoice = group.billingCycleId
          ? await generateInvoiceForSelectionInputs(
              group.selectorInputs,
              { allowPoOverage: params.allowPoOverage },
              { billingCycleId: group.billingCycleId },
            )
          : await generateInvoiceForSelectionInputs(group.selectorInputs, {
              allowPoOverage: params.allowPoOverage,
            });
        if (isRecurringBillingRunActionError(invoice)) {
          if (isDuplicateRecurringInvoiceActionError(invoice)) {
            continue;
          }
          failures.push({
            billingCycleId: group.billingCycleId ?? null,
            executionIdentityKey: executionWindow.identityKey,
            executionWindowKind: executionWindow.kind,
            errorMessage: getRecurringBillingRunActionErrorMessage(invoice),
          });
          continue;
        }
        if (invoice) {
          invoicesCreated += 1;
        }
      } catch (err) {
        if (isDuplicateRecurringInvoiceError(err)) {
          continue;
        }

        logRecurringBillingRunInvoiceFailure({
          runId,
          tenantId,
          error: err,
          billingCycleId: group.billingCycleId ?? null,
          executionIdentityKey: executionWindow.identityKey,
          executionWindowKind: executionWindow.kind,
        });

        failures.push({
          billingCycleId: group.billingCycleId ?? null,
          executionIdentityKey: executionWindow.identityKey,
          executionWindowKind: executionWindow.kind,
          errorMessage: 'Failed to generate invoice for this billing cycle.',
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
