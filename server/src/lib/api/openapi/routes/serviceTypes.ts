import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerServiceTypeRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tags = ['Service Types', 'Service Catalog'];

  const ServiceTypeIdParams = registry.registerSchema(
    'ServiceTypeIdParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Service type UUID.'),
    }),
  );

  const ServiceTypeListQuery = registry.registerSchema(
    'ServiceTypeListQuery',
    zOpenApi.object({
      search: zOpenApi.string().optional(),
      billing_method: zOpenApi.enum(['fixed', 'hourly', 'usage']).optional(),
      is_active: zOpenApi.boolean().optional(),
      page: zOpenApi.number().int().min(1).optional(),
      limit: zOpenApi.number().int().min(1).max(100).optional(),
    }),
  );

  const ServiceTypeResource = registry.registerSchema(
    'ServiceTypeResource',
    zOpenApi.object({
      id: zOpenApi.string().uuid(),
      tenant: zOpenApi.string().uuid(),
      name: zOpenApi.string(),
      billing_method: zOpenApi.enum(['fixed', 'hourly', 'usage']),
      is_active: zOpenApi.boolean(),
      description: zOpenApi.string().nullable().optional(),
      order_number: zOpenApi.number().int(),
      created_at: zOpenApi.string().datetime(),
      updated_at: zOpenApi.string().datetime(),
    }).describe('Tenant-specific service type.'),
  );

  const ServiceTypeEnvelope = registry.registerSchema(
    'ServiceTypeEnvelope',
    zOpenApi.object({
      data: ServiceTypeResource,
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const PaginatedServiceTypeEnvelope = registry.registerSchema(
    'PaginatedServiceTypeEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(ServiceTypeResource),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
        hasNext: zOpenApi.boolean(),
        hasPrev: zOpenApi.boolean(),
      }),
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/service-types',
    summary: 'List service types',
    description:
      'Returns tenant service types. Use this endpoint to resolve custom_service_type_id before creating or updating services and products in the service catalog.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: ServiceTypeListQuery,
    },
    responses: {
      200: {
        description: 'Service types returned successfully.',
        schema: PaginatedServiceTypeEnvelope,
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
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Service Types',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/service-types/{id}',
    summary: 'Get service type',
    description: 'Returns a single tenant service type by UUID.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ServiceTypeIdParams,
    },
    responses: {
      200: {
        description: 'Service type returned successfully.',
        schema: ServiceTypeEnvelope,
      },
      401: {
        description: 'Authentication failed.',
        schema: deps.ErrorResponse,
      },
      403: {
        description: 'Authenticated user lacks the required permission.',
        schema: deps.ErrorResponse,
      },
      404: {
        description: 'Service type not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Service Type',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });
}
