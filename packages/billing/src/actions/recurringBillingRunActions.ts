'use server';

import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { createTenantKnex, resolveEffectiveTimeZone } from '@alga-psa/db';
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
import {
  DUPLICATE_RECURRING_INVOICE_CODE,
  DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY,
  NO_BILLING_EMAIL_MESSAGE_KEY,
  USAGE_RECORDS_MISSING_MESSAGE_KEY,
  USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY,
  USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY,
  USAGE_CALCULATION_ERROR_MESSAGE_KEY,
} from './invoiceGeneration.constants';
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
  type HandledRecurringFailureCode,
  type RecurringBillingRunGroupedTarget,
  type RecurringBillingRunInvoiceFailure,
  type RecurringBillingRunResult,
  type RecurringBillingRunTarget,
} from './recurringBillingRunActions.shared';
import {
  evaluateCalendarMonthEndEarlyCloseEligibility,
  type CalendarMonthEndCloseEligibilityReason,
} from '@alga-psa/shared/billingClients/calendarMonthEndClosePolicy';
import {
  listCanonicalClientCadenceWindowPeriods,
  listUnmaterializedClientCadenceWindowLineIds,
} from '../lib/billing/clientCadenceWindowMaterialization';

export type {
  HandledRecurringFailureCode,
  RecurringBillingRunInvoiceFailure,
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

/**
 * Recovers the structured, known failure (code/params) from a keyed action error
 * returned by the invoice-generation boundary. Recognized by message key, never by
 * the English sentence, which the localization boundary rewrites. Unknown/internal
 * errors carry nothing, so the failure keeps the generic message for the UI.
 */
function handledRecurringFailureFromActionError(error: RecurringBillingRunActionError): {
  code?: HandledRecurringFailureCode;
  params?: Record<string, string>;
} {
  if (error.messageKey === NO_BILLING_EMAIL_MESSAGE_KEY) {
    return {
      code: 'NO_BILLING_EMAIL',
      params: error.messageParams as Record<string, string> | undefined,
    };
  }
  // Incomplete-usage windows: whether the whole window is unreported
  // (USAGE_RECORDS_MISSING) or billable charges would omit unreported usage
  // services (…_ACK_REQUIRED), the automated run reports the coded,
  // actionable incomplete-usage failure instead of silently finalizing a
  // partial period. The acknowledgement variant keeps its
  // `acknowledgeRequired` param so the UI can offer an explicit
  // generate-anyway confirmation.
  if (
    error.messageKey != null &&
    (error.messageKey === USAGE_RECORDS_MISSING_MESSAGE_KEY ||
      error.messageKey === USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY)
  ) {
    return {
      code: 'USAGE_RECORDS_MISSING',
      params: error.messageParams as Record<string, string> | undefined,
    };
  }
  // A stale previewed period total refused finalization: the operator must
  // re-preview, so the coded failure (not a generic string) reaches the UI.
  if (error.messageKey === USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY) {
    return {
      code: 'USAGE_PERIOD_TOTAL_STALE',
      params: error.messageParams as Record<string, string> | undefined,
    };
  }
  // Recorded usage the engine could not price keeps its structured
  // per-service diagnostics across the run boundary.
  if (error.messageKey === USAGE_CALCULATION_ERROR_MESSAGE_KEY) {
    return {
      code: 'USAGE_CALCULATION_ERROR',
      params: error.messageParams as Record<string, string> | undefined,
    };
  }
  return {};
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
      billingCycleId: group.billingCycleId,
      expectedUsagePeriodTotals: group.expectedUsagePeriodTotals,
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
    return localizeActionError(permissionError('Unauthorized: No authenticated user found', 'msp/billing:errors.context.notAuthenticated'));
  }

  if (!await hasPermissionAsync(currentUser, 'billing', 'read')) {
    return localizeActionError(permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead'));
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
  /**
   * Explicit operator acknowledgement that unreported usage services may be
   * omitted from the generated invoices (they stay billable later). Only the
   * interactive retry passes this; scheduled/automated runs never acknowledge
   * implicitly and instead report the coded incomplete-usage failure.
   */
  acknowledgeUnreportedUsage?: boolean;
}): Promise<RecurringBillingRunResult | RecurringBillingRunActionError> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return localizeActionError(permissionError('Unauthorized: No authenticated user found', 'msp/billing:errors.context.notAuthenticated'));
  }

  if (!await hasPermissionAsync(currentUser, 'invoice', 'create') && !await hasPermissionAsync(currentUser, 'invoice', 'generate')) {
    return localizeActionError(permissionError('Permission denied: invoice create or generate required', 'msp/billing:errors.recurringRun.invoicePermission'));
  }

  const targets = normalizeRecurringBillingRunTargets(params);
  if (targets.length === 0) {
    return localizeActionError(actionError('Select at least one recurring billing period to generate.', 'msp/billing:errors.recurringRun.selectPeriods'));
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
              {
                allowPoOverage: params.allowPoOverage,
                acknowledgeUnreportedUsage: params.acknowledgeUnreportedUsage,
                expectedUsagePeriodTotals: target.expectedUsagePeriodTotals,
              },
              { billingCycleId: target.billingCycleId },
            )
          : await generateInvoiceForSelectionInput(selectorInput, {
              allowPoOverage: params.allowPoOverage,
              acknowledgeUnreportedUsage: params.acknowledgeUnreportedUsage,
              expectedUsagePeriodTotals: target.expectedUsagePeriodTotals,
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
            ...handledRecurringFailureFromActionError(invoice),
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

// ---------------------------------------------------------------------------
// Calendar month-end arrears manual close
// ---------------------------------------------------------------------------

const MONTH_END_CLOSE_NOT_ELIGIBLE_KEY = 'msp/billing:errors.recurringRun.monthEndCloseNotEligible';
const MONTH_END_CLOSE_NOT_MATERIALIZED_KEY =
  'msp/billing:errors.recurringRun.monthEndCloseNotMaterialized';

/**
 * The policy's own reasons plus the action-level rejection for a selection
 * that names only part of the canonical window (closing part of a window
 * would strand the unselected periods behind the window's duplicate guard).
 */
type MonthEndCloseRejectionReason = CalendarMonthEndCloseEligibilityReason | 'selection_incomplete';

const MONTH_END_CLOSE_REASON_LABELS: Record<MonthEndCloseRejectionReason, string> = {
  eligible: 'eligible',
  not_arrears: 'the period is not billed in arrears',
  not_client_cadence: 'the period is not a client schedule period',
  not_calendar_month_period: 'the service period is not a full calendar month',
  window_does_not_open_next_day: 'the invoice window does not open the day after the period',
  not_final_calendar_day: 'today is not the final calendar day of the service period',
  selection_incomplete: 'the selection does not include every service period due in this billing window',
};

/**
 * Truncates a date-ish value to its date-only (YYYY-MM-DD) form. Selector
 * inputs may carry full ISO timestamps, and pg-hydrated values arrive as
 * JavaScript `Date` objects whose `String()` form would not be an ISO day.
 * Normalize `Date` values through the same UTC-day slice the rest of the
 * billing package uses for these columns; plain strings fall through untouched.
 */
function normalizeWindowDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function monthEndClosePeriodLabel(servicePeriodStart: string, servicePeriodEnd: string): string {
  return `${servicePeriodStart} to ${servicePeriodEnd}`;
}

function monthEndCloseEligibilityErrorMessage(params: {
  reason: MonthEndCloseRejectionReason;
  servicePeriodLabel: string;
  finalCalendarDay: string;
}): string {
  const { reason, servicePeriodLabel, finalCalendarDay } = params;
  if (reason === 'not_final_calendar_day') {
    return (
      `The ${servicePeriodLabel} period can only be closed at month end on ${finalCalendarDay}. ` +
      'It is not the final calendar day yet, so the invoice window must open normally.'
    );
  }
  return (
    `The ${servicePeriodLabel} period cannot be closed at month end ` +
    `(${MONTH_END_CLOSE_REASON_LABELS[reason]}). Only calendar-month arrears service ` +
    'periods can be closed early on their final calendar day.'
  );
}

/**
 * Manual month-end arrears close.
 *
 * Lets a billing administrator generate a true calendar-month arrears invoice
 * on the FINAL calendar day of the service period instead of waiting for the
 * 1st of the next month. This is an explicit manual exception: every target is
 * re-validated server-side against the same shared month-end policy used to
 * surface candidates, in the account's effective billing timezone, so a direct
 * server-action invocation on any other day (or for any non-eligible period) is
 * rejected before generation is attempted. Generation itself keeps the normal
 * guards: approvals must be satisfied and an already-invoiced period is refused
 * as a duplicate.
 *
 * Automatic/scheduled generation is unaffected — it never calls this action and
 * its own window-open eligibility rules are untouched.
 */
export async function generateCalendarMonthEndCloseInvoices(params: {
  groupedTargets?: RecurringBillingRunGroupedTarget[];
  allowPoOverage?: boolean;
}): Promise<RecurringBillingRunResult | RecurringBillingRunActionError> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return localizeActionError(permissionError('Unauthorized: No authenticated user found', 'msp/billing:errors.context.notAuthenticated'));
  }

  if (!await hasPermissionAsync(currentUser, 'invoice', 'create') && !await hasPermissionAsync(currentUser, 'invoice', 'generate')) {
    return localizeActionError(permissionError('Permission denied: invoice create or generate required', 'msp/billing:errors.recurringRun.invoicePermission'));
  }

  const groupedTargets = normalizeRecurringBillingRunGroupedTargets(params);
  if (groupedTargets.length === 0) {
    return localizeActionError(actionError('Select at least one recurring billing period to generate.', 'msp/billing:errors.recurringRun.selectPeriods'));
  }

  const tenantId = currentUser.tenant;
  const { knex } = await createTenantKnex();
  const effectiveTimeZone = await resolveEffectiveTimeZone(knex, tenantId);
  const now = new Date();
  // The tenant-local calendar date of this instant. On an eligible close this is
  // provably the service period's final calendar day (`evaluation.finalCalendarDay`
  // below): the policy only approves when the local date equals that day. Stamping
  // invoices from the tenant's billing calendar (never the server host's clock)
  // keeps the gate and the invoice it approves on the same date.
  const monthEndCloseInvoiceDate = Temporal.Instant.from(now.toISOString())
    .toZonedDateTimeISO(effectiveTimeZone)
    .toPlainDate()
    .toString();

  // Server-side revalidation: the UI convenience flag is not the policy. The
  // CANONICAL WINDOW is validated as a whole — every persisted client-cadence
  // service period the client's invoice window serves, resolved from the
  // database rather than from the caller's selection — using the same
  // materialization helpers the generation path enforces. A window with
  // unrebuilt schedule changes is refused as not materialized (generation
  // would refuse it too), and a selection naming only part of the window is
  // refused outright: closing part of a window would strand the unselected
  // periods behind the window's duplicate guard.
  const monthEndCloseNotMaterializedError = () => localizeActionError(actionError(
    'Recurring service periods were not materialized for this recurring execution window.',
    MONTH_END_CLOSE_NOT_MATERIALIZED_KEY,
  ));
  const monthEndCloseNotEligibleError = (params: {
    reason: MonthEndCloseRejectionReason;
    servicePeriodLabel: string;
    finalCalendarDay: string;
  }) => localizeActionError(actionError(
    monthEndCloseEligibilityErrorMessage({
      reason: params.reason,
      servicePeriodLabel: params.servicePeriodLabel,
      finalCalendarDay: params.finalCalendarDay,
    }),
    MONTH_END_CLOSE_NOT_ELIGIBLE_KEY,
    { reason: params.reason, servicePeriod: params.servicePeriodLabel, finalCalendarDay: params.finalCalendarDay },
  ));

  for (const group of groupedTargets) {
    const firstSelector = group.selectorInputs[0]!;
    const clientId = firstSelector.clientId;
    const windowStart = normalizeWindowDate(firstSelector.windowStart);
    const windowEnd = normalizeWindowDate(firstSelector.windowEnd);
    const windowLabel = monthEndClosePeriodLabel(windowStart, windowEnd);

    // Only complete client-schedule selections sharing one window can be a
    // month-end close; anything else (contract cadence, mixed windows) stays
    // on the normal path.
    const selectorIdentityKeys = new Set<string>();
    for (const selectorInput of group.selectorInputs) {
      const executionWindow = selectorInput.executionWindow;
      if (
        executionWindow.kind !== 'client_cadence_window'
        || !executionWindow.scheduleKey
        || !executionWindow.periodKey
        || selectorInput.clientId !== clientId
        || normalizeWindowDate(selectorInput.windowStart) !== windowStart
        || normalizeWindowDate(selectorInput.windowEnd) !== windowEnd
      ) {
        return monthEndCloseNotEligibleError({
          reason: 'not_client_cadence',
          servicePeriodLabel: windowLabel,
          finalCalendarDay: windowStart,
        });
      }
      selectorIdentityKeys.add(`${executionWindow.scheduleKey}::${executionWindow.periodKey}`);
    }

    const missingLineIds = await listUnmaterializedClientCadenceWindowLineIds({
      knex,
      tenant: tenantId,
      clientId,
      windowStart,
      windowEnd,
    });
    if (missingLineIds.length > 0) {
      return monthEndCloseNotMaterializedError();
    }

    const canonicalPeriods = await listCanonicalClientCadenceWindowPeriods({
      knex,
      tenant: tenantId,
      clientId,
      windowStart,
      windowEnd,
    });
    if (canonicalPeriods.length === 0) {
      return monthEndCloseNotMaterializedError();
    }

    let finalCalendarDay = windowStart;
    for (const period of canonicalPeriods) {
      const evaluation = evaluateCalendarMonthEndEarlyCloseEligibility({
        duePosition: period.duePosition,
        cadenceSource: 'client_schedule',
        servicePeriodStart: period.servicePeriodStart,
        servicePeriodEnd: period.servicePeriodEnd,
        invoiceWindowStart: period.invoiceWindowStart,
        asOf: now,
        timeZone: effectiveTimeZone,
      });
      if (!evaluation.eligible) {
        return monthEndCloseNotEligibleError({
          reason: evaluation.reason,
          servicePeriodLabel: monthEndClosePeriodLabel(period.servicePeriodStart, period.servicePeriodEnd),
          finalCalendarDay: evaluation.finalCalendarDay,
        });
      }
      finalCalendarDay = evaluation.finalCalendarDay;
    }

    const canonicalIdentityKeys = new Set(
      canonicalPeriods.map((period) => `${period.scheduleKey}::${period.periodKey}`),
    );
    // A selector whose period row no longer exists is stale, not closable.
    for (const identityKey of selectorIdentityKeys) {
      if (!canonicalIdentityKeys.has(identityKey)) {
        return monthEndCloseNotMaterializedError();
      }
    }
    // Every canonical period must be part of the selection.
    for (const identityKey of canonicalIdentityKeys) {
      if (!selectorIdentityKeys.has(identityKey)) {
        return monthEndCloseNotEligibleError({
          reason: 'selection_incomplete',
          servicePeriodLabel: windowLabel,
          finalCalendarDay,
        });
      }
    }
  }

  const flattenedExecutionWindows = groupedTargets.flatMap((group) =>
    group.selectorInputs.map((selectorInput) => selectorInput.executionWindow),
  );
  const selectionIdentity = buildRecurringRunSelectionIdentity(flattenedExecutionWindows);
  const runId = uuidv4();
  let invoicesCreated = 0;

  for (const group of groupedTargets) {
    try {
      const invoice = group.billingCycleId
        ? await generateInvoiceForSelectionInputs(
            group.selectorInputs,
            { allowPoOverage: params.allowPoOverage, invoiceDate: monthEndCloseInvoiceDate },
            { billingCycleId: group.billingCycleId },
          )
        : await generateInvoiceForSelectionInputs(group.selectorInputs, {
            allowPoOverage: params.allowPoOverage,
            invoiceDate: monthEndCloseInvoiceDate,
          });

      // The duplicate guard refuses an already-invoiced period; unlike the
      // scheduled run (which treats "already done" as a benign no-op) the
      // manual close surfaces it so the operator knows nothing was generated.
      if (isRecurringBillingRunActionError(invoice)) {
        return localizeActionError(invoice);
      }
      if (invoice) {
        invoicesCreated += 1;
      }
    } catch (err) {
      if (isDuplicateRecurringInvoiceError(err)) {
        return localizeActionError(actionError(
          'Invoice already exists for this recurring execution window.',
          DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY,
        ));
      }
      console.error('[billing.calendarMonthEndClose.invoiceFailure]', {
        event: 'billing.calendarMonthEndClose.invoiceFailure',
        runId,
        tenantId,
        error: err instanceof Error ? { name: err.name, message: err.message } : { name: 'Unknown', message: String(err) },
      });
      throw err;
    }
  }

  return {
    runId,
    selectionKey: selectionIdentity.selectionKey,
    retryKey: selectionIdentity.retryKey,
    invoicesCreated,
    failedCount: 0,
    failures: [],
  };
}

export async function generateGroupedInvoicesAsRecurringBillingRun(params: {
  groupedTargets?: RecurringBillingRunGroupedTarget[];
  allowPoOverage?: boolean;
  /**
   * Explicit operator acknowledgement that unreported usage services may be
   * omitted from the generated invoices (they stay billable later). Only the
   * interactive retry passes this; scheduled/automated runs never acknowledge
   * implicitly and instead report the coded incomplete-usage failure.
   */
  acknowledgeUnreportedUsage?: boolean;
}): Promise<RecurringBillingRunResult | RecurringBillingRunActionError> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    return localizeActionError(permissionError('Unauthorized: No authenticated user found', 'msp/billing:errors.context.notAuthenticated'));
  }

  if (!await hasPermissionAsync(currentUser, 'invoice', 'create') && !await hasPermissionAsync(currentUser, 'invoice', 'generate')) {
    return localizeActionError(permissionError('Permission denied: invoice create or generate required', 'msp/billing:errors.recurringRun.invoicePermission'));
  }

  const groupedTargets = normalizeRecurringBillingRunGroupedTargets(params);
  if (groupedTargets.length === 0) {
    return localizeActionError(actionError('Select at least one recurring billing period to generate.', 'msp/billing:errors.recurringRun.selectPeriods'));
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
              {
                allowPoOverage: params.allowPoOverage,
                acknowledgeUnreportedUsage: params.acknowledgeUnreportedUsage,
                expectedUsagePeriodTotals: group.expectedUsagePeriodTotals,
              },
              { billingCycleId: group.billingCycleId },
            )
          : await generateInvoiceForSelectionInputs(group.selectorInputs, {
              allowPoOverage: params.allowPoOverage,
              acknowledgeUnreportedUsage: params.acknowledgeUnreportedUsage,
              expectedUsagePeriodTotals: group.expectedUsagePeriodTotals,
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
            ...handledRecurringFailureFromActionError(invoice),
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
