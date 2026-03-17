export type RecurringBillingRunSelectionMode = 'due_service_periods';
export type RecurringBillingRunWindowIdentity = 'billing_cycle_window';

export type RecurringBillingRunStartedPayloadInput = {
  runId: string;
  scheduleId?: string;
  startedAt?: string;
  initiatedByUserId?: string;
  selectionMode?: RecurringBillingRunSelectionMode;
  windowIdentity?: RecurringBillingRunWindowIdentity;
};

export function buildRecurringBillingRunStartedPayload(input: RecurringBillingRunStartedPayloadInput) {
  return {
    runId: input.runId,
    scheduleId: input.scheduleId ?? undefined,
    startedAt: input.startedAt,
    initiatedByUserId: input.initiatedByUserId,
    selectionMode: input.selectionMode ?? 'due_service_periods',
    windowIdentity: input.windowIdentity ?? 'billing_cycle_window',
  };
}

export type RecurringBillingRunCompletedPayloadInput = {
  runId: string;
  completedAt?: string;
  invoicesCreated: number;
  failedCount: number;
  warnings?: string[];
  selectionMode?: RecurringBillingRunSelectionMode;
  windowIdentity?: RecurringBillingRunWindowIdentity;
};

export function buildRecurringBillingRunCompletedPayload(input: RecurringBillingRunCompletedPayloadInput) {
  return {
    runId: input.runId,
    completedAt: input.completedAt,
    invoicesCreated: input.invoicesCreated,
    failedCount: input.failedCount,
    warnings: input.warnings?.length ? input.warnings : undefined,
    selectionMode: input.selectionMode ?? 'due_service_periods',
    windowIdentity: input.windowIdentity ?? 'billing_cycle_window',
  };
}

export type RecurringBillingRunFailedPayloadInput = {
  runId: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
  selectionMode?: RecurringBillingRunSelectionMode;
  windowIdentity?: RecurringBillingRunWindowIdentity;
};

export function buildRecurringBillingRunFailedPayload(input: RecurringBillingRunFailedPayloadInput) {
  return {
    runId: input.runId,
    failedAt: input.failedAt,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    retryable: input.retryable,
    selectionMode: input.selectionMode ?? 'due_service_periods',
    windowIdentity: input.windowIdentity ?? 'billing_cycle_window',
  };
}
