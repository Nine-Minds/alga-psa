import { ApiOpenApiRegistry, zOpenApi } from '../registry';

/** Site audits (mobile 2.0 FR18). */
export function registerAssetAuditRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Asset audits';

  const AuditIdParams = registry.registerSchema(
    'AssetAuditIdParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Audit UUID from asset_audits.audit_id.'),
    }),
  );

  const AuditItemParams = registry.registerSchema(
    'AssetAuditItemParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Audit UUID from asset_audits.audit_id.'),
      assetId: zOpenApi.string().uuid().describe('Asset UUID from assets.asset_id.'),
    }),
  );

  const AuditListQuery = registry.registerSchema(
    'AssetAuditListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional().describe('Page number. Defaults to 1.'),
      limit: zOpenApi.string().optional().describe('Page size, 1 through 100. Defaults to 25.'),
      client_id: zOpenApi.string().uuid().optional().describe('Only audits of this client.'),
    }),
  );

  const CreateAuditBody = registry.registerSchema(
    'CreateAssetAuditRequest',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().describe('Client whose assets are audited.'),
      location_id: zOpenApi
        .string()
        .uuid()
        .nullable()
        .optional()
        .describe('Client location in scope. null or omitted audits the client assets that have no location.'),
      statuses: zOpenApi
        .array(zOpenApi.string())
        .optional()
        .describe('Asset status slugs in scope. Omitted means every status.'),
      notes: zOpenApi.string().max(2000).optional(),
    }),
  );

  const MarkAuditItemBody = registry.registerSchema(
    'MarkAssetAuditItemRequest',
    zOpenApi.object({
      asset_id: zOpenApi.string().uuid().describe('Asset being marked.'),
      result: zOpenApi
        .enum(['present', 'unexpected'])
        .optional()
        .describe('Caller intent; an asset outside the snapshot is stored as unexpected regardless. Defaults to present.'),
      method: zOpenApi
        .enum(['scan', 'manual', 'register'])
        .optional()
        .describe('How the asset was marked. Defaults to manual.'),
    }),
  );

  const AuditItem = zOpenApi.object({
    asset_id: zOpenApi.string().uuid(),
    result: zOpenApi.enum(['expected', 'present', 'missing', 'unexpected']),
    method: zOpenApi.enum(['scan', 'manual', 'register']).nullable(),
    marked_at: zOpenApi.string().nullable(),
    marked_by: zOpenApi.string().uuid().nullable(),
    asset_name: zOpenApi.string().nullable().optional(),
    asset_tag: zOpenApi.string().nullable().optional(),
    serial_number: zOpenApi.string().nullable().optional(),
    client_id: zOpenApi.string().uuid().nullable().optional(),
    location_id: zOpenApi.string().uuid().nullable().optional(),
    location: zOpenApi.string().nullable().optional(),
  });

  const Audit = zOpenApi.object({
    audit_id: zOpenApi.string().uuid(),
    tenant: zOpenApi.string().uuid(),
    client_id: zOpenApi.string().uuid(),
    location_id: zOpenApi.string().uuid().nullable(),
    status: zOpenApi.enum(['in_progress', 'completed', 'cancelled']),
    started_by: zOpenApi.string().uuid(),
    started_at: zOpenApi.string(),
    completed_at: zOpenApi.string().nullable(),
    expected_count: zOpenApi.number().int(),
    present_count: zOpenApi.number().int(),
    missing_count: zOpenApi.number().int(),
    unexpected_count: zOpenApi.number().int(),
    statuses: zOpenApi.array(zOpenApi.string()).nullable().optional(),
    notes: zOpenApi.string().nullable().optional(),
    items: zOpenApi.array(AuditItem).optional(),
  });

  const AuditResponse = registry.registerSchema(
    'AssetAuditResponse',
    zOpenApi.object({ success: zOpenApi.boolean(), data: Audit }),
  );

  const AuditListResponse = registry.registerSchema(
    'AssetAuditListResponse',
    zOpenApi.object({
      success: zOpenApi.boolean(),
      data: zOpenApi.array(Audit),
      pagination: zOpenApi.object({
        page: zOpenApi.number().int(),
        limit: zOpenApi.number().int(),
        total: zOpenApi.number().int(),
        totalPages: zOpenApi.number().int(),
      }),
    }),
  );

  const ErrorEnvelope = registry.registerSchema(
    'AssetAuditErrorResponse',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const errors = {
    400: { description: 'Request body or query failed validation.', schema: ErrorEnvelope },
    401: { description: 'x-api-key is missing or invalid.', schema: ErrorEnvelope },
    403: { description: 'Caller lacks the required asset permission.', schema: ErrorEnvelope },
    404: { description: 'Audit or asset not found in this tenant.', schema: ErrorEnvelope },
    500: { description: 'Unexpected error.', schema: ErrorEnvelope },
  };

  const conflict = {
    409: { description: 'The audit is already completed or cancelled.', schema: ErrorEnvelope },
  };

  const ext = (action: 'read' | 'update') => ({
    'x-tenant-scoped': true,
    'x-request-context-required': true,
    'x-rbac-resource': 'asset',
    'x-rbac-action': action,
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/asset-audits',
    summary: 'Start a site audit',
    description:
      'Snapshots the assets expected for the client, location and status slugs in scope as expected items and opens the audit. Needs asset:update because completing the audit writes asset history.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreateAuditBody } },
    responses: {
      201: { description: 'Audit started, with its expected items.', schema: AuditResponse },
      ...errors,
    },
    extensions: { ...ext('update'), 'x-not-paginated': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/asset-audits',
    summary: 'List site audits',
    description: 'Returns the tenant audits newest first, optionally narrowed to one client.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { query: AuditListQuery },
    responses: {
      200: { description: 'Paginated audit list.', schema: AuditListResponse },
      ...errors,
    },
    extensions: ext('read'),
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/asset-audits/{id}',
    summary: 'Get a site audit',
    description: 'Returns the audit with its items joined to each asset name, tag, serial and location.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AuditIdParams },
    responses: {
      200: { description: 'Audit returned.', schema: AuditResponse },
      ...errors,
    },
    extensions: { ...ext('read'), 'x-not-paginated': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/asset-audits/{id}/items',
    summary: 'Mark an asset in a site audit',
    description:
      'Marks the asset present, or unexpected when it is not in the audit snapshot. Idempotent per asset: a second mark keeps the first marked_at.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AuditIdParams, body: { schema: MarkAuditItemBody } },
    responses: {
      200: { description: 'Audit with the updated items.', schema: AuditResponse },
      ...errors,
      ...conflict,
    },
    extensions: { ...ext('update'), 'x-not-paginated': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/asset-audits/{id}/items/{assetId}',
    summary: 'Undo a site audit mark',
    description:
      'Returns an expected asset to the remaining list; an unexpected asset was never in scope, so its item is removed.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AuditItemParams },
    responses: {
      200: { description: 'Audit with the updated items.', schema: AuditResponse },
      ...errors,
      ...conflict,
    },
    extensions: { ...ext('update'), 'x-not-paginated': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/asset-audits/{id}/complete',
    summary: 'Complete a site audit',
    description:
      'Turns every still-expected item into missing, writes the counts, and records one asset_history row (change_type audit) plus assets.last_audited_at and last_audit_result for each present and missing asset, in one transaction.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AuditIdParams },
    responses: {
      200: { description: 'Completed audit with its summary.', schema: AuditResponse },
      ...errors,
      ...conflict,
    },
    extensions: { ...ext('update'), 'x-not-paginated': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/asset-audits/{id}/cancel',
    summary: 'Cancel a site audit',
    description: 'Abandons an open audit; it writes no asset history.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AuditIdParams },
    responses: {
      200: { description: 'Cancelled audit.', schema: AuditResponse },
      ...errors,
      ...conflict,
    },
    extensions: { ...ext('update'), 'x-not-paginated': true },
    edition: 'both',
  });
}
