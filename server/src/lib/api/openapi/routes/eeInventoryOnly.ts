import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerEeInventoryOnlyRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'EE Inventory-Only Routes';
  const extensionsApiPath = '/api' + '/extensions';

  const ApiError = registry.registerSchema(
    'EeInventoryApiError',
    zOpenApi.object({
      error: zOpenApi.object({
        code: zOpenApi.string(),
        message: zOpenApi.string(),
        details: zOpenApi.unknown().optional(),
      }),
    }),
  );

  const MissingRouteResponse = registry.registerSchema(
    'EeInventoryMissingRouteResponse',
    zOpenApi.string().describe('Default Next.js not-found response body for missing route handlers.'),
  );

  const defs: Array<{ method: 'get' | 'post'; path: string; summary: string }> = [
    { method: 'post', path: '/api/ext-bundles/abort', summary: 'Abort extension bundle upload' },
    { method: 'post', path: '/api/ext-bundles/finalize', summary: 'Finalize extension bundle upload' },
    { method: 'post', path: '/api/ext-bundles/upload-proxy', summary: 'Upload extension bundle chunk' },
    { method: 'get', path: `${extensionsApiPath}/install-info`, summary: 'Get extension install info' },
    { method: 'get', path: `${extensionsApiPath}/registry-db-check`, summary: 'Check extension registry DB state' },
    { method: 'post', path: `${extensionsApiPath}/reprovision`, summary: 'Reprovision extensions' },
    { method: 'post', path: '/api/provisioning/tenants', summary: 'Provision tenant' },
    { method: 'post', path: '/api/v1/auth/verify', summary: 'Verify auth token' },
  ];

  for (const def of defs) {
    registry.registerRoute({
      method: def.method,
      path: def.path,
      summary: `${def.summary} (route inventory only)`,
      description:
        'This operation is currently present only in generated EE route inventory. No corresponding handler file exists in this worktree for the listed path. Runtime behavior is middleware-dependent: missing/invalid x-api-key can return 401 before routing; otherwise Next.js returns not-found for the absent handler.',
      tags: [tag],
      security: [{ ApiKeyAuth: [] }],
      responses: {
        401: { description: 'x-api-key missing/invalid at middleware.', schema: ApiError },
        404: {
          description: 'No route handler exists for this inventory-only EE path.',
          contentType: 'text/html',
          schema: MissingRouteResponse,
        },
      },
      extensions: {
        'x-route-inventory-only': true,
        'x-family-status': 'missing-handler',
      },
      edition: 'ee',
    });
  }
}
