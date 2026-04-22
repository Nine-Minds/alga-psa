/**
 * Shared workflow enum definitions for i18n-aware option hooks.
 *
 * UI components should consume the localized hooks in
 * `useWorkflowEnumOptions.ts` rather than shipping hardcoded label arrays.
 */

export const WORKFLOW_RUN_STATUS_VALUES = [
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUS_VALUES)[number];

export const WORKFLOW_RUN_STATUS_LABEL_DEFAULTS: Record<WorkflowRunStatus, string> = {
  RUNNING: 'Running',
  WAITING: 'Waiting',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
};

export const WORKFLOW_RUN_SORT_VALUES = [
  'started_at:desc',
  'started_at:asc',
  'updated_at:desc',
  'updated_at:asc',
] as const;
export type WorkflowRunSort = (typeof WORKFLOW_RUN_SORT_VALUES)[number];

export const WORKFLOW_RUN_SORT_LABEL_DEFAULTS: Record<WorkflowRunSort, string> = {
  'started_at:desc': 'Newest first',
  'started_at:asc': 'Oldest first',
  'updated_at:desc': 'Recently updated',
  'updated_at:asc': 'Least recently updated',
};

export const WORKFLOW_EVENT_STATUS_VALUES = ['matched', 'unmatched', 'error'] as const;
export type WorkflowEventStatus = (typeof WORKFLOW_EVENT_STATUS_VALUES)[number];

export const WORKFLOW_EVENT_STATUS_LABEL_DEFAULTS: Record<WorkflowEventStatus, string> = {
  matched: 'Matched',
  unmatched: 'Unmatched',
  error: 'Error',
};

export const WORKFLOW_STEP_STATUS_VALUES = [
  'STARTED',
  'SUCCEEDED',
  'FAILED',
  'RETRY_SCHEDULED',
  'CANCELED',
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUS_VALUES)[number];

export const WORKFLOW_STEP_STATUS_LABEL_DEFAULTS: Record<WorkflowStepStatus, string> = {
  STARTED: 'Started',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
  RETRY_SCHEDULED: 'Retry scheduled',
  CANCELED: 'Canceled',
};

export const WORKFLOW_LOG_LEVEL_VALUES = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type WorkflowLogLevel = (typeof WORKFLOW_LOG_LEVEL_VALUES)[number];

export const WORKFLOW_LOG_LEVEL_LABEL_DEFAULTS: Record<WorkflowLogLevel, string> = {
  DEBUG: 'Debug',
  INFO: 'Info',
  WARN: 'Warn',
  ERROR: 'Error',
};

export const WORKFLOW_AI_SCHEMA_TYPE_VALUES = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
] as const;
export type WorkflowAiSchemaType = (typeof WORKFLOW_AI_SCHEMA_TYPE_VALUES)[number];

export const WORKFLOW_AI_SCHEMA_TYPE_LABEL_DEFAULTS: Record<WorkflowAiSchemaType, string> = {
  string: 'String',
  number: 'Number',
  integer: 'Integer',
  boolean: 'Boolean',
  object: 'Object',
  array: 'Array',
};

export const WORKFLOW_INPUT_SOURCE_MODE_VALUES = ['reference', 'fixed'] as const;
export type WorkflowInputSourceMode = (typeof WORKFLOW_INPUT_SOURCE_MODE_VALUES)[number];

export const WORKFLOW_INPUT_SOURCE_MODE_LABEL_DEFAULTS: Record<WorkflowInputSourceMode, string> = {
  reference: 'Reference',
  fixed: 'Fixed value',
};

export const WORKFLOW_REFERENCE_SECTION_VALUES = [
  'payload',
  'vars',
  'meta',
  'error',
  'forEach',
] as const;
export type WorkflowReferenceSection = (typeof WORKFLOW_REFERENCE_SECTION_VALUES)[number];

export const WORKFLOW_REFERENCE_SECTION_LABEL_DEFAULTS: Record<WorkflowReferenceSection, string> = {
  payload: 'Payload',
  vars: 'Step results',
  meta: 'Workflow details',
  error: 'Error',
  forEach: 'Loop context',
};

export const WORKFLOW_TRIGGER_MODE_VALUES = ['manual', 'event'] as const;
export type WorkflowTriggerMode = (typeof WORKFLOW_TRIGGER_MODE_VALUES)[number];

export const WORKFLOW_TRIGGER_MODE_LABEL_DEFAULTS: Record<WorkflowTriggerMode, string> = {
  manual: 'No trigger',
  event: 'Event',
};

export const WORKFLOW_CANVAS_VIEW_VALUES = ['list', 'graph'] as const;
export type WorkflowCanvasView = (typeof WORKFLOW_CANVAS_VIEW_VALUES)[number];

export const WORKFLOW_CANVAS_VIEW_LABEL_DEFAULTS: Record<WorkflowCanvasView, string> = {
  list: 'List',
  graph: 'Graph',
};

export const WORKFLOW_ON_ERROR_VALUES = ['continue', 'fail'] as const;
export type WorkflowOnError = (typeof WORKFLOW_ON_ERROR_VALUES)[number];

export const WORKFLOW_ON_ERROR_LABEL_DEFAULTS: Record<WorkflowOnError, string> = {
  continue: 'Continue',
  fail: 'Fail',
};

export const WORKFLOW_WAIT_MODE_VALUES = ['duration', 'until'] as const;
export type WorkflowWaitMode = (typeof WORKFLOW_WAIT_MODE_VALUES)[number];

export const WORKFLOW_WAIT_MODE_LABEL_DEFAULTS: Record<WorkflowWaitMode, string> = {
  duration: 'Duration',
  until: 'Until',
};

export const WORKFLOW_WAIT_TIMING_VALUES = ['fixed', 'expression'] as const;
export type WorkflowWaitTiming = (typeof WORKFLOW_WAIT_TIMING_VALUES)[number];

export const WORKFLOW_WAIT_TIMING_LABEL_DEFAULTS: Record<WorkflowWaitTiming, string> = {
  fixed: 'Specific date & time',
  expression: 'Advanced expression',
};
