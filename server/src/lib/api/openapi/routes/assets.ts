import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerAssetRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Assets';

  const AssetListQuery = registry.registerSchema(
    'AssetListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional().describe('Page number as a query string. Defaults to 1 after validation.'),
      limit: zOpenApi.string().optional().describe('Page size as a query string. Must parse to 1 through 100; defaults to 25.'),
      sort: zOpenApi.string().optional().describe('Sort column. Defaults to created_at.'),
      order: zOpenApi.enum(['asc', 'desc']).optional().describe('Sort direction. Defaults to desc.'),
      search: zOpenApi.string().optional().describe('General search filter accepted by the shared filter schema.'),
      created_from: zOpenApi.string().datetime().optional().describe('Filter records created at or after this timestamp.'),
      created_to: zOpenApi.string().datetime().optional().describe('Filter records created at or before this timestamp.'),
      updated_from: zOpenApi.string().datetime().optional().describe('Filter records updated at or after this timestamp.'),
      updated_to: zOpenApi.string().datetime().optional().describe('Filter records updated at or before this timestamp.'),
      is_active: zOpenApi.enum(['true', 'false']).optional().describe('Boolean query value accepted by validation. The current AssetService.list implementation does not apply this filter.'),
      asset_tag: zOpenApi.string().optional().describe('Partial asset tag match using ILIKE.'),
      name: zOpenApi.string().optional().describe('Partial asset name match using ILIKE.'),
      client_id: zOpenApi.string().uuid().optional().describe('Client UUID from clients.client_id.'),
      asset_type: zOpenApi.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']).optional().describe('Asset type stored in assets.asset_type.'),
      status: zOpenApi.string().optional().describe('Exact asset status match.'),
      location: zOpenApi.string().optional().describe('Partial location match using ILIKE.'),
      client_name: zOpenApi.string().optional().describe('Partial client name match; joins clients on client_id and tenant.'),
      has_warranty: zOpenApi.enum(['true', 'false']).optional().describe('true requires warranty_end_date to be non-null; false requires it to be null.'),
      warranty_expired: zOpenApi.enum(['true', 'false']).optional().describe('true filters warranty_end_date before now; false filters future warranty dates or no warranty.'),
      maintenance_due: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      purchase_date_from: zOpenApi.string().datetime().optional().describe('Filter purchase_date greater than or equal to this timestamp.'),
      purchase_date_to: zOpenApi.string().datetime().optional().describe('Filter purchase_date less than or equal to this timestamp.'),
      warranty_end_from: zOpenApi.string().datetime().optional().describe('Filter warranty_end_date greater than or equal to this timestamp.'),
      warranty_end_to: zOpenApi.string().datetime().optional().describe('Filter warranty_end_date less than or equal to this timestamp.'),
    }),
  );

  const HateoasLink = registry.registerSchema(
    'HateoasLink',
    zOpenApi.object({
      href: zOpenApi.string().describe('Target URL for the related operation.'),
      method: zOpenApi.string().optional().describe('HTTP method for the link when supplied.'),
    }),
  );

  const AssetLinks = registry.registerSchema(
    'AssetLinks',
    zOpenApi.object({
      self: HateoasLink.optional(),
      edit: HateoasLink.optional(),
      delete: HateoasLink.optional(),
      list: HateoasLink.optional(),
      documents: HateoasLink.optional(),
      maintenance: HateoasLink.optional(),
      history: HateoasLink.optional(),
    }).describe('HATEOAS links generated from the asset_id.'),
  );

  const AssetListItem = registry.registerSchema(
    'AssetListItem',
    zOpenApi.object({
      asset_id: zOpenApi.string().uuid().describe('Primary key from assets.asset_id.'),
      client_id: zOpenApi.string().uuid().describe('Client UUID from assets.client_id.'),
      asset_type: zOpenApi.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']).describe('Asset type stored in assets.asset_type.'),
      asset_tag: zOpenApi.string().describe('Tenant-specific asset tag.'),
      name: zOpenApi.string().describe('Asset display name.'),
      status: zOpenApi.string().describe('Asset status.'),
      location: zOpenApi.string().nullable().optional().describe('Asset location, when recorded.'),
      serial_number: zOpenApi.string().nullable().optional().describe('Asset serial number, when recorded.'),
      purchase_date: zOpenApi.string().nullable().optional().describe('Asset purchase date from assets.purchase_date.'),
      warranty_end_date: zOpenApi.string().nullable().optional().describe('Warranty end date from assets.warranty_end_date.'),
      created_at: zOpenApi.string().datetime().describe('Asset creation timestamp.'),
      updated_at: zOpenApi.string().datetime().describe('Asset last update timestamp.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID from assets.tenant; filtered to the authenticated request context.'),
      client_name: zOpenApi.string().optional().describe('Client name selected from the joined clients table.'),
      warranty_status: zOpenApi.enum(['no_warranty', 'expired', 'expiring_soon', 'active']).optional().describe('Computed from warranty_end_date by SQL CASE expression.'),
      maintenance_status: zOpenApi.string().optional().describe('Optional computed maintenance status when present in service results.'),
      _links: AssetLinks.optional(),
    }),
  );

  const Pagination = registry.registerSchema(
    'AssetListPagination',
    zOpenApi.object({
      page: zOpenApi.number().int().describe('Current page number.'),
      limit: zOpenApi.number().int().describe('Page size.'),
      total: zOpenApi.number().int().describe('Total matching asset count.'),
      totalPages: zOpenApi.number().int().describe('Total number of pages calculated from total and limit.'),
    }),
  );

  const AssetCollectionLinks = registry.registerSchema(
    'AssetCollectionLinks',
    zOpenApi.object({
      self: HateoasLink.optional(),
      create: HateoasLink.optional(),
      search: HateoasLink.optional(),
      export: HateoasLink.optional(),
      stats: HateoasLink.optional(),
    }).describe('Collection links returned by ApiAssetController.list. These currently point at /api/v2/assets paths.'),
  );

  const ApiResponseMeta = registry.registerSchema(
    'ApiResponseMeta',
    zOpenApi.object({
      timestamp: zOpenApi.string().datetime().describe('Response timestamp generated by createApiResponse/createErrorResponse.'),
      version: zOpenApi.string().describe('API response version string.'),
    }),
  );

  const AssetListResponse = registry.registerSchema(
    'AssetListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Indicates the controller returned a successful response envelope.'),
      data: zOpenApi.array(AssetListItem).describe('Asset records for the requested page.'),
      pagination: Pagination,
      _links: AssetCollectionLinks,
      meta: ApiResponseMeta,
    }),
  );

  const ApiErrorEnvelope = registry.registerSchema(
    'AssetApiErrorEnvelope',
    zOpenApi.object({
      success: zOpenApi.literal(false).describe('Indicates the API response is an error envelope.'),
      error: zOpenApi.object({
        message: zOpenApi.string().describe('Human-readable error message.'),
        code: zOpenApi.string().describe('Machine-readable error code such as VALIDATION_ERROR or INTERNAL_ERROR.'),
        details: zOpenApi.unknown().optional().describe('Optional structured details, including Zod validation errors.'),
      }),
      meta: ApiResponseMeta.optional(),
    }),
  );

  const MiddlewareUnauthorizedResponse = registry.registerSchema(
    'AssetMiddlewareUnauthorizedResponse',
    zOpenApi.object({
      error: zOpenApi.string().describe('Middleware-level error, usually Unauthorized: API key missing.'),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets',
    summary: 'List assets',
    description:
      'Lists assets for the authenticated tenant with pagination, sorting, and asset filters. The controller validates query parameters with assetListQuerySchema, calls requireRequestContext, queries assets filtered by assets.tenant, joins clients for client_name, computes warranty_status, and adds HATEOAS links from asset_id. In the current route wiring, the edge middleware only checks x-api-key presence and the route is not wrapped with withApiKeyAuth or ApiBaseController authentication, so req.context may be absent and produce a 500 INTERNAL_ERROR before the intended tenant-scoped list can run.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: AssetListQuery,
    },
    responses: {
      200: {
        description: 'Paginated asset list returned successfully.',
        schema: AssetListResponse,
      },
      400: {
        description: 'Query parameter validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to read assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including missing req.context in the current route wiring.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-request-context-required': true,
      'x-current-auth-wiring-missing': true,
      'x-unapplied-validated-filters': ['maintenance_due', 'is_active', 'search', 'created_from', 'created_to', 'updated_from', 'updated_to'],
    },
    edition: 'both',
  });
}
