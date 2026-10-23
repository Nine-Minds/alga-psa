import { z } from 'zod';
import { workflowDefinitionSchema } from '@alga-psa/workflows/runtime';
import { WORKFLOW_LAUNCH_SKIP_REASONS } from '../lib/workflowLaunchSkipReasons';

const versionNumber = z.preprocess(
  (val) => (typeof val === 'string' ? Number(val) : val),
  z.number().int().positive()
);

// The preprocess step maps null/'' to undefined, so the inner schema must accept undefined itself:
// an outer `.optional()` only sees the raw input (null), not the preprocessed value, and the inner
// z.number() would then reject the undefined as "Required".
const optionalPositiveInt = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? undefined : Number(val)),
  z.number().int().positive().optional()
);

const optionalNonNegativeInt = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? undefined : Number(val)),
  z.number().int().nonnegative().optional()
);

/**
 * An optional setting that can be cleared: undefined leaves the stored value alone, null (or an
 * empty string from a blank form field) clears it, and anything else must be a number.
 */
const clearableNumber = (schema: z.ZodNumber) => z.preprocess(
  (val) => (val === undefined ? undefined : val === null || val === '' ? null : Number(val)),
  schema.nullable().optional()
);

const workflowKey = z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/);

export const CreateWorkflowDefinitionInput = z.object({
  key: workflowKey.optional(),
  definition: workflowDefinitionSchema,
  payloadSchemaMode: z.enum(['inferred', 'pinned']).optional(),
  pinnedPayloadSchemaRef: z.string().min(1).optional()
});

export const UpdateWorkflowDefinitionInput = z.object({
  workflowId: z.string().min(1),
  definition: workflowDefinitionSchema,
  expectedDraftVersion: optionalPositiveInt,
  payloadSchemaMode: z.enum(['inferred', 'pinned']).optional(),
  pinnedPayloadSchemaRef: z.string().min(1).optional()
});

export const SimulateWorkflowDefinitionInput = z.object({
  definition: workflowDefinitionSchema,
  /** Workflow payload used as-is. Wins over eventPayload/synthesis. */
  payload: z.record(z.any()).optional(),
  /** Replay a persisted workflow runtime event by id. Mutually exclusive with payload. */
  eventId: z.string().uuid().optional(),
  /** Replay the latest persisted event for the trigger event type. Mutually exclusive with payload. */
  useLatestEvent: z.boolean().optional(),
  /** Source event payload, run through the trigger's payloadMapping. */
  eventPayload: z.record(z.any()).optional(),
  /** Event to synthesize a payload for when neither payload nor eventPayload is given. */
  eventType: z.string().min(1).optional(),
  /** Stub outputs keyed by step id or actionId; see simulator docs. */
  fixtures: z.record(z.any()).optional(),
  options: z.object({
    maxSteps: z.number().int().positive().optional(),
    maxForEachIterations: z.number().int().positive().optional(),
    maxDurationMs: z.number().int().positive().optional()
  }).optional()
}).superRefine((value, ctx) => {
  if (value.payload !== undefined && (value.eventId !== undefined || value.useLatestEvent === true)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payload'],
      message: 'Provide either payload or eventId/useLatestEvent, not both.'
    });
  }
});

export const UpdateWorkflowDefinitionMetadataInput = z.object({
  workflowId: z.string().min(1),
  key: workflowKey.optional(),
  isVisible: z.boolean().optional(),
  isPaused: z.boolean().optional(),
  /** null or blank means no limit. */
  concurrencyLimit: clearableNumber(z.number().int().nonnegative()),
  autoPauseOnFailure: z.boolean().optional(),
  failureRateThreshold: clearableNumber(z.number().min(0).max(1)),
  failureRateMinRuns: clearableNumber(z.number().int().nonnegative()),
  retentionPolicyOverride: z.record(z.any()).optional()
});

export const DeleteWorkflowDefinitionInput = z.object({
  workflowId: z.string().min(1)
});

export const GetWorkflowDefinitionVersionInput = z.object({
  workflowId: z.string().min(1),
  version: versionNumber
});

export const PublishWorkflowDefinitionInput = z.object({
  workflowId: z.string().min(1),
  version: versionNumber,
  definition: z.record(z.any()).optional()
});

export const StartWorkflowRunInput = z.object({
  workflowId: z.string().min(1),
  workflowVersion: versionNumber.optional(),
  payload: z.record(z.any()).default({}),
  eventType: z.string().min(1).optional(),
  sourcePayloadSchemaRef: z.string().min(1).optional(),
  /**
   * Return payload validation failures as a result (field-by-field issues) instead of throwing.
   * Thrown server-action errors lose their details on the way to the browser, so the Run dialog
   * asks for this to show each problem next to its field.
   */
  reportPayloadIssues: z.boolean().optional()
});

export const ListWorkflowRunsInput = z.object({
  status: z.array(z.enum(['RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELED'])).optional(),
  workflowId: z.string().min(1).optional(),
  version: optionalPositiveInt,
  runId: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: optionalPositiveInt.default(50),
  cursor: optionalNonNegativeInt.default(0),
  sort: z.enum(['started_at:desc', 'started_at:asc', 'updated_at:desc', 'updated_at:asc']).default('started_at:desc')
});

export const RunIdInput = z.object({
  runId: z.string().min(1)
});

export const WorkflowIdInput = z.object({
  workflowId: z.string().min(1)
});

const pageNumber = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? 1 : Number(val)),
  z.number().int().positive()
);

const pageSizeNumber = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? 20 : Number(val)),
  z.number().int().positive().max(200)
);

export const ListWorkflowDefinitionsPagedInput = z.object({
  page: pageNumber.default(1),
  pageSize: pageSizeNumber.default(20),
  search: z.string().optional(),
  status: z.enum(['all', 'active', 'draft', 'paused']).optional(),
  trigger: z.enum(['all', 'event', 'schedule', 'recurring', 'scheduled', 'date', 'manual']).optional(),
  sortBy: z.enum(['name', 'status', 'updated_at', 'created_at']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional()
});

export const GetLatestWorkflowRunInput = z.object({
  workflowId: z.string().min(1),
  eventType: z.string().min(1).optional()
});

export const RunActionInput = z.object({
  runId: z.string().min(1),
  reason: z.string().min(3),
  source: z.string().optional()
});

export const ReplayWorkflowRunInput = z.object({
  runId: z.string().min(1),
  reason: z.string().min(3),
  // Omitted payload means "replay with the original run's input"; an explicit
  // value (including {}) overrides it.
  payload: z.record(z.any()).optional(),
  source: z.string().optional()
});

export const EventIdInput = z.object({
  eventId: z.string().min(1)
});

export const ListWorkflowEventsInput = z.object({
  eventName: z.string().min(1).optional(),
  correlationKey: z.string().min(1).optional(),
  status: z.enum(['matched', 'unmatched', 'error']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: optionalPositiveInt.default(100),
  cursor: optionalNonNegativeInt.default(0)
});

export const ListWorkflowEventsPagedInput = z.object({
  page: pageNumber.default(1),
  pageSize: pageSizeNumber.default(25),
  eventName: z.string().min(1).optional(),
  correlationKey: z.string().min(1).optional(),
  status: z.enum(['all', 'matched', 'unmatched', 'error']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sortBy: z.enum(['created_at', 'processed_at', 'event_name', 'correlation_key', 'status']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional()
});

export const ListWorkflowDeadLetterInput = z.object({
  limit: optionalPositiveInt.default(50),
  cursor: optionalNonNegativeInt.default(0),
  minRetries: optionalPositiveInt.default(3)
});

export const ListWorkflowRunSummaryInput = z.object({
  workflowId: z.string().min(1).optional(),
  version: optionalPositiveInt,
  from: z.string().optional(),
  to: z.string().optional()
});

export const ListWorkflowRunLogsInput = z.object({
  runId: z.string().min(1),
  level: z.array(z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR'])).optional(),
  search: z.string().min(1).optional(),
  limit: optionalPositiveInt.default(100),
  cursor: optionalNonNegativeInt.default(0)
});

export const ListWorkflowAuditLogsInput = z.object({
  tableName: z.enum(['workflow_definitions', 'workflow_runs']),
  recordId: z.string().min(1),
  limit: optionalPositiveInt.default(100),
  cursor: optionalNonNegativeInt.default(0)
});

export const SchemaRefInput = z.object({
  schemaRef: z.string().min(1)
});

export const SubmitWorkflowEventInput = z.object({
  eventName: z.string().min(1),
  workflowCorrelationKey: z.string().min(1).optional(),
  correlationKey: z.string().min(1).optional(),
  payloadSchemaRef: z.string().min(1).optional(),
  payload: z.record(z.any()).default({})
});

// --- Workflow event launch skips (alga0002106) ---

const launchSkipReasonSchema = z.enum(WORKFLOW_LAUNCH_SKIP_REASONS);

export const GetWorkflowLaunchSkipSummaryInput = z.object({
  workflowId: z.string().uuid(),
  from: z.string().datetime({ offset: true }).optional()
});

export const ListWorkflowLaunchSkipsPagedInput = z.object({
  workflowId: z.string().uuid(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  reason: launchSkipReasonSchema.optional(),
  intentional: z.boolean().optional(),
  page: pageNumber.default(1),
  pageSize: pageSizeNumber.default(25)
});

export const ListWorkflowLaunchSkipCountsInput = z.object({
  workflowIds: z.array(z.string().uuid()).max(500),
  from: z.string().datetime({ offset: true }).optional()
});

export const ListEventLaunchSkipsInput = z.object({
  eventId: z.string().uuid()
});
