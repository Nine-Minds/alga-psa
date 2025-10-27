import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerServiceCategoryRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const ServiceCategory = registry.registerSchema(
    'ServiceCategory',
    zOpenApi
      .object({
        tenant: zOpenApi.string().uuid(),
        category_id: zOpenApi.string().uuid(),
        category_name: zOpenApi.string(),
        description: zOpenApi.string().nullable().optional(),
        display_order: zOpenApi.number().int().optional().default(0),
        is_active: zOpenApi.boolean(),
        created_at: zOpenApi.string().datetime(),
        updated_at: zOpenApi.string().datetime(),
        created_by: zOpenApi.string().uuid(),
        updated_by: zOpenApi.string().uuid(),
        tags: zOpenApi.array(zOpenApi.string()).optional(),
      })
      .describe('Service category resource.'),
  );

  const ServiceCategoryCreateRequest = registry.registerSchema(
    'ServiceCategoryCreateRequest',
    zOpenApi
      .object({
        category_name: zOpenApi.string().min(1).max(255),
        description: zOpenApi.string().max(1000).optional(),
        is_active: zOpenApi.boolean().optional(),
      })
      .describe('Payload for creating a service category.'),
  );

  const ServiceCategoryListQuery = registry.registerSchema(
    'ServiceCategoryListQuery',
    zOpenApi
      .object({
        search: zOpenApi.string().optional(),
        is_active: zOpenApi.boolean().optional(),
        page: zOpenApi.number().int().min(1).optional(),
        limit: zOpenApi.number().int().min(1).max(100).optional(),
      })
      .describe('Query parameters for listing service categories.'),
  );

  const PaginatedServiceCategoryResponse = registry.registerSchema(
    'PaginatedServiceCategoryResponse',
    zOpenApi.object({
      data: zOpenApi.array(ServiceCategory),
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
    path: '/api/v1/categories/service',
    summary: 'List service categories',
    description: 'Returns a paginated list of service categories within the current tenant.',
    tags: ['Service Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: ServiceCategoryListQuery,
    },
    responses: {
      200: {
        description: 'A paginated list of service categories.',
        schema: PaginatedServiceCategoryResponse,
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
      'x-rbac-resource': 'service-category',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Service Categories',
      'x-chat-rbac-resource': 'service-category',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/categories/service',
    summary: 'Create service category',
    description: 'Creates a new service category for the tenant. Requires the billing settings create permission.',
    tags: ['Service Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: ServiceCategoryCreateRequest,
        description: 'Service category payload',
      },
    },
    responses: {
      201: {
        description: 'Service category created successfully.',
        schema: zOpenApi.object({ data: ServiceCategory }),
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
      'x-rbac-resource': 'service-category',
      'x-chat-callable': true,
      'x-chat-display-name': 'Create Service Category',
      'x-chat-rbac-resource': 'service-category',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });
}
