import type { ZodTypeAny } from 'zod';
import { createProductSchema, productListQuerySchema, updateProductSchema } from '../../schemas/productSchemas';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerProductRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tags = ['Products', 'Service Catalog'];

  const ProductIdParams = registry.registerSchema(
    'ProductIdParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Product UUID.'),
    }),
  );

  const ProductPrice = registry.registerSchema(
    'ProductPrice',
    zOpenApi.object({
      currency_code: zOpenApi.string().length(3),
      rate: zOpenApi.number(),
    }),
  );

  const ProductResource = registry.registerSchema(
    'ProductCatalogEntry',
    zOpenApi.object({
      service_id: zOpenApi.string().uuid(),
      tenant: zOpenApi.string().uuid(),
      service_name: zOpenApi.string(),
      custom_service_type_id: zOpenApi.string().uuid(),
      billing_method: zOpenApi.enum(['usage']),
      default_rate: zOpenApi.number(),
      unit_of_measure: zOpenApi.string(),
      category_id: zOpenApi.string().uuid().nullable().optional(),
      tax_rate_id: zOpenApi.string().uuid().nullable().optional(),
      description: zOpenApi.string().nullable().optional(),
      item_kind: zOpenApi.enum(['product']),
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
      prices: zOpenApi.array(ProductPrice).optional(),
    }).describe('Product catalog entry.'),
  );

  const ProductEnvelope = registry.registerSchema(
    'ProductEnvelope',
    zOpenApi.object({
      data: ProductResource,
      meta: zOpenApi.record(zOpenApi.unknown()).optional(),
    }),
  );

  const PaginatedProductEnvelope = registry.registerSchema(
    'PaginatedProductEnvelope',
    zOpenApi.object({
      data: zOpenApi.array(ProductResource),
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
    path: '/api/v1/products',
    summary: 'List products',
    description:
      'Returns product catalog entries where item_kind is product. Use this endpoint to inspect existing product catalog records and to gather prerequisite IDs such as custom_service_type_id and category_id before creating a new product.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: productListQuerySchema,
    },
    responses: {
      200: {
        description: 'Products returned successfully.',
        schema: PaginatedProductEnvelope,
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
      'x-chat-display-name': 'List Products',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/products',
    summary: 'Create product',
    description:
      'Creates a new product catalog entry. Resolve custom_service_type_id with GET /api/v1/service-types and category_id with GET /api/v1/categories/service before calling this endpoint. Products are catalog entries with item_kind product and always use billing_method usage.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: createProductSchema,
        description: 'Product creation payload.',
      },
    },
    responses: {
      201: {
        description: 'Product created successfully.',
        schema: ProductEnvelope,
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
      'x-chat-display-name': 'Create Product',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/products/{id}',
    summary: 'Get product',
    description: 'Returns a single product catalog entry by UUID.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProductIdParams,
    },
    responses: {
      200: {
        description: 'Product returned successfully.',
        schema: ProductEnvelope,
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
        description: 'Product not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Product',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/products/{id}',
    summary: 'Update product',
    description: 'Updates a product catalog entry by UUID.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProductIdParams,
      body: {
        schema: updateProductSchema,
        description: 'Product update payload.',
      },
    },
    responses: {
      200: {
        description: 'Product updated successfully.',
        schema: ProductEnvelope,
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
        description: 'Product not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Update Product',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/products/{id}',
    summary: 'Delete product',
    description: 'Deletes a product catalog entry by UUID.',
    tags,
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: ProductIdParams,
    },
    responses: {
      204: {
        description: 'Product deleted successfully.',
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
        description: 'Product not found.',
        schema: deps.ErrorResponse,
      },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'service',
      'x-chat-callable': true,
      'x-chat-display-name': 'Delete Product',
      'x-chat-rbac-resource': 'service',
      'x-chat-approval-required': true,
    },
    edition: 'both',
  });
}
