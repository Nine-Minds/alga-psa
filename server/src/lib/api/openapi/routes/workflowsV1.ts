import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerWorkflowV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Workflows v1';

  const ApiError = registry.registerSchema(
    'WorkflowV1MissingApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const MissingRouteResponse = registry.registerSchema(
    'WorkflowV1MissingRouteResponse',
    zOpenApi.string().describe('Default Next.js not-found response body for missing route handlers.'),
  );

  const missingRouteFileRoot = 'server/src/app/api/v1/workflows';

  const defs: Array<{ method: 'get' | 'post' | 'put' | 'delete'; path: string; summary: string }> = [
    { method: 'get', path: '/api/v1/workflows', summary: 'List workflows' },
    { method: 'post', path: '/api/v1/workflows', summary: 'Create workflow' },
    { method: 'get', path: '/api/v1/workflows/analytics', summary: 'Get workflow analytics' },
    { method: 'get', path: '/api/v1/workflows/events', summary: 'List workflow events' },
    { method: 'post', path: '/api/v1/workflows/events', summary: 'Create workflow event' },
    { method: 'get', path: '/api/v1/workflows/events/{id}', summary: 'Get workflow event by id' },
    { method: 'get', path: '/api/v1/workflows/executions', summary: 'List workflow executions' },
    { method: 'post', path: '/api/v1/workflows/executions', summary: 'Create workflow execution' },
    { method: 'post', path: '/api/v1/workflows/executions/bulk', summary: 'Bulk create workflow executions' },
    { method: 'post', path: '/api/v1/workflows/executions/bulk-action', summary: 'Bulk action workflow executions' },
    { method: 'get', path: '/api/v1/workflows/executions/{id}', summary: 'Get workflow execution by id' },
    { method: 'put', path: '/api/v1/workflows/executions/{id}', summary: 'Update workflow execution' },
    { method: 'post', path: '/api/v1/workflows/executions/{id}/cancel', summary: 'Cancel workflow execution' },
    { method: 'post', path: '/api/v1/workflows/executions/{id}/pause', summary: 'Pause workflow execution' },
    { method: 'post', path: '/api/v1/workflows/executions/{id}/restart', summary: 'Restart workflow execution' },
    { method: 'post', path: '/api/v1/workflows/executions/{id}/resume', summary: 'Resume workflow execution' },
    { method: 'get', path: '/api/v1/workflows/export', summary: 'Export workflows' },
    { method: 'post', path: '/api/v1/workflows/import', summary: 'Import workflows' },
    { method: 'get', path: '/api/v1/workflows/search', summary: 'Search workflows' },
    { method: 'get', path: '/api/v1/workflows/tasks', summary: 'List workflow tasks' },
    { method: 'post', path: '/api/v1/workflows/tasks', summary: 'Create workflow task' },
    { method: 'post', path: '/api/v1/workflows/tasks/bulk-assign', summary: 'Bulk assign workflow tasks' },
    { method: 'get', path: '/api/v1/workflows/tasks/{id}', summary: 'Get workflow task by id' },
    { method: 'put', path: '/api/v1/workflows/tasks/{id}', summary: 'Update workflow task' },
    { method: 'post', path: '/api/v1/workflows/tasks/{id}/claim', summary: 'Claim workflow task' },
    { method: 'post', path: '/api/v1/workflows/tasks/{id}/complete', summary: 'Complete workflow task' },
    { method: 'get', path: '/api/v1/workflows/templates', summary: 'List workflow templates' },
    { method: 'post', path: '/api/v1/workflows/templates', summary: 'Create workflow template' },
    { method: 'delete', path: '/api/v1/workflows/templates/{id}', summary: 'Delete workflow template' },
    { method: 'get', path: '/api/v1/workflows/templates/{id}', summary: 'Get workflow template by id' },
    { method: 'put', path: '/api/v1/workflows/templates/{id}', summary: 'Update workflow template' },
    { method: 'delete', path: '/api/v1/workflows/{id}', summary: 'Delete workflow by id' },
    { method: 'get', path: '/api/v1/workflows/{id}', summary: 'Get workflow by id' },
    { method: 'put', path: '/api/v1/workflows/{id}', summary: 'Update workflow' },
  ];

  for (const def of defs) {
    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: `${def.summary} (route inventory only)`,
      description:
        `This operation is currently present only in generated route inventory. No corresponding Next.js handler exists under ${missingRouteFileRoot} in this worktree. Runtime behavior is middleware-dependent: missing/invalid x-api-key can return 401 before routing; with middleware requirements satisfied, Next.js returns not-found for the absent handler. Existing workflow APIs in this codebase are implemented under /api/workflow-definitions, /api/workflow-runs, and /api/workflow/events rather than /api/v1/workflows paths.`,
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      responses: {
        401: { description: 'x-api-key missing/invalid at middleware.', schema: ApiError },
        404: {
          description: 'No route handler exists for this inventory-only /api/v1/workflows path.',
          contentType: 'text/html',
          schema: MissingRouteResponse,
        },
      },
      extensions: {
        'x-route-inventory-only': true,
        'x-route-file-missing': `${missingRouteFileRoot}/**/route.ts`,
        'x-family-status': 'missing-handler',
      },
      edition: 'both',
    });
  }
}
