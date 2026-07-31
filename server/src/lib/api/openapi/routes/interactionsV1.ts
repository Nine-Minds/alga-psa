import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import {
  createInteractionApiSchema,
  interactionListResponseSchema,
  interactionSuccessResponseSchema,
  interactionTypeListResponseSchema,
} from '../../schemas/interactionSchemas';

export function registerInteractionsV1Routes(registry: ApiOpenApiRegistry) {
  const tag = 'Interactions v1';
  const InteractionIdParam = registry.registerSchema(
    'InteractionIdParamV1',
    zOpenApi.object({ id: zOpenApi.string().uuid() }),
  );
  // The runtime query schema transforms pagination strings, so document its wire representation.
  const ListQuery = registry.registerSchema(
    'InteractionListQueryV1',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().optional(),
      contact_id: zOpenApi.string().uuid().optional(),
      opportunity_id: zOpenApi.string().uuid().optional(),
      ticket_id: zOpenApi.string().uuid().optional(),
      project_id: zOpenApi.string().uuid().optional(),
      user_id: zOpenApi.string().uuid().optional(),
      type_id: zOpenApi.string().uuid().optional(),
      date_from: zOpenApi.string().datetime().optional(),
      date_to: zOpenApi.string().datetime().optional(),
      page: zOpenApi.string().regex(/^\d+$/).optional(),
      page_size: zOpenApi.string().regex(/^\d+$/).optional(),
    }),
  );
  const CreateBody = registry.registerSchema('CreateInteractionBodyV1', createInteractionApiSchema);
  const InteractionSuccess = registry.registerSchema('InteractionSuccessV1', interactionSuccessResponseSchema);
  const InteractionList = registry.registerSchema('InteractionListV1', interactionListResponseSchema);
  const InteractionTypeList = registry.registerSchema('InteractionTypeListV1', interactionTypeListResponseSchema);
  const ApiError = registry.registerSchema(
    'InteractionApiErrorV1',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const common = {
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    extensions: {
      'x-tenant-scoped': true,
      'x-auth-mechanism': 'x-api-key validated in ApiBaseController.authenticate()',
      'x-rbac-resource': 'interaction',
    },
    edition: 'both' as const,
  };
  const errors = {
    400: { description: 'Validation or query parsing failure.', schema: ApiError },
    401: { description: 'API key missing or invalid.', schema: ApiError },
    403: { description: 'Interaction RBAC denied.', schema: ApiError },
    404: { description: 'Interaction not found.', schema: ApiError },
    500: { description: 'Unexpected controller or service failure.', schema: ApiError },
  };

  registry.registerRoute({
    ...common,
    method: 'get',
    path: '/api/v1/interactions',
    summary: 'List interactions',
    request: { query: ListQuery },
    responses: {
      200: { description: 'Paginated tenant interactions.', schema: InteractionList },
      ...errors,
    },
  });
  registry.registerRoute({
    ...common,
    method: 'post',
    path: '/api/v1/interactions',
    summary: 'Create an interaction',
    request: { body: { schema: CreateBody } },
    responses: {
      201: { description: 'Interaction created.', schema: InteractionSuccess },
      ...errors,
    },
  });
  registry.registerRoute({
    ...common,
    method: 'get',
    path: '/api/v1/interactions/{id}',
    summary: 'Get an interaction',
    request: { params: InteractionIdParam },
    responses: {
      200: { description: 'Tenant interaction.', schema: InteractionSuccess },
      ...errors,
    },
  });
  registry.registerRoute({
    ...common,
    method: 'get',
    path: '/api/v1/interaction-types',
    summary: 'List interaction types',
    description: 'Returns the union of system and tenant-defined interaction types.',
    responses: {
      200: { description: 'Available interaction types.', schema: InteractionTypeList },
      ...errors,
    },
  });
}
