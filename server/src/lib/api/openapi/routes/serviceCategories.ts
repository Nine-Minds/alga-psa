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

  const CategoryIdParam = registry.registerSchema(
    'CategoryIdParam',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Category UUID from service_categories.category_id or ticket_categories.category_id.'),
    }),
  );

  const BoardIdParam = registry.registerSchema(
    'CategoryBoardIdParam',
    zOpenApi.object({
      boardId: zOpenApi.string().uuid().describe('Board UUID used by ticket category tree queries.'),
    }),
  );

  const TicketCategory = registry.registerSchema(
    'TicketCategory',
    zOpenApi
      .object({
        category_id: zOpenApi.string().uuid(),
        category_name: zOpenApi.string(),
        parent_category: zOpenApi.string().uuid().nullable().optional(),
        board_id: zOpenApi.string().uuid(),
        description: zOpenApi.string().nullable().optional(),
        created_by: zOpenApi.string().uuid(),
        updated_by: zOpenApi.string().uuid(),
        created_at: zOpenApi.string().datetime().optional(),
        updated_at: zOpenApi.string().datetime().optional(),
        tenant: zOpenApi.string().uuid(),
        children: zOpenApi.array(zOpenApi.unknown()).optional(),
        depth: zOpenApi.number().optional(),
        path: zOpenApi.string().optional(),
        children_count: zOpenApi.number().optional(),
      })
      .describe('Ticket category resource from ticket_categories, including optional hierarchy fields.'),
  );

  const TicketCategoryCreateRequest = registry.registerSchema(
    'TicketCategoryCreateRequest',
    zOpenApi.object({
      category_name: zOpenApi.string().min(1).max(255),
      board_id: zOpenApi.string().uuid(),
      parent_category: zOpenApi.string().uuid().optional(),
      description: zOpenApi.string().max(1000).optional(),
    }),
  );

  const TicketCategoryUpdateRequest = registry.registerSchema('TicketCategoryUpdateRequest', TicketCategoryCreateRequest.partial());

  const TicketCategoryListQuery = registry.registerSchema(
    'TicketCategoryListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional(),
      limit: zOpenApi.string().optional(),
      sort: zOpenApi.string().optional(),
      order: zOpenApi.enum(['asc', 'desc']).optional(),
      search: zOpenApi.string().optional(),
      created_from: zOpenApi.string().datetime().optional(),
      created_to: zOpenApi.string().datetime().optional(),
      updated_from: zOpenApi.string().datetime().optional(),
      updated_to: zOpenApi.string().datetime().optional(),
      category_name: zOpenApi.string().optional(),
      board_id: zOpenApi.string().uuid().optional(),
      parent_category: zOpenApi.string().uuid().optional(),
      is_parent: zOpenApi.enum(['true', 'false']).optional(),
      is_child: zOpenApi.enum(['true', 'false']).optional(),
      depth: zOpenApi.string().optional(),
      active: zOpenApi.enum(['true', 'false']).optional(),
      offset: zOpenApi.string().optional(),
      sort_by: zOpenApi.string().optional(),
      sort_order: zOpenApi.enum(['asc', 'desc']).optional(),
      include_hierarchy: zOpenApi.enum(['true', 'false']).optional(),
      category_type: zOpenApi.enum(['service', 'ticket']).optional(),
    }),
  );

  const CategoryMoveRequest = registry.registerSchema(
    'CategoryMoveRequest',
    zOpenApi.object({
      category_id: zOpenApi.string().uuid(),
      new_parent_id: zOpenApi.string().uuid().optional().nullable(),
      position: zOpenApi.number().int().min(0).optional(),
    }),
  );

  const CategorySearchQuery = registry.registerSchema(
    'CategorySearchQuery',
    zOpenApi.object({
      search_term: zOpenApi.string().min(1),
      category_type: zOpenApi.enum(['service', 'ticket']).optional(),
      board_id: zOpenApi.string().uuid().optional(),
      include_inactive: zOpenApi.enum(['true', 'false']).optional(),
      limit: zOpenApi.string().optional(),
      offset: zOpenApi.string().optional(),
    }),
  );

  const CategoryAnalyticsQuery = registry.registerSchema(
    'CategoryAnalyticsQuery',
    zOpenApi.object({
      category_type: zOpenApi.enum(['service', 'ticket']).optional(),
      board_id: zOpenApi.string().uuid().optional(),
      date_from: zOpenApi.string().datetime().optional(),
      date_to: zOpenApi.string().datetime().optional(),
      include_usage: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );

  const CategoryAnalyticsResponse = registry.registerSchema(
    'CategoryAnalyticsResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        analytics: zOpenApi.record(zOpenApi.unknown()).describe('Aggregated category analytics from CategoryService.getCategoryAnalytics.'),
        generated_at: zOpenApi.string().datetime(),
      }),
    }),
  );

  const CategoryTreeResponse = registry.registerSchema(
    'CategoryTreeResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        tree: zOpenApi.array(zOpenApi.unknown()).describe('Hierarchical category tree nodes from CategoryService.getCategoryTree.'),
        total_categories: zOpenApi.number().int().min(0),
      }),
    }),
  );

  const BulkDeleteCategoriesRequest = registry.registerSchema(
    'BulkDeleteCategoriesRequest',
    zOpenApi.object({
      category_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(50),
      category_type: zOpenApi.enum(['service', 'ticket']),
      force: zOpenApi
        .union([zOpenApi.enum(['true', 'false']), zOpenApi.boolean()])
        .optional()
        .describe('Optional force flag; schema accepts both boolean and string boolean values.'),
    }),
  );

  const BulkDeleteCategoriesResponse = registry.registerSchema(
    'BulkDeleteCategoriesResponse',
    zOpenApi.object({
      data: zOpenApi.object({
        message: zOpenApi.string(),
        success: zOpenApi.number().int().min(0),
        failed: zOpenApi.number().int().min(0),
        errors: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional(),
      }),
    }),
  );

  const PaginatedTicketCategoryResponse = registry.registerSchema(
    'PaginatedTicketCategoryResponse',
    zOpenApi.object({
      data: zOpenApi.array(TicketCategory),
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
    method: 'get',
    path: '/api/v1/categories/service/{id}',
    summary: 'Get service category',
    description: 'Returns one service category by category_id for the authenticated tenant. Requires billing_settings:read permission.',
    tags: ['Service Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { params: CategoryIdParam },
    responses: {
      200: { description: 'Service category returned successfully.', schema: zOpenApi.object({ data: ServiceCategory }) },
      400: { description: 'Invalid category id format.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks billing settings read permission.', schema: deps.ErrorResponse },
      404: { description: 'Service category not found.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'billing_settings',
      'x-rbac-action': 'read',
      'x-id-provenance': { category_id: 'service_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/categories/service/{id}',
    summary: 'Update service category',
    description: 'Updates one service category by category_id. Requires billing_settings:update permission.',
    tags: ['Service Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { params: CategoryIdParam, body: { schema: ServiceCategoryCreateRequest } },
    responses: {
      200: { description: 'Service category updated successfully.', schema: zOpenApi.object({ data: ServiceCategory }) },
      400: { description: 'Invalid category id or request payload.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks billing settings update permission.', schema: deps.ErrorResponse },
      404: { description: 'Service category not found.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'billing_settings',
      'x-rbac-action': 'update',
      'x-id-provenance': { category_id: 'service_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/categories/service/{id}',
    summary: 'Delete service category',
    description: 'Deletes one service category by category_id. Requires billing_settings:delete permission.',
    tags: ['Service Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { params: CategoryIdParam },
    responses: {
      204: { description: 'Service category deleted successfully.', emptyBody: true },
      400: { description: 'Invalid category id format.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks billing settings delete permission.', schema: deps.ErrorResponse },
      404: { description: 'Service category not found.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'billing_settings',
      'x-rbac-action': 'delete',
      'x-id-provenance': { category_id: 'service_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/categories/ticket',
    summary: 'List ticket categories',
    description: 'Returns paginated ticket categories. Requires ticket_settings:read permission.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { query: TicketCategoryListQuery },
    responses: {
      200: { description: 'Ticket categories returned successfully.', schema: PaginatedTicketCategoryResponse },
      400: { description: 'Invalid query parameters.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings read permission.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'read',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/categories/ticket',
    summary: 'Create ticket category',
    description: 'Creates a ticket category row for one board. Requires ticket_settings:create permission.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: TicketCategoryCreateRequest } },
    responses: {
      201: { description: 'Ticket category created successfully.', schema: zOpenApi.object({ data: TicketCategory }) },
      400: { description: 'Invalid request payload.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings create permission.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'create',
      'x-id-provenance': { category_id: 'ticket_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/categories/ticket/{id}',
    summary: 'Get ticket category',
    description: 'Returns one ticket category by category_id. Requires ticket_settings:read permission.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { params: CategoryIdParam },
    responses: {
      200: { description: 'Ticket category returned successfully.', schema: zOpenApi.object({ data: TicketCategory }) },
      400: { description: 'Invalid category id format.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings read permission.', schema: deps.ErrorResponse },
      404: { description: 'Ticket category not found.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'read',
      'x-id-provenance': { category_id: 'ticket_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/categories/ticket/{id}',
    summary: 'Update ticket category',
    description: 'Updates one ticket category by category_id. Requires ticket_settings:update permission.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { params: CategoryIdParam, body: { schema: TicketCategoryUpdateRequest } },
    responses: {
      200: { description: 'Ticket category updated successfully.', schema: zOpenApi.object({ data: TicketCategory }) },
      400: { description: 'Invalid category id or request payload.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings update permission.', schema: deps.ErrorResponse },
      404: { description: 'Ticket category not found.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'update',
      'x-id-provenance': { category_id: 'ticket_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/categories/ticket/{id}',
    summary: 'Delete ticket category',
    description: 'Deletes one ticket category by category_id. Requires ticket_settings:delete permission.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { params: CategoryIdParam },
    responses: {
      204: { description: 'Ticket category deleted successfully.', emptyBody: true },
      400: { description: 'Invalid category id format.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings delete permission.', schema: deps.ErrorResponse },
      404: { description: 'Ticket category not found.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'delete',
      'x-id-provenance': { category_id: 'ticket_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/categories/ticket/tree',
    summary: 'Get ticket category tree (implicit board id)',
    description:
      'Calls getCategoryTree and derives boardId from the last URL path segment. For this path without a board parameter, the current implementation passes literal `tree` as boardId to CategoryService.getCategoryTree.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: { description: 'Category tree response for derived board id value.', schema: CategoryTreeResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings read permission.', schema: deps.ErrorResponse },
      500: { description: 'Unexpected category tree failure for invalid derived board id.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'read',
      'x-board-id-derived-from-last-path-segment': true,
      'x-no-board-param-route-currently-passes-tree-literal': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/categories/ticket/tree/{boardId}',
    summary: 'Get ticket category tree by board',
    description:
      'Returns hierarchical ticket categories for a board route. Current controller still derives board id from the last path segment instead of reading req.params directly; this works for this route because the last segment is boardId.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { params: BoardIdParam },
    responses: {
      200: { description: 'Category tree returned successfully.', schema: CategoryTreeResponse },
      400: { description: 'Invalid board id format.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings read permission.', schema: deps.ErrorResponse },
      500: { description: 'Unexpected category tree failure.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'read',
      'x-board-id-derived-from-last-path-segment': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/categories/ticket/move',
    summary: 'Move ticket category in hierarchy',
    description: 'Moves a ticket category under a new parent. Requires ticket_settings:update permission.',
    tags: ['Ticket Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CategoryMoveRequest } },
    responses: {
      200: { description: 'Category moved successfully.', schema: zOpenApi.object({ data: TicketCategory }) },
      400: { description: 'Invalid request payload.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks ticket settings update permission.', schema: deps.ErrorResponse },
      404: { description: 'Category not found.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'ticket_settings',
      'x-rbac-action': 'update',
      'x-id-provenance': { category_id: 'ticket_categories.category_id' },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/categories/search',
    summary: 'Search categories',
    description:
      'Searches categories across service/ticket types. Permission resource is chosen dynamically from category_type (defaults to ticket_settings when omitted).',
    tags: ['Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { query: CategorySearchQuery },
    responses: {
      200: { description: 'Category search results returned.', schema: zOpenApi.object({ data: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())), pagination: zOpenApi.record(zOpenApi.unknown()), meta: zOpenApi.record(zOpenApi.unknown()).optional() }) },
      400: { description: 'Invalid query parameters.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks the derived settings read permission.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource-dynamic-by-category-type': {
        service: 'billing_settings',
        ticket_or_default: 'ticket_settings',
      },
      'x-rbac-action': 'read',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/categories/analytics',
    summary: 'Get category analytics',
    description:
      'Returns category analytics with generation timestamp. Permission resource is chosen dynamically from category_type (defaults to ticket_settings when omitted).',
    tags: ['Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { query: CategoryAnalyticsQuery },
    responses: {
      200: { description: 'Category analytics returned successfully.', schema: CategoryAnalyticsResponse },
      400: { description: 'Invalid query parameters.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks the derived settings read permission.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource-dynamic-by-category-type': {
        service: 'billing_settings',
        ticket_or_default: 'ticket_settings',
      },
      'x-rbac-action': 'read',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/categories/bulk/delete',
    summary: 'Bulk delete categories',
    description:
      'Deletes multiple category ids. Permission resource is chosen dynamically from category_type; response includes success/failed counts and per-item errors.',
    tags: ['Categories'],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: BulkDeleteCategoriesRequest } },
    responses: {
      200: { description: 'Bulk deletion completed.', schema: BulkDeleteCategoriesResponse },
      400: { description: 'Invalid request payload.', schema: deps.ErrorResponse },
      401: { description: 'Authentication failed.', schema: deps.ErrorResponse },
      403: { description: 'Authenticated user lacks the derived settings delete permission.', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource-dynamic-by-category-type': {
        service: 'billing_settings',
        ticket: 'ticket_settings',
      },
      'x-rbac-action': 'delete',
      'x-partial-failures-in-response': true,
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
