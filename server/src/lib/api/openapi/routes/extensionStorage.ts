import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerExtensionStorageRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Extension Storage';

  const StoragePutRequest = registry.registerSchema(
    'ExtStoragePutRequest',
    zOpenApi.object({
      value: zOpenApi.any(),
      metadata: zOpenApi.record(zOpenApi.any()).optional(),
      ttlSeconds: zOpenApi.number().int().positive().optional(),
      ifRevision: zOpenApi.number().int().nonnegative().optional(),
      schemaVersion: zOpenApi.number().int().positive().optional(),
    }),
  );

  const StoragePutResponse = registry.registerSchema(
    'ExtStoragePutResponse',
    zOpenApi.object({
      namespace: zOpenApi.string(),
      key: zOpenApi.string(),
      revision: zOpenApi.number().int().positive(),
      ttlExpiresAt: zOpenApi.string().datetime().nullable(),
      createdAt: zOpenApi.string().datetime(),
      updatedAt: zOpenApi.string().datetime(),
    }),
  );

  const StorageGetResponse = registry.registerSchema(
    'ExtStorageGetResponse',
    zOpenApi.object({
      namespace: zOpenApi.string(),
      key: zOpenApi.string(),
      revision: zOpenApi.number().int().positive(),
      value: zOpenApi.any(),
      metadata: zOpenApi.record(zOpenApi.any()),
      ttlExpiresAt: zOpenApi.string().datetime().nullable(),
      createdAt: zOpenApi.string().datetime(),
      updatedAt: zOpenApi.string().datetime(),
    }),
  );

  const StorageListQuery = registry.registerSchema(
    'ExtStorageListQuery',
    zOpenApi.object({
      limit: zOpenApi.number().int().min(1).max(100).optional(),
      cursor: zOpenApi.string().optional(),
      keyPrefix: zOpenApi.string().max(256).optional(),
      includeValues: zOpenApi.boolean().optional(),
      includeMetadata: zOpenApi.boolean().optional(),
    }),
  );

  const StorageListItem = registry.registerSchema(
    'ExtStorageListItem',
    zOpenApi.object({
      tenant: zOpenApi.string().uuid().optional(),
      extensionInstallId: zOpenApi.string().uuid().optional(),
      namespace: zOpenApi.string(),
      key: zOpenApi.string(),
      revision: zOpenApi.number().int().positive(),
      value: zOpenApi.any().optional(),
      metadata: zOpenApi.record(zOpenApi.any()).optional(),
      ttlExpiresAt: zOpenApi.string().datetime().nullable(),
      createdAt: zOpenApi.string().datetime(),
      updatedAt: zOpenApi.string().datetime(),
    }),
  );

  const StorageListResponse = registry.registerSchema(
    'ExtStorageListResponse',
    zOpenApi.object({
      items: zOpenApi.array(StorageListItem),
      nextCursor: zOpenApi.string().nullable(),
    }),
  );

  const StorageBulkPutRequest = registry.registerSchema(
    'ExtStorageBulkPutRequest',
    zOpenApi.object({
      items: zOpenApi.array(
        zOpenApi.object({
          key: zOpenApi.string().min(1).max(256),
          value: zOpenApi.any(),
          metadata: zOpenApi.record(zOpenApi.any()).optional(),
          ttlSeconds: zOpenApi.number().int().positive().optional(),
          ifRevision: zOpenApi.number().int().nonnegative().optional(),
          schemaVersion: zOpenApi.number().int().positive().optional(),
        }),
      ).min(1),
    }),
  );

  const StorageBulkPutResponse = registry.registerSchema(
    'ExtStorageBulkPutResponse',
    zOpenApi.object({
      namespace: zOpenApi.string(),
      items: zOpenApi.array(
        zOpenApi.object({
          key: zOpenApi.string(),
          revision: zOpenApi.number().int().positive(),
          ttlExpiresAt: zOpenApi.string().datetime().nullable(),
        }),
      ),
    }),
  );

  const IdNamespaceParams = registry.registerSchema(
    'ExtStorageIdNamespaceParams',
    zOpenApi.object({
      installId: zOpenApi.string().uuid(),
      namespace: zOpenApi.string().min(1).max(128),
    }),
  );

  const IdNamespaceKeyParams = registry.registerSchema(
    'ExtStorageIdNamespaceKeyParams',
    IdNamespaceParams.extend({ key: zOpenApi.string().min(1).max(256) }),
  );

  const IfRevisionHeader = registry.registerSchema(
    'ExtStorageIfRevisionHeader',
    zOpenApi.object({ 'if-revision-match': zOpenApi.string().optional() }),
  );

  const DeleteQuery = registry.registerSchema(
    'ExtStorageDeleteQuery',
    zOpenApi.object({ ifRevision: zOpenApi.coerce.number().int().nonnegative().optional() }),
  );

  // List records
  registry.registerRoute({
    method: 'get',
    path: '/api/ext-storage/install/{installId}/{namespace}/records',
    summary: 'List records in a namespace',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: IdNamespaceParams,
      query: StorageListQuery,
    },
    responses: {
      200: { description: 'List of records', schema: StorageListResponse },
      400: { description: 'Validation error', schema: deps.ErrorResponse },
      401: { description: 'Unauthorized', schema: deps.ErrorResponse },
      403: { description: 'Forbidden', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'extension',
    },
    edition: 'ee',
  });

  // Bulk put
  registry.registerRoute({
    method: 'post',
    path: '/api/ext-storage/install/{installId}/{namespace}/records',
    summary: 'Bulk insert/update records',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: IdNamespaceParams,
      body: { schema: StorageBulkPutRequest },
    },
    responses: {
      200: { description: 'Bulk operation result', schema: StorageBulkPutResponse },
      400: { description: 'Validation error', schema: deps.ErrorResponse },
      401: { description: 'Unauthorized', schema: deps.ErrorResponse },
      403: { description: 'Forbidden', schema: deps.ErrorResponse },
      409: { description: 'Revision mismatch', schema: deps.ErrorResponse },
      429: { description: 'Quota exceeded', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'extension',
    },
    edition: 'ee',
  });

  // Get record
  registry.registerRoute({
    method: 'get',
    path: '/api/ext-storage/install/{installId}/{namespace}/records/{key}',
    summary: 'Get a record by key',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: IdNamespaceKeyParams,
      headers: IfRevisionHeader,
    },
    responses: {
      200: { description: 'Record', schema: StorageGetResponse },
      400: { description: 'Validation error', schema: deps.ErrorResponse },
      401: { description: 'Unauthorized', schema: deps.ErrorResponse },
      403: { description: 'Forbidden', schema: deps.ErrorResponse },
      404: { description: 'Not found', schema: deps.ErrorResponse },
      409: { description: 'Revision mismatch', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'extension',
    },
    edition: 'ee',
  });

  // Put record
  registry.registerRoute({
    method: 'put',
    path: '/api/ext-storage/install/{installId}/{namespace}/records/{key}',
    summary: 'Create or update a record by key',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: IdNamespaceKeyParams,
      body: { schema: StoragePutRequest },
    },
    responses: {
      200: { description: 'Record metadata', schema: StoragePutResponse },
      400: { description: 'Validation error', schema: deps.ErrorResponse },
      401: { description: 'Unauthorized', schema: deps.ErrorResponse },
      403: { description: 'Forbidden', schema: deps.ErrorResponse },
      409: { description: 'Revision mismatch', schema: deps.ErrorResponse },
      429: { description: 'Quota exceeded', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'extension',
    },
    edition: 'ee',
  });

  // Delete record
  registry.registerRoute({
    method: 'delete',
    path: '/api/ext-storage/install/{installId}/{namespace}/records/{key}',
    summary: 'Delete a record by key',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: IdNamespaceKeyParams,
      query: DeleteQuery,
    },
    responses: {
      204: { description: 'Deleted', emptyBody: true },
      400: { description: 'Validation error', schema: deps.ErrorResponse },
      401: { description: 'Unauthorized', schema: deps.ErrorResponse },
      403: { description: 'Forbidden', schema: deps.ErrorResponse },
      409: { description: 'Revision mismatch', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'extension',
    },
    edition: 'ee',
  });
}

