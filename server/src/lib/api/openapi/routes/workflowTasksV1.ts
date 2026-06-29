import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import {
  workflowTaskDetailSchema,
  workflowTaskListResponseSchema,
  workflowTaskDetailResponseSchema,
  workflowTaskActionResponseSchema,
  completeWorkflowTaskSchema,
} from '../../schemas/workflowTaskSchemas';

/**
 * Real handlers for the EE-only `/api/v1/workflows/tasks` inbox (list + detail + claim /
 * unclaim / complete). Routes exist on both editions: on the Community build the workflow-task
 * seam returns an empty page (list) or 404 (detail/actions). The remaining write verbs
 * (create / bulk-assign / update) have no handler yet and stay inventory-only in
 * `workflowsV1.ts`.
 */
export function registerWorkflowTasksV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Workflow Tasks v1';

  const ApiError = registry.registerSchema(
    'WorkflowTasksApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const TaskIdParam = registry.registerSchema(
    'WorkflowTaskIdParamV1',
    zOpenApi.object({
      id: zOpenApi.string().describe('Workflow task identifier (taskId).'),
    }),
  );

  // `listWorkflowTasksQuerySchema` uses `z.preprocess`/transforms (empty→undefined, csv→array)
  // which do not render as clean OpenAPI query params. Document the wire-level params instead.
  const ListQuery = registry.registerSchema(
    'WorkflowTasksListQueryV1',
    zOpenApi.object({
      status: zOpenApi
        .string()
        .optional()
        .describe(
          'Comma-separated WorkflowTaskStatus values (pending, claimed, completed, canceled, expired). Omit for the open inbox (pending + claimed).',
        ),
      page: zOpenApi.coerce.number().int().min(1).optional().describe('1-based page number (default 1).'),
      pageSize: zOpenApi
        .coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Items per page, max 100 (default 25).'),
    }),
  );

  // Register the shared task model once so the list/detail wrappers reference it by $ref.
  registry.registerSchema('WorkflowTaskV1', workflowTaskDetailSchema);

  const ListResponse = registry.registerSchema('WorkflowTaskListResponseV1', workflowTaskListResponseSchema);
  const DetailResponse = registry.registerSchema('WorkflowTaskDetailResponseV1', workflowTaskDetailResponseSchema);
  const ActionResponse = registry.registerSchema('WorkflowTaskActionResponseV1', workflowTaskActionResponseSchema);
  const CompleteBody = registry.registerSchema('CompleteWorkflowTaskBodyV1', completeWorkflowTaskSchema);

  const extensions: Record<string, unknown> = {
    'x-tenant-scoped': true,
    'x-auth-mechanism': 'NextAuth session, falling back to x-api-key (resolveWorkflowTaskAuthContext)',
    'x-edition-behavior': 'EE-only feature; CE returns an empty page (list) or 404 (detail/actions).',
  };

  // ---------------------------------------------------------------------------
  // GET /api/v1/workflows/tasks
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/workflows/tasks',
    summary: 'List workflow tasks',
    description:
      'Returns the authenticated caller\'s workflow task inbox (tasks assigned to them directly or via a role), paginated. Items are summary rows without `formSchema`; fetch a single task to obtain its form schema. EE-only — on the Community build this returns an empty page.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: ListQuery },
    responses: {
      200: { description: 'Paginated workflow task inbox.', schema: ListResponse },
      400: { description: 'Invalid query parameters.', schema: ApiError },
      401: { description: 'Authentication required (no session and no/invalid x-api-key).', schema: ApiError },
      500: { description: 'Unexpected failure resolving the task inbox.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // GET /api/v1/workflows/tasks/{id}
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/workflows/tasks/{id}',
    summary: 'Get workflow task',
    description:
      'Returns full detail for a single workflow task, including `formSchema` ({ jsonSchema, uiSchema?, defaultValues? }) so a client can classify the form as simple (native completion) vs complex (web deep-link). EE-only — on the Community build this returns 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: TaskIdParam },
    responses: {
      200: { description: 'Workflow task detail including the resolved form schema.', schema: DetailResponse },
      401: { description: 'Authentication required.', schema: ApiError },
      404: { description: 'Task not found (or workflow tasks unavailable on this build).', schema: ApiError },
      500: { description: 'Unexpected failure resolving the task.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/workflows/tasks/{id}/claim
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/workflows/tasks/{id}/claim',
    summary: 'Claim workflow task',
    description:
      'Claims a pending task for the caller. No request body. EE-only — on the Community build this returns 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: TaskIdParam },
    responses: {
      200: { description: 'Task claimed.', schema: ActionResponse },
      401: { description: 'Authentication required.', schema: ApiError },
      404: { description: 'Task not found (or workflow tasks unavailable on this build).', schema: ApiError },
      409: { description: 'Task already claimed by another user or not in a claimable state.', schema: ApiError },
      500: { description: 'Unexpected failure claiming the task.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/workflows/tasks/{id}/unclaim
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/workflows/tasks/{id}/unclaim',
    summary: 'Unclaim workflow task',
    description:
      'Releases a task the caller has claimed, returning it to the pending pool. No request body. EE-only — on the Community build this returns 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: TaskIdParam },
    responses: {
      200: { description: 'Task released.', schema: ActionResponse },
      401: { description: 'Authentication required.', schema: ApiError },
      404: { description: 'Task not found (or workflow tasks unavailable on this build).', schema: ApiError },
      409: { description: 'Task is not claimed by the caller.', schema: ApiError },
      500: { description: 'Unexpected failure releasing the task.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });

  // ---------------------------------------------------------------------------
  // POST /api/v1/workflows/tasks/{id}/complete
  // ---------------------------------------------------------------------------
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/workflows/tasks/{id}/complete',
    summary: 'Complete workflow task',
    description:
      'Submits the task\'s form payload and completes it. The form data is validated server-side against the task\'s JSON Schema; validation failures return 400 with the schema errors in `error.details`. EE-only — on the Community build this returns 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: TaskIdParam, body: { schema: CompleteBody } },
    responses: {
      200: { description: 'Task completed.', schema: ActionResponse },
      400: { description: 'Form validation failed; schema errors are returned in `error.details`.', schema: ApiError },
      401: { description: 'Authentication required.', schema: ApiError },
      404: { description: 'Task not found (or workflow tasks unavailable on this build).', schema: ApiError },
      409: { description: 'Task is not in a completable state for the caller.', schema: ApiError },
      500: { description: 'Unexpected failure completing the task.', schema: ApiError },
    },
    extensions,
    edition: 'both',
  });
}
