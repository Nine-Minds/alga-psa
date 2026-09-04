'use server';

import { v4 as uuidv4 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { createTenantKnex, tenantDb, resolveEffectiveTimeZone } from '@alga-psa/db';
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
import { DUPLICATE_RECURRING_INVOICE_CODE, DUPLICATE_RECURRING_INVOICE_MESSAGE_KEY, NO_BILLING_EMAIL_MESSAGE_KEY } from './invoiceGeneration.constants';
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
import { POST_DROP_RECURRING_OBLIGATION_TYPES } from '@alga-psa/shared/billingClients/postDropRecurringObligationIdentity';
import type { IRecurringDueSelectionInput } from '@alga-psa/types';
import type { Knex } from 'knex';

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
const MONTH_END_CLOSE_REASON_LABELS: Record<CalendarMonthEndCloseEligibilityReason, string> = {
  eligible: 'eligible',
  not_arrears: 'the period is not billed in arrears',
  not_client_cadence: 'the period is not a client schedule period',
  not_calendar_month_period: 'the service period is not a full calendar month',
  window_does_not_open_next_day: 'the invoice window does not open the day after the period',
  not_final_calendar_day: 'today is not the final calendar day of the service period',
};

/**
 * Truncates a date-ish value to its date-only (YYYY-MM-DD) form. The recurring
 * service-period `date` columns come back from the pg driver hydrated as
 * JavaScript `Date` objects, so `String(value).slice(0, 10)` would render the
 * English `Date#toString()` prefix ("Thu Oct 01") instead of the ISO day —
 * which the month-end policy then rejects as an invalid ISO 8601 string.
 * Normalize `Date` values through the same UTC-day slice the rest of the
 * billing package uses for these columns; plain strings fall through untouched.
 */
function normalizeWindowDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function monthEndClosePeriodLabel(servicePeriodStart: string, servicePeriodEnd: string): string {
  return `${servicePeriodStart} to ${servicePeriodEnd}`;
}

async function fetchClientCadenceServicePeriodForMonthEndClose(params: {
  knex: Knex;
  tenant: string;
  selectorInput: IRecurringDueSelectionInput;
}): Promise<{
  // The pg driver hydrates the `date` columns it selects below as JavaScript
  // `Date` objects (never strings); the union is honest about that hydration.
  service_period_start: string | Date;
  service_period_end: string | Date;
  invoice_window_start: string | Date;
  due_position: 'arrears' | 'advance';
} | null> {
  const executionWindow = params.selectorInput.executionWindow;
  if (executionWindow.kind !== 'client_cadence_window') {
    return null;
  }

  const db = tenantDb(params.knex, params.tenant);
  return db.table('recurring_service_periods as rsp')
    .where({
      'rsp.cadence_owner': 'client',
      'rsp.schedule_key': executionWindow.scheduleKey ?? null,
      'rsp.period_key': executionWindow.periodKey ?? null,
      'rsp.invoice_window_start': normalizeWindowDate(params.selectorInput.windowStart),
      'rsp.invoice_window_end': normalizeWindowDate(params.selectorInput.windowEnd),
    })
    .whereIn('rsp.obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
    .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
    .orderBy('rsp.service_period_start', 'asc')
    .orderBy('rsp.revision', 'asc')
    .first(
      'rsp.service_period_start',
      'rsp.service_period_end',
      'rsp.invoice_window_start',
      'rsp.due_position',
    );
}

function monthEndCloseEligibilityErrorMessage(params: {
  reason: CalendarMonthEndCloseEligibilityReason;
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

  // Server-side revalidation: the UI convenience flag is not the policy.
  for (const group of groupedTargets) {
    for (const selectorInput of group.selectorInputs) {
      const row = await fetchClientCadenceServicePeriodForMonthEndClose({
        knex,
        tenant: tenantId,
        selectorInput,
      });
      if (!row) {
        return localizeActionError(actionError(
          'Recurring service periods were not materialized for this recurring execution window.',
          MONTH_END_CLOSE_NOT_MATERIALIZED_KEY,
        ));
      }
      const servicePeriodStart = normalizeWindowDate(row.service_period_start);
      const servicePeriodEnd = normalizeWindowDate(row.service_period_end);
      const evaluation = evaluateCalendarMonthEndEarlyCloseEligibility({
        duePosition: row.due_position,
        cadenceSource: 'client_schedule',
        servicePeriodStart,
        servicePeriodEnd,
        invoiceWindowStart: normalizeWindowDate(row.invoice_window_start),
        asOf: now,
        timeZone: effectiveTimeZone,
      });
      if (!evaluation.eligible) {
        const servicePeriodLabel = monthEndClosePeriodLabel(servicePeriodStart, servicePeriodEnd);
        return localizeActionError(actionError(
          monthEndCloseEligibilityErrorMessage({
            reason: evaluation.reason,
            servicePeriodLabel,
            finalCalendarDay: evaluation.finalCalendarDay,
          }),
          MONTH_END_CLOSE_NOT_ELIGIBLE_KEY,
          { reason: evaluation.reason, servicePeriod: servicePeriodLabel, finalCalendarDay: evaluation.finalCalendarDay },
        ));
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
