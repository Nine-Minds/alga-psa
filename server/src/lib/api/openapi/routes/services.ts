import type { ZodTypeAny } from 'zod';
import { createServiceSchema, serviceListQuerySchema, updateServiceSchema } from '../../schemas/serviceSchemas';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerServiceRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tags = ['Services', 'Service Catalog'];

  const ServiceIdParams = registry.registerSchema(
    'ServiceIdParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Service UUID.'),
    }),
  );

  const ServicePrice = registry.registerSchema(
    'ServicePrice',
    zOpenApi.object({
      currency_code: zOpenApi.string().length(3),
      rate: zOpenApi.number(),
    }),
  );

  const ServiceResource = registry.registerSchema(
    'ServiceCatalogEntry',
    zOpenApi.object({
      service_id: zOpenApi.string().uuid(),
      tenant: zOpenApi.string().uuid(),
      service_name: zOpenApi.string(),
      custom_service_type_id: zOpenApi.string().uuid(),
      billing_method: zOpenApi.enum(['fixed', 'hourly', 'usage']),
      default_rate: zOpenApi.number(),
      unit_of_measure: zOpenApi.string(),
      category_id: zOpenApi.string().uuid().nullable().optional(),
      tax_rate_id: zOpenApi.string().uuid().nullable().optional(),
      description: zOpenApi.string().nullable().optional(),
      item_kind: zOpenApi.enum(['service', 'product']).optional(),
      is_active: zOpenApi.boolean().optional(),
      sku: zOpenApi.string().nullable().optional(),
      cost: zOpenApi.number().nullable().optional(),
      cost_currency: zOpenApi.string().length(3).nullable().optional(),
      vendor: zOpenApi.string().nullable().optional(),
      manufacturer: zOpenApi.string().nullable().optional(),
      product_category: zOpenApi.string().nullable().optional(),
      is_license: zOpenApi.boolean().optional(),
      license_term: zOpenApi.string().nullable().optional(),
      license_billing_cadence: zOpenApi.string().nullable().optional(),
      service_type_name: zOpenApi.string().optional(),
      prices: zOpenApi.array(ServicePrice).optional(),
    }).describe('Service catalog entry.'),
  );

  const ServiceEnvelope = registry.registerSchema(
    'ServiceEnvelope',
    zOpenApi.object({
      data: ServiceResource,
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const PaginatedServiceEnvelope = registry.registerSchema(
    'PaginatedServiceEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(ServiceResource),
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
    path: '/api/v1/services',
    summary: 'List services',
    description:
      'Returns service catalog entries where item_kind is service. Use this endpoint to inspect existing service catalog records and to gather prerequisite IDs such as custom_service_type_id and category_id before creating a new service.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: serviceListQuerySchema,
    },
    responses: {
      200: {
        description: 'Services returned successfully.',
        schema: PaginatedServiceEnvelope,
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
      'x-chat-display-name': 'List Services',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/services',
    summary: 'Create service',
    description:
      'Creates a new service catalog entry. Resolve custom_service_type_id with GET /api/v1/service-types and category_id with GET /api/v1/categories/service before calling this endpoint. Use this endpoint for fixed, hourly, or usage-based service offerings.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: createServiceSchema,
        description: 'Service creation payload.',
      },
    },
    responses: {
      201: {
        description: 'Service created successfully.',
        schema: ServiceEnvelope,
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
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Create Service',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/services/{id}',
    summary: 'Get service',
    description: 'Returns a single service catalog entry by UUID.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ServiceIdParams,
    },
    responses: {
      200: {
        description: 'Service returned successfully.',
        schema: ServiceEnvelope,
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
        description: 'Service not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Service',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/services/{id}',
    summary: 'Update service',
    description: 'Updates a service catalog entry by UUID.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ServiceIdParams,
      body: {
        schema: updateServiceSchema,
        description: 'Service update payload.',
      },
    },
    responses: {
      200: {
        description: 'Service updated successfully.',
        schema: ServiceEnvelope,
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
      404: {
        description: 'Service not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Update Service',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/services/{id}',
    summary: 'Delete service',
    description: 'Deletes a service catalog entry by UUID.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ServiceIdParams,
    },
    responses: {
      204: {
        description: 'Service deleted successfully.',
        emptyBody: true,
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
        description: 'Service not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Delete Service',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });
}
