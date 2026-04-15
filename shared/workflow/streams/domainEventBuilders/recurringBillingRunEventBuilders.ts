export type RecurringBillingRunSelectionMode = 'due_service_periods';
export type RecurringBillingRunWindowIdentity =
  | 'client_cadence_window'
  | 'contract_cadence_window'
  | 'mixed_execution_windows';
export type RecurringBillingRunExecutionWindowKind =
  | 'client_cadence_window'
  | 'contract_cadence_window';

function normalizeExecutionWindowKinds(
  windowKinds?: RecurringBillingRunExecutionWindowKind[],
): RecurringBillingRunExecutionWindowKind[] | undefined {
  if (!windowKinds?.length) {
    return undefined;
  }

  return Array.from(new Set(windowKinds)).sort() as RecurringBillingRunExecutionWindowKind[];
}

export type RecurringBillingRunStartedPayloadInput = {
  runId: string;
  scheduleId?: string;
  startedAt?: string;
  initiatedByUserId?: string;
  selectionKey?: string;
  retryKey?: string;
  selectionMode?: RecurringBillingRunSelectionMode;
  windowIdentity?: RecurringBillingRunWindowIdentity;
  executionWindowKinds?: RecurringBillingRunExecutionWindowKind[];
};

export function buildRecurringBillingRunStartedPayload(input: RecurringBillingRunStartedPayloadInput) {
  return {
    runId: input.runId,
    scheduleId: input.scheduleId ?? undefined,
    startedAt: input.startedAt,
    initiatedByUserId: input.initiatedByUserId,
    selectionKey: input.selectionKey,
    retryKey: input.retryKey,
    selectionMode: input.selectionMode ?? 'due_service_periods',
    windowIdentity: input.windowIdentity ?? 'mixed_execution_windows',
    executionWindowKinds: normalizeExecutionWindowKinds(input.executionWindowKinds),
  };
}

export type RecurringBillingRunCompletedPayloadInput = {
  runId: string;
  completedAt?: string;
  invoicesCreated: number;
  failedCount: number;
  warnings?: string[];
  selectionKey?: string;
  retryKey?: string;
  selectionMode?: RecurringBillingRunSelectionMode;
  windowIdentity?: RecurringBillingRunWindowIdentity;
  executionWindowKinds?: RecurringBillingRunExecutionWindowKind[];
};

export function buildRecurringBillingRunCompletedPayload(input: RecurringBillingRunCompletedPayloadInput) {
  return {
    runId: input.runId,
    completedAt: input.completedAt,
    invoicesCreated: input.invoicesCreated,
    failedCount: input.failedCount,
    warnings: input.warnings?.length ? input.warnings : undefined,
    selectionKey: input.selectionKey,
    retryKey: input.retryKey,
    selectionMode: input.selectionMode ?? 'due_service_periods',
    windowIdentity: input.windowIdentity ?? 'mixed_execution_windows',
    executionWindowKinds: normalizeExecutionWindowKinds(input.executionWindowKinds),
  };
}

export type RecurringBillingRunFailedPayloadInput = {
  runId: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage: string;
  retryable?: boolean;
  selectionKey?: string;
  retryKey?: string;
  selectionMode?: RecurringBillingRunSelectionMode;
  windowIdentity?: RecurringBillingRunWindowIdentity;
  executionWindowKinds?: RecurringBillingRunExecutionWindowKind[];
};

export function buildRecurringBillingRunFailedPayload(input: RecurringBillingRunFailedPayloadInput) {
  return {
    runId: input.runId,
    failedAt: input.failedAt,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    retryable: input.retryable,
    selectionKey: input.selectionKey,
    retryKey: input.retryKey,
    selectionMode: input.selectionMode ?? 'due_service_periods',
    windowIdentity: input.windowIdentity ?? 'mixed_execution_windows',
    executionWindowKinds: normalizeExecutionWindowKinds(input.executionWindowKinds),
  };
}
