import type { ZodTypeAny } from 'zod';
import { createStatusSchema, updateStatusSchema, statusResponseSchema } from '../../schemas/status';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerStatusRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Statuses';

  const StatusIdParams = registry.registerSchema(
    'StatusIdParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Status UUID.'),
    }),
  );

  const StatusApiResponse = registry.registerSchema(
    'StatusApiResponse',
    statusResponseSchema,
  );

  const StatusEnvelope = registry.registerSchema(
    'StatusEnvelope',
    zOpenApi.object({
      data: StatusApiResponse,
    }),
  );

  const StatusListEnvelope = registry.registerSchema(
    'StatusListEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(StatusApiResponse),
    }),
  );

  const StatusCreateRequest = registry.registerSchema(
    'StatusCreateRequest',
    createStatusSchema.describe(
      'Payload for creating a new status. For ticket statuses, board_id is required.',
    ),
  );

  const StatusUpdateRequest = registry.registerSchema(
    'StatusUpdateRequest',
    updateStatusSchema.describe('Payload for updating a status. All fields are optional.'),
  );

  // GET /api/v1/statuses
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/statuses',
    summary: 'List statuses',
    description:
      'Returns a paginated list of statuses. For ticket statuses, filter by type=ticket and board_id to get statuses that belong to a specific board. The status_id must belong to the same board_id when creating tickets.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {},
    responses: {
      200: {
        description: 'Statuses returned successfully.',
        schema: StatusListEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Statuses',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  // GET /api/v1/statuses/{id}
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/statuses/{id}',
    summary: 'Get status by ID',
    description: 'Returns a single status by its UUID.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: StatusIdParams,
    },
    responses: {
      200: {
        description: 'Status returned successfully.',
        schema: StatusEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Status not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Status',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  // POST /api/v1/statuses
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/statuses',
    summary: 'Create status',
    description:
      'Creates a new status. For ticket statuses, board_id is required. The status_type must be one of: ticket, project, project_task, interaction.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: StatusCreateRequest,
        description: 'Status creation payload.',
      },
    },
    responses: {
      201: {
        description: 'Status created successfully.',
        schema: StatusEnvelope,
      },
      400: {
        description: 'Validation error.',
        schema: deps.ErrorResponse,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'Create Status',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  // PUT /api/v1/statuses/{id}
  registry.registerRoute({
    method: 'put',
    path: '/api/v1/statuses/{id}',
    summary: 'Update status',
    description:
      'Updates an existing status. All fields are optional — only send the fields you want to change.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: StatusIdParams,
      body: {
        schema: StatusUpdateRequest,
        description: 'Status update payload.',
      },
    },
    responses: {
      200: {
        description: 'Status updated successfully.',
        schema: StatusEnvelope,
      },
      400: {
        description: 'Validation error.',
        schema: deps.ErrorResponse,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Status not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'Update Status',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  // DELETE /api/v1/statuses/{id}
  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/statuses/{id}',
    summary: 'Delete status',
    description: 'Deletes a status by its UUID. Cannot delete the last default status for a board.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: StatusIdParams,
    },
    responses: {
      204: {
        description: 'Status deleted successfully.',
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Status not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'Delete Status',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });
}
