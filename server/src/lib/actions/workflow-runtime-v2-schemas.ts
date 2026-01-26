import { z } from 'zod';
import { workflowDefinitionSchema } from '@shared/workflow/runtime';

const versionNumber = z.preprocess(
  (val) => (typeof val === 'string' ? Number(val) : val),
  z.number().int().positive()
);

const optionalPositiveInt = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? undefined : Number(val)),
  z.number().int().positive()
).optional();

const optionalNonNegativeInt = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? undefined : Number(val)),
  z.number().int().nonnegative()
).optional();

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
  payloadSchemaMode: z.enum(['inferred', 'pinned']).optional(),
  pinnedPayloadSchemaRef: z.string().min(1).optional()
});

export const UpdateWorkflowDefinitionMetadataInput = z.object({
  workflowId: z.string().min(1),
  key: workflowKey.optional(),
  isVisible: z.boolean().optional(),
  isPaused: z.boolean().optional(),
  concurrencyLimit: optionalNonNegativeInt.optional(),
  autoPauseOnFailure: z.boolean().optional(),
  failureRateThreshold: z.preprocess(
    (val) => (val === undefined || val === null || val === '' ? undefined : Number(val)),
    z.number().min(0).max(1)
  ).optional(),
  failureRateMinRuns: optionalNonNegativeInt.optional(),
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
  sourcePayloadSchemaRef: z.string().min(1).optional()
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
  payload: z.record(z.any()).default({}),
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
  correlationKey: z.string().min(1),
  payloadSchemaRef: z.string().min(1).optional(),
  payload: z.record(z.any()).default({})
});
