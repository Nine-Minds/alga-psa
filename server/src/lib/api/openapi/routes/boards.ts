import type { ZodTypeAny } from 'zod';
import { createBoardSchema, updateBoardSchema, boardResponseSchema } from '../../schemas/board';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerBoardRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Boards';

  const BoardIdParams = registry.registerSchema(
    'BoardIdParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Board UUID.'),
    }),
  );

  const BoardApiResponse = registry.registerSchema(
    'BoardApiResponse',
    boardResponseSchema,
  );

  const BoardEnvelope = registry.registerSchema(
    'BoardEnvelope',
    zOpenApi.object({
      data: BoardApiResponse,
    }),
  );

  const BoardListEnvelope = registry.registerSchema(
    'BoardListEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(BoardApiResponse),
    }),
  );

  const BoardCreateRequest = registry.registerSchema(
    'BoardCreateRequest',
    createBoardSchema.describe('Payload for creating a new board.'),
  );

  const BoardUpdateRequest = registry.registerSchema(
    'BoardUpdateRequest',
    updateBoardSchema.describe('Payload for updating a board. All fields are optional.'),
  );

  // GET /api/v1/boards
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/boards',
    summary: 'List boards',
    description:
      'Returns a paginated list of ticket boards for the current tenant. Use this to discover valid board_id values before creating tickets or statuses.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {},
    responses: {
      200: {
        description: 'Boards returned successfully.',
        schema: BoardListEnvelope,
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
      'x-chat-display-name': 'List Boards',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  // GET /api/v1/boards/{id}
  registry.registerRoute({
    method: 'get',
    path: '/api/v1/boards/{id}',
    summary: 'Get board by ID',
    description: 'Returns a single board by its UUID.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: BoardIdParams,
    },
    responses: {
      200: {
        description: 'Board returned successfully.',
        schema: BoardEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Board not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Board',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  // POST /api/v1/boards
  registry.registerRoute({
    method: 'post',
    path: '/api/v1/boards',
    summary: 'Create board',
    description:
      'Creates a new ticket board, with the same result as creating one in settings: its ticket statuses, and on an ITIL board its own copy of the standard categories, a default ITIL priority and the ITIL Standard SLA policy. category_type and priority_type must match; a mixed pair is refused with 400.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: BoardCreateRequest,
        description: 'Board creation payload.',
      },
    },
    responses: {
      201: {
        description: 'Board created successfully.',
        schema: BoardEnvelope,
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
      'x-chat-display-name': 'Create Board',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  // PUT /api/v1/boards/{id}
  registry.registerRoute({
    method: 'put',
    path: '/api/v1/boards/{id}',
    summary: 'Update board',
    description: 'Updates an existing board. All fields are optional — only send the fields you want to change. Changing category_type or priority_type switches the board type: both columns move together (a mixed pair is refused with 400), an ITIL board is given its own standard categories, and no ticket, template, schedule or SLA assignment is changed.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: BoardIdParams,
      body: {
        schema: BoardUpdateRequest,
        description: 'Board update payload.',
      },
    },
    responses: {
      200: {
        description: 'Board updated successfully.',
        schema: BoardEnvelope,
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
        description: 'Board not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'Update Board',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  // DELETE /api/v1/boards/{id}
  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/boards/{id}',
    summary: 'Delete board',
    description: 'Deletes a board by its UUID. This will fail if the board has associated tickets. Deleting the last ITIL board releases the ITIL categories and priorities it held and retires the auto-created ITIL Standard SLA policy when nothing else points at it.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: BoardIdParams,
    },
    responses: {
      204: {
        description: 'Board deleted successfully.',
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Board not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket',
      'x-chat-callable': true,
      'x-chat-display-name': 'Delete Board',
      'x-chat-rbac-resource': 'ticket',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });
}
