// Not a 'use server' module: synchronous helpers for the recurring run's failure
// reporting, shared by the single and grouped paths and unit-testable on their own.
import { isActionMessageError, isActionPermissionError, type ActionMessageErrorShape, type ActionPermissionErrorShape } from '@alga-psa/ui/lib/errorHandling';
import type { RecurringRunExecutionWindowKind } from '@alga-psa/types';
import {
  NO_BILLING_EMAIL_MESSAGE_KEY,
  TIME_APPROVAL_REQUIRED_MESSAGE_KEY,
  USAGE_RECORDS_MISSING_MESSAGE_KEY,
  USAGE_RECORDS_MISSING_ACK_REQUIRED_MESSAGE_KEY,
  USAGE_PERIOD_TOTAL_STALE_MESSAGE_KEY,
  RECURRING_PRICING_STALE_MESSAGE_KEY,
  USAGE_CALCULATION_ERROR_MESSAGE_KEY,
  FIXED_LINE_RATE_UNRESOLVED_MESSAGE_KEY,
  FIXED_LINE_NO_SERVICES_MESSAGE_KEY,
  RECURRING_PERIODS_NOT_MATERIALIZED_MESSAGE_KEY,
  NO_ACTIVE_CONTRACT_LINES_MESSAGE_KEY,
  NOTHING_TO_BILL_MESSAGE_KEY,
} from './invoiceGeneration.constants';
import {
  invoiceGenerationActionErrorFrom,
  newSupportReference,
  unexpectedInvoiceFailureMessage,
} from './invoiceGenerationActionErrors';
import type {
  HandledRecurringFailureCode,
  RecurringBillingRunInvoiceFailure,
} from './recurringBillingRunActions.shared';

export type RecurringBillingRunActionError =
  | ActionMessageErrorShape
  | ActionPermissionErrorShape;

/**
 * Recovers the structured, known failure (code/params) from a keyed action error
 * returned by the invoice-generation boundary. Recognized by message key, never by
 * the English sentence, which the localization boundary rewrites. Unknown/internal
 * errors carry nothing, so the failure keeps the generic message for the UI.
 */
export function handledRecurringFailureFromActionError(error: RecurringBillingRunActionError): {
  code?: HandledRecurringFailureCode;
  params?: Record<string, string>;
} {
  if (error.messageKey === TIME_APPROVAL_REQUIRED_MESSAGE_KEY) {
    return { code: 'TIME_APPROVAL_REQUIRED', params: error.messageParams as Record<string, string> | undefined };
  }
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
  // A scheduled recurring quantity/price revision (or its inherited catalog
  // price) changed after the preview that was approved: the run reports the
  // coded stale-pricing failure so the operator re-previews before generating.
  if (error.messageKey === RECURRING_PRICING_STALE_MESSAGE_KEY) {
    return {
      code: 'RECURRING_PRICING_STALE',
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
  // A fixed-fee line with no resolvable rate refused generation; the coded
  // failure names the line instead of a generic error string.
  if (error.messageKey === FIXED_LINE_RATE_UNRESOLVED_MESSAGE_KEY) {
    return {
      code: 'FIXED_LINE_RATE_UNRESOLVED',
      params: error.messageParams as Record<string, string> | undefined,
    };
  }
  if (error.messageKey === FIXED_LINE_NO_SERVICES_MESSAGE_KEY) {
    return {
      code: 'FIXED_LINE_NO_SERVICES',
      params: error.messageParams as Record<string, string> | undefined,
    };
  }
  // Expected engine refusals (periods not materialized, no active lines, nothing
  // to bill) carry their code so the operator gets actionable, translatable copy.
  if (error.messageKey === RECURRING_PERIODS_NOT_MATERIALIZED_MESSAGE_KEY) {
    return { code: 'RECURRING_PERIODS_NOT_MATERIALIZED' };
  }
  if (error.messageKey === NO_ACTIVE_CONTRACT_LINES_MESSAGE_KEY) {
    return { code: 'NO_ACTIVE_CONTRACT_LINES' };
  }
  if (error.messageKey === NOTHING_TO_BILL_MESSAGE_KEY) {
    return { code: 'NOTHING_TO_BILL' };
  }
  return {};
}

export function logRecurringBillingRunInvoiceFailure(params: {
  runId: string;
  tenantId: string;
  error: unknown;
  billingCycleId?: string | null;
  executionIdentityKey: string;
  executionWindowKind: string;
  ref?: string;
}) {
  const {
    runId,
    tenantId,
    error,
    billingCycleId,
    executionIdentityKey,
    executionWindowKind,
    ref,
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
    ...(ref ? { ref } : {}),
    error: normalizedError,
  });
}

/**
 * Turns an error thrown out of invoice generation into the failure the run
 * reports. Always logs the full cause. A mapped (expected) error reports its
 * coded, translatable message; anything else reports `UNEXPECTED` with a short
 * `ref` that is also logged, so raw exception text never reaches the operator.
 */
export function recurringRunFailureFromThrown(
  err: unknown,
  ctx: {
    runId: string;
    tenantId: string;
    billingCycleId?: string | null;
    executionIdentityKey: string;
    executionWindowKind: RecurringRunExecutionWindowKind;
  },
): RecurringBillingRunInvoiceFailure {
  const mapped = invoiceGenerationActionErrorFrom(err);
  const base = {
    billingCycleId: ctx.billingCycleId ?? null,
    executionIdentityKey: ctx.executionIdentityKey,
    executionWindowKind: ctx.executionWindowKind,
  };

  if (mapped) {
    logRecurringBillingRunInvoiceFailure({ ...ctx, error: err });
    return {
      ...base,
      errorMessage: 'permissionError' in mapped ? mapped.permissionError : mapped.actionError,
      ...handledRecurringFailureFromActionError(mapped),
    };
  }

  const ref = newSupportReference();
  logRecurringBillingRunInvoiceFailure({ ...ctx, error: err, ref });
  return {
    ...base,
    errorMessage: unexpectedInvoiceFailureMessage(ref),
    code: 'UNEXPECTED',
    params: { ref },
  };
}
