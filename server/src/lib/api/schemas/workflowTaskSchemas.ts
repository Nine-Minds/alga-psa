/**
 * Workflow Task API Schemas
 * Validation schemas for the v1 `/workflows/tasks` endpoints (EE-only inbox + claim/complete).
 *
 * Response shapes mirror `TaskDetails` / `TaskQueryResult` from the workflow task model
 * (`shared/workflow/persistence/taskInboxInterfaces.ts`). The detail response intentionally
 * exposes `formSchema.jsonSchema` / `formSchema.uiSchema` so the mobile client can classify
 * a task's form as simple (native completion) vs complex (web deep-link).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

// Mirrors `WorkflowTaskStatus` (shared/workflow/persistence/workflowTaskModel.ts). Kept as a
// literal enum so this schema module stays free of the workflow model's runtime imports.
export const workflowTaskStatusSchema = z.enum([
  'pending',
  'claimed',
  'completed',
  'canceled',
  'expired',
]);

export type WorkflowTaskStatusLiteral = z.infer<typeof workflowTaskStatusSchema>;

const emptyToUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

// ---------------------------------------------------------------------------
// Request: GET /api/v1/workflows/tasks (list)
// ---------------------------------------------------------------------------

const STATUS_VALUES = workflowTaskStatusSchema.options as readonly string[];

export const listWorkflowTasksQuerySchema = z.object({
  // Comma-separated list of WorkflowTaskStatus values (e.g. "pending,claimed"). When omitted
  // the underlying action defaults to the open inbox (pending + claimed).
  status: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((val) =>
        val
          ? val
              .split(',')
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean)
          : undefined,
      )
      .refine((statuses) => !statuses || statuses.every((s) => STATUS_VALUES.includes(s)), {
        message: `status must be a comma-separated list of: ${STATUS_VALUES.join(', ')}`,
      })
      .transform((statuses) => statuses as WorkflowTaskStatusLiteral[] | undefined),
  ),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type ListWorkflowTasksQuery = z.infer<typeof listWorkflowTasksQuerySchema>;

// ---------------------------------------------------------------------------
// Request: POST /api/v1/workflows/tasks/[id]/complete
// ---------------------------------------------------------------------------

export const completeWorkflowTaskSchema = z.object({
  // The form payload. Validated server-side against the task's JSON Schema inside
  // `submitTaskForm` (formRegistry.validateFormData); failures surface as 400.
  formData: z.record(z.unknown()).default({}),
  comments: z.string().optional(),
});

export type CompleteWorkflowTaskBody = z.infer<typeof completeWorkflowTaskSchema>;

// ---------------------------------------------------------------------------
// Response shapes (mirror TaskDetails / TaskQueryResult)
// ---------------------------------------------------------------------------

/** The task's resolved form schema — the mobile classifier keys off these field names. */
export const workflowTaskFormSchemaSchema = z.object({
  jsonSchema: z.record(z.unknown()),
  uiSchema: z.record(z.unknown()).optional(),
  defaultValues: z.record(z.unknown()).optional(),
});

/** A single workflow task. List items omit `formSchema`; the detail endpoint includes it. */
export const workflowTaskDetailSchema = z.object({
  taskId: z.string(),
  executionId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: workflowTaskStatusSchema,
  priority: z.string(),
  dueDate: z.string().optional(),
  assignedRoles: z.array(z.string()).optional(),
  assignedUsers: z.array(z.string()).optional(),
  contextData: z.record(z.unknown()).optional(),
  formId: z.string(),
  formSchema: workflowTaskFormSchemaSchema.optional(),
  createdAt: z.string(),
  createdBy: z.string().optional(),
  claimedAt: z.string().optional(),
  claimedBy: z.string().optional(),
  completedAt: z.string().optional(),
  completedBy: z.string().optional(),
  responseData: z.record(z.unknown()).optional(),
});

export const workflowTaskListResponseSchema = z.object({
  data: z.array(workflowTaskDetailSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
  meta: z.any().optional(),
});

export const workflowTaskDetailResponseSchema = z.object({
  data: workflowTaskDetailSchema,
  meta: z.any().optional(),
});

/** Response for claim / unclaim / complete. */
export const workflowTaskActionResponseSchema = z.object({
  data: z.object({ success: z.boolean() }),
  meta: z.any().optional(),
});
