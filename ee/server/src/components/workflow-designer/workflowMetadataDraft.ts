/**
 * The designer's editable copy of a workflow's settings (visibility, pause, limits). Numeric
 * settings are kept as the raw text of their inputs; an empty input means "not set".
 */
export type WorkflowMetadataDraft = {
  isVisible: boolean;
  isPaused: boolean;
  concurrencyLimit: string;
  autoPauseOnFailure: boolean;
  failureRateThreshold: string;
  failureRateMinRuns: string;
};

export type WorkflowMetadataRecord = {
  is_visible?: boolean | null;
  is_paused?: boolean | null;
  concurrency_limit?: number | null;
  auto_pause_on_failure?: boolean | null;
  failure_rate_threshold?: number | string | null;
  failure_rate_min_runs?: number | null;
};

const numberToText = (value: number | string | null | undefined): string =>
  value === null || value === undefined || value === '' ? '' : String(value);

/** The draft matching what is saved, used to load and to roll back after a failed save. */
export const buildWorkflowMetadataDraft = (record: WorkflowMetadataRecord): WorkflowMetadataDraft => ({
  isVisible: record.is_visible ?? true,
  isPaused: record.is_paused ?? false,
  concurrencyLimit: record.concurrency_limit ? String(record.concurrency_limit) : '',
  autoPauseOnFailure: record.auto_pause_on_failure ?? false,
  failureRateThreshold: numberToText(record.failure_rate_threshold),
  failureRateMinRuns: record.failure_rate_min_runs ? String(record.failure_rate_min_runs) : '',
});

const textToNumberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * The settings update to send. Blank numeric inputs are sent as null, which clears the setting
 * (a blank concurrency limit means unlimited).
 */
export const buildWorkflowMetadataUpdate = (workflowId: string, draft: WorkflowMetadataDraft) => ({
  workflowId,
  isVisible: draft.isVisible,
  isPaused: draft.isPaused,
  concurrencyLimit: textToNumberOrNull(draft.concurrencyLimit),
  autoPauseOnFailure: draft.autoPauseOnFailure,
  failureRateThreshold: textToNumberOrNull(draft.failureRateThreshold),
  failureRateMinRuns: textToNumberOrNull(draft.failureRateMinRuns),
});
