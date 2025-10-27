import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerStorageRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny },
) {
  const tag = 'Storage';

  const StoragePutRequest = registry.registerSchema(
    'StoragePutRequest',
    zOpenApi.object({
      value: zOpenApi.any(),
      metadata: zOpenApi.record(zOpenApi.any()).optional(),
      ttlSeconds: zOpenApi.number().int().positive().optional(),
      ifRevision: zOpenApi.number().int().nonnegative().optional(),
      schemaVersion: zOpenApi.number().int().positive().optional(),
    }),
  );

  const StoragePutResponse = registry.registerSchema(
    'StoragePutResponse',
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
    'StorageGetResponse',
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
    'StorageListQuery',
    zOpenApi.object({
      limit: zOpenApi.number().int().min(1).max(100).optional(),
      cursor: zOpenApi.string().optional(),
      keyPrefix: zOpenApi.string().max(256).optional(),
      includeValues: zOpenApi.boolean().optional(),
      includeMetadata: zOpenApi.boolean().optional(),
    }),
  );

  const StorageListItem = registry.registerSchema(
    'StorageListItem',
    zOpenApi.object({
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
    'StorageListResponse',
    zOpenApi.object({
      items: zOpenApi.array(StorageListItem),
      nextCursor: zOpenApi.string().nullable(),
    }),
  );

  const StorageBulkPutRequest = registry.registerSchema(
    'StorageBulkPutRequest',
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
    'StorageBulkPutResponse',
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

  const NamespaceParams = registry.registerSchema(
    'StorageNamespaceParams',
    zOpenApi.object({
      namespace: zOpenApi.string().min(1).max(128),
    }),
  );

  const NamespaceKeyParams = registry.registerSchema(
    'StorageNamespaceKeyParams',
    NamespaceParams.extend({ key: zOpenApi.string().min(1).max(256) }),
  );

  const IfRevisionHeader = registry.registerSchema(
    'StorageIfRevisionHeader',
    zOpenApi.object({ 'if-revision-match': zOpenApi.string().optional() }),
  );

  const DeleteQuery = registry.registerSchema(
    'StorageDeleteQuery',
    zOpenApi.object({ ifRevision: zOpenApi.coerce.number().int().nonnegative().optional() }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/storage/namespaces/{namespace}/records',
    summary: 'List records in a namespace',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: NamespaceParams,
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
      'x-rbac-resource': 'storage',
      'x-chat-callable': true,
      'x-chat-display-name': 'List Storage Records',
      'x-chat-rbac-resource': 'storage',
      'x-chat-approval-required': false,
    },
    edition: 'ce',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/storage/namespaces/{namespace}/records',
    summary: 'Bulk insert or update records',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: NamespaceParams,
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
      'x-rbac-resource': 'storage',
      'x-chat-callable': true,
      'x-chat-display-name': 'Upsert Storage Records',
      'x-chat-rbac-resource': 'storage',
      'x-chat-approval-required': true,
    },
    edition: 'ce',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/storage/namespaces/{namespace}/records/{key}',
    summary: 'Get a record by key',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: NamespaceKeyParams,
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
      'x-rbac-resource': 'storage',
      'x-chat-callable': true,
      'x-chat-display-name': 'Get Storage Record',
      'x-chat-rbac-resource': 'storage',
      'x-chat-approval-required': false,
    },
    edition: 'ce',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/storage/namespaces/{namespace}/records/{key}',
    summary: 'Create or update a record by key',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: NamespaceKeyParams,
      body: { schema: StoragePutRequest },
    },
    responses: {
      200: { description: 'Updated record', schema: StoragePutResponse },
      400: { description: 'Validation error', schema: deps.ErrorResponse },
      401: { description: 'Unauthorized', schema: deps.ErrorResponse },
      403: { description: 'Forbidden', schema: deps.ErrorResponse },
      409: { description: 'Revision mismatch', schema: deps.ErrorResponse },
      429: { description: 'Quota exceeded', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'storage',
      'x-chat-callable': true,
      'x-chat-display-name': 'Put Storage Record',
      'x-chat-rbac-resource': 'storage',
      'x-chat-approval-required': true,
    },
    edition: 'ce',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/storage/namespaces/{namespace}/records/{key}',
    summary: 'Delete a record by key',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: NamespaceKeyParams,
      query: DeleteQuery,
    },
    responses: {
      204: { description: 'Record deleted' },
      400: { description: 'Validation error', schema: deps.ErrorResponse },
      401: { description: 'Unauthorized', schema: deps.ErrorResponse },
      403: { description: 'Forbidden', schema: deps.ErrorResponse },
      404: { description: 'Not found', schema: deps.ErrorResponse },
    },
    extensions: {
      'x-tenant-header-required': true,
      'x-rbac-resource': 'storage',
    },
    edition: 'ce',
  });
}
