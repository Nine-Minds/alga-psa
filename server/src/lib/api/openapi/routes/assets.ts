import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerAssetRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Assets';

  const AssetType = zOpenApi.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']);

  const AssetListQuery = registry.registerSchema(
    'AssetListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional().describe('Page number as a query string. Defaults to 1 after validation.'),
      limit: zOpenApi.string().optional().describe('Page size as a query string. Must parse to 1 through 100; defaults to 25.'),
      sort: zOpenApi.string().optional().describe('Sort column. Defaults to created_at.'),
      order: zOpenApi.enum(['asc', 'desc']).optional().describe('Sort direction. Defaults to desc.'),
      search: zOpenApi.string().optional().describe('General search filter accepted by the shared filter schema. The current AssetService.list implementation does not apply this filter.'),
      created_from: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      created_to: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      updated_from: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      updated_to: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      is_active: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      asset_tag: zOpenApi.string().optional().describe('Partial asset tag match using ILIKE.'),
      name: zOpenApi.string().optional().describe('Partial asset name match using ILIKE.'),
      client_id: zOpenApi.string().uuid().optional().describe('Client UUID from clients.client_id.'),
      asset_type: AssetType.optional().describe('Asset type stored in assets.asset_type.'),
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

  const AssetExportQuery = registry.registerSchema(
    'AssetExportQuery',
    zOpenApi.object({
      format: zOpenApi.enum(['csv', 'json', 'xlsx']).optional().describe('Export format. csv returns text/csv; json and xlsx currently return the same JSON envelope.'),
      include_extension_data: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but currently ignored by ApiAssetController.export.'),
      include_maintenance: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but currently ignored by ApiAssetController.export.'),
      include_documents: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but currently ignored by ApiAssetController.export.'),
      asset_types: zOpenApi.array(AssetType).optional().describe('Accepted by validation as an array, but the controller builds query values with Object.fromEntries and does not apply this filter.'),
      statuses: zOpenApi.array(zOpenApi.string()).optional().describe('Accepted by validation as an array, but not currently applied.'),
      client_ids: zOpenApi.array(zOpenApi.string().uuid()).optional().describe('Accepted by validation as an array, but not currently applied.'),
      fields: zOpenApi.array(zOpenApi.string()).optional().describe('Accepted by validation as an array, but not currently used to select export columns.'),
    }),
  );

  const AssetDocumentAssociationParams = registry.registerSchema(
    'AssetDocumentAssociationParams',
    zOpenApi.object({
      associationId: zOpenApi.string().uuid().describe('Document association UUID from document_associations.association_id.'),
    }),
  );

  const AssetExtensionData = registry.registerSchema(
    'AssetExtensionData',
    zOpenApi.record(zOpenApi.unknown()).describe('Asset-type-specific extension data written to the corresponding extension table for workstation, network device, server, mobile device, or printer assets.'),
  );

  const AssetCreateRequest = registry.registerSchema(
    'AssetCreateRequest',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().describe('Client UUID from clients.client_id. Required.'),
      asset_type: AssetType.describe('Asset type. Determines the optional extension data table.'),
      asset_tag: zOpenApi.string().min(1).max(255).describe('Required tenant-specific asset tag.'),
      name: zOpenApi.string().min(1).max(255).describe('Required asset name.'),
      status: zOpenApi.string().min(1).describe('Required asset status.'),
      location: zOpenApi.string().optional().describe('Optional asset location.'),
      serial_number: zOpenApi.string().optional().describe('Optional serial number.'),
      purchase_date: zOpenApi.string().datetime().optional().describe('Optional purchase date/time.'),
      warranty_end_date: zOpenApi.string().datetime().optional().describe('Optional warranty end date/time.'),
      extension_data: AssetExtensionData.optional(),
    }),
  );

  const AssetUpdateData = registry.registerSchema(
    'AssetUpdateData',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().optional().describe('Client UUID to assign to the asset.'),
      asset_type: AssetType.optional().describe('Asset type to store in assets.asset_type.'),
      asset_tag: zOpenApi.string().min(1).max(255).optional().describe('Tenant-specific asset tag.'),
      name: zOpenApi.string().min(1).max(255).optional().describe('Asset name.'),
      status: zOpenApi.string().min(1).optional().describe('Asset status.'),
      location: zOpenApi.string().optional().describe('Asset location.'),
      serial_number: zOpenApi.string().optional().describe('Serial number.'),
      purchase_date: zOpenApi.string().datetime().optional().describe('Purchase date/time.'),
      warranty_end_date: zOpenApi.string().datetime().optional().describe('Warranty end date/time.'),
    }),
  );

  const AssetBulkUpdateRequest = registry.registerSchema(
    'AssetBulkUpdateRequest',
    zOpenApi.object({
      assets: zOpenApi.array(zOpenApi.object({
        asset_id: zOpenApi.string().uuid().describe('Asset UUID from assets.asset_id.'),
        data: AssetUpdateData.describe('Partial update data validated with updateAssetSchema.'),
      })).min(1).max(50).describe('Assets to update. Limited to 1 through 50 entries by validation.'),
    }),
  );

  const AssetBulkStatusRequest = registry.registerSchema(
    'AssetBulkStatusRequest',
    zOpenApi.object({
      asset_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(50).describe('Asset UUIDs from assets.asset_id. Limited to 1 through 50 entries by validation.'),
      status: zOpenApi.string().min(1).describe('New status assigned to every asset in asset_ids.'),
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

  const AssetResource = registry.registerSchema(
    'AssetResource',
    zOpenApi.object({
      asset_id: zOpenApi.string().uuid().describe('Primary key from assets.asset_id.'),
      client_id: zOpenApi.string().uuid().describe('Client UUID from assets.client_id.'),
      asset_type: AssetType.describe('Asset type stored in assets.asset_type.'),
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
      extension_data: AssetExtensionData.nullable().optional().describe('Asset-type-specific extension data returned by getWithDetails after create.'),
      relationships: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional().describe('Related asset rows included by getWithDetails after create.'),
      documents: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional().describe('Associated document rows included by getWithDetails after create.'),
      maintenance_schedules: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional().describe('Maintenance schedule rows included by getWithDetails after create.'),
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

  const AssetListPayload = registry.registerSchema(
    'AssetListPayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetResource).describe('Asset records for the requested page.'),
      pagination: Pagination,
      _links: AssetCollectionLinks,
    }),
  );

  const AssetListResponse = registry.registerSchema(
    'AssetListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Indicates the controller returned a successful response envelope.'),
      data: AssetListPayload.describe('Nested payload passed to createApiResponse by ApiAssetController.list.'),
      meta: ApiResponseMeta,
    }),
  );

  const AssetResourcePayload = registry.registerSchema(
    'AssetResourcePayload',
    zOpenApi.object({
      data: AssetResource.describe('Asset record returned by the service.'),
    }),
  );

  const AssetResourceResponse = registry.registerSchema(
    'AssetResourceResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetResourcePayload.describe('Nested payload passed to createApiResponse by ApiAssetController.create.'),
      meta: ApiResponseMeta,
    }),
  );

  const AssetBulkUpdatePayload = registry.registerSchema(
    'AssetBulkUpdatePayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetResource).describe('Updated asset rows returned from AssetService.update.'),
      message: zOpenApi.string().describe('Human-readable count of updated assets.'),
    }),
  );

  const AssetBulkUpdateResponse = registry.registerSchema(
    'AssetBulkUpdateResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetBulkUpdatePayload,
      meta: ApiResponseMeta,
    }),
  );

  const AssetExportJsonPayload = registry.registerSchema(
    'AssetExportJsonPayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetResource).describe('All asset rows returned by AssetService.list with default list options. Export filters are currently not applied.'),
    }),
  );

  const AssetExportJsonResponse = registry.registerSchema(
    'AssetExportJsonResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetExportJsonPayload,
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

  const assetRouteExtensions = {
    'x-tenant-scoped': true,
    'x-request-context-required': true,
    'x-current-auth-wiring-missing': true,
  };

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
        description: 'Paginated asset list returned successfully. The pagination and links are nested under the top-level data envelope.',
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
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-unapplied-validated-filters': ['maintenance_due', 'is_active', 'search', 'created_from', 'created_to', 'updated_from', 'updated_to'],
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets',
    summary: 'Create asset',
    description:
      'Creates an asset for the authenticated tenant. The request body is validated with createAssetWithExtensionSchema; client_id, asset_type, asset_tag, name, and status are required. AssetService.create writes assets.tenant from the request context, inserts the asset, optionally upserts asset-type-specific extension_data, publishes an ASSET_CREATED event, and returns getWithDetails with HATEOAS links. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before creation.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: AssetCreateRequest,
        description: 'Asset fields plus optional asset-type-specific extension_data.',
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Asset created successfully.',
        schema: AssetResourceResponse,
      },
      400: {
        description: 'Request body validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to create assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including missing req.context in the current route wiring.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'create',
      'x-publishes-event': 'ASSET_CREATED',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/assets/bulk-status',
    summary: 'Bulk update asset status',
    description:
      'Updates the status field for up to 50 assets in the authenticated tenant. The controller validates asset_ids and status with bulkAssetStatusSchema, then calls AssetService.update for each asset_id with { status }. Each update is tenant-scoped by assets.asset_id and assets.tenant and publishes an ASSET_UPDATED event. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before updates.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: AssetBulkStatusRequest,
        description: 'Asset IDs and the new status to apply to all assets.',
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Status updated for all requested assets.',
        schema: AssetBulkUpdateResponse,
      },
      400: {
        description: 'Request body validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including missing req.context in the current route wiring.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-max-items': 50,
      'x-publishes-event': 'ASSET_UPDATED',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/assets/bulk-update',
    summary: 'Bulk update assets',
    description:
      'Updates up to 50 assets in the authenticated tenant. Each array item supplies an asset_id and partial update data validated with updateAssetSchema. The controller calls AssetService.update for every item, tenant-scoping each update by asset_id and context.tenant and publishing ASSET_UPDATED events. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before updates.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: AssetBulkUpdateRequest,
        description: 'Array of asset_id plus partial update data objects.',
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Assets updated successfully.',
        schema: AssetBulkUpdateResponse,
      },
      400: {
        description: 'Request body validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including missing req.context in the current route wiring.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-max-items': 50,
      'x-publishes-event': 'ASSET_UPDATED',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/documents/{associationId}',
    summary: 'Remove asset document association',
    description:
      'Removes a document association row by document_associations.association_id for the authenticated tenant. The service deletes rows where association_id and tenant match and does not verify entity_type in this method. The controller intends to return an empty success response after deletion, but currently calls createApiResponse(null, 204) inside NextResponse.json, which can throw because JSON responses cannot use status 204 with a body. In the current route wiring, req.context may also be absent because no route-level API-key auth wrapper sets it, causing a 500 before deletion.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetDocumentAssociationParams,
    },
    responses: {
      204: {
        description: 'Intended successful deletion response with no body.',
        emptyBody: true,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update asset documents when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including missing req.context or the current 204 JSON response construction issue.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-current-204-json-response-bug': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/export',
    summary: 'Export assets',
    description:
      'Exports assets for the authenticated tenant. The controller validates assetExportQuerySchema, but currently ignores the validated filters and include flags and calls AssetService.list with default options. When format=csv or omitted, it returns text/csv with Content-Disposition attachment filename=assets.csv. When format=json or format=xlsx, it returns a JSON success envelope; xlsx generation is not implemented. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before export.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: AssetExportQuery,
    },
    responses: {
      200: {
        description: 'Asset export returned successfully. For format=csv or omitted, the handler returns text/csv with an attachment filename; for format=json or format=xlsx, the handler currently returns this JSON envelope.',
        schema: AssetExportJsonResponse,
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
        description: 'Authenticated request context lacks permission to read/export assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including missing req.context in the current route wiring.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-csv-content-disposition': 'attachment; filename=assets.csv',
      'x-export-filters-currently-ignored': true,
      'x-xlsx-generation-implemented': false,
    },
    edition: 'both',
  });
}
