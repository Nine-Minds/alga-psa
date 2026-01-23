export type RecurringBillingRunStartedPayloadInput = {
  runId: string;
  scheduleId?: string;
  startedAt?: string;
  initiatedByUserId?: string;
};

export function buildRecurringBillingRunStartedPayload(input: RecurringBillingRunStartedPayloadInput) {
  return {
    runId: input.runId,
    scheduleId: input.scheduleId ?? undefined,
    startedAt: input.startedAt,
    initiatedByUserId: input.initiatedByUserId,
  };
}

export type RecurringBillingRunCompletedPayloadInput = {
  runId: string;
  completedAt?: string;
  invoicesCreated: number;
  failedCount: number;
  warnings?: string[];
};

export function buildRecurringBillingRunCompletedPayload(input: RecurringBillingRunCompletedPayloadInput) {
  return {
    runId: input.runId,
    completedAt: input.completedAt,
    invoicesCreated: input.invoicesCreated,
    failedCount: input.failedCount,
    warnings: input.warnings?.length ? input.warnings : undefined,
  };
}

export type RecurringBillingRunFailedPayloadInput = {
  runId: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
};

export function buildRecurringBillingRunFailedPayload(input: RecurringBillingRunFailedPayloadInput) {
  return {
    runId: input.runId,
    failedAt: input.failedAt,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    retryable: input.retryable,
  };
}

